# 1、前言

本文旨在讲清楚大文件分片上传、断点续传、秒传、重传这件事，并基于 React+Nest 实现了一个小项目，相关代码已上传到地址：https://github.com/XC0703/big-file-upload 。

在文章开始之前，首先需要知道两件事：

- 超过 5 个 G 的场景一般来说 `HTTP` 协议本身就不合适了，因为可能会造成客户端与服务器通信过于频繁的问题，可以基于 `WebSocket` 等协议实现。
- 浏览器性能有限，真正的大体积文件有个关键点，多大体积算大文件？50GB+还是 100GB+，这个概念从来没有明确的定义或者作为前提条件说明。只能说体积达到阈值后，需要借助客户端实现，单独的浏览器不行了。

基于这两点原因，本文旨在讲清楚原理而不是实现一个完备的大文件上传系统，同时演示的文件上传会在 5 个 G 以内。

其中，相关技术栈的学习可看本人博客：

- [Vite+React+TS 基础学习，看这里就够了！（上）](https://juejin.cn/post/7235279096312463421)
- [Vite+React+TS 基础学习，看这里就够了！（下）](https://juejin.cn/post/7237426124669435961)
- [从入门到入门学习 Nest](https://juejin.cn/post/7426978989044809782)

# 2、原理解析

本文要讲的是大文件的分片上传、断点续传、秒传和重传四个功能，而实际上断点续传、秒传、重传都是基于分片上传扩展的功能。

文件分片上传这个过程的本质是将文件在客户端分割成多个较小的部分，然后逐一将这些部分上传到服务器。服务器在收集完所有部分后，会将它们重新组合成原始文件。

为了验证服务器上重组的文件与原始文件是否完全相同，我们使用文件的 MD5 哈希值，这可以看作是文件的“数字签名”。只有当两个文件完全相同时，它们的 MD5 哈希值才会匹配。因此，在文件上传之前，客户端会计算出文件的 MD5 哈希值，并将其发送给服务器。服务器在完成文件的重组后，会计算重组文件的 MD5 哈希值，并与客户端提供的哈希值进行对比。如果两者匹配，那么文件上传成功；如果不匹配，则可能意味着在上传过程中发生了数据丢失或其他错误，导致上传失败。

- 分片上传原理：客户端将选择的文件进行切分，每一个分片都单独发送请求到服务端。
- 断点续传 & 秒传原理：客户端发送请求询问服务端某文件的上传状态，服务端响应该文件已上传分片，客户端再将未上传分片上传即可。
  - 如果没有需要上传的分片就是秒传。
  - 如果有需要上传的分片就是断点续传。
- 重传原理：将文件某一分片的上传过程放入一个循环（最大上传次数），如果上传失败就过段时间重新上传该分片（重传延迟时间），如果上传成功就退出循环。
- 每个文件要有自己唯一的标识，这个标识就是将整个文件进行 MD5 加密，这是一个 Hash 算法，将加密后的 Hash 值作为文件的唯一标识：
  - 使用 `spark-md5` 第三方工具库。
- 文件的合并时机：当服务端确认所有分片都发送完成后，此时会发送请求通知服务端对文件进行合并操作。

![](/md_images/1.png)

# 3、代码实现

## 3.1 文件分片 & MD5 计算

- 前端读取文件后，按照文件总大小、规定的每个分片大小获得分片总数与每个文件分片。
- 计算文件的 MD5 值，我们直接用现成的三方插件 `SparkMD5` 即可。目前的 Hash 策略是选择 Hash 整个文件（即所有文件分片），当然我们也可以选择 Hash 文件的第一个分片 + 中间分片的首尾 n 字节 + 最后一个分片。
- 由于该过程是一个比较耗时的操作，我们用 `Web Worker` 把它放到后台去运行。

这个过程的入口代码如下：

```ts
// react-client\src\utils\file-upload.ts

/**
 * 分片上传：
 * 1. 将文件进行分片并计算Hash值：得到 allChunkList---所有分片，fileHash---文件的hash值
 * 2. 通过fileHash请求服务端，判断文件上传状态，得到 neededFileList---待上传文件分片
 * 3. 同步上传进度，针对不同文件上传状态调用 progress_cb
 * 4. 发送上传请求
 * 5. 发送文件合并请求
 * @param {File} file 目标上传文件
 * @param {number} baseChunkSize 上传分块大小，单位Mb
 * @param {number} maxRetries 最大重试次数
 * @param {number} retryDelay 重试延迟时间
 * @param {Function} progress_cb 更新上传进度的回调函数
 * @returns {Promise}
 */

export async function uploadFile(
	file: File,
	baseChunkSize: number,
	maxRetries?: number,
	retryDelay?: number,
	progress_cb?: (progress: number) => void
): Promise<IUploadFileRes> {
	return new Promise((resolve, reject) => {
		const chunkList: ArrayBuffer[] = [];
		let fileHash = '';
		// 创建文件分片Worker
		const sliceFileWorker = new Worker(new URL('./slice-md5-worker.ts', import.meta.url), {
			type: 'module'
		});
		// 将文件以及分块大小通过postMessage发送给sliceFileWorker线程
		sliceFileWorker.postMessage({ targetFile: file, baseChunkSize });
		// 分片处理完之后触发onmessage事件
		sliceFileWorker.onmessage = async e => {
			switch (e.data.messageType) {
				case 'success':
					chunkList.push(...e.data.chunks);
					fileHash = e.data.fileHash;
					// 处理文件
					try {
						const result = await handleFile(
							file,
							chunkList,
							fileHash,
							maxRetries,
							retryDelay,
							progress_cb
						);
						if (result.success) {
							resolve(result);
						} else {
							reject({ success: false, message: result.message });
						}
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
					} catch (error: any) {
						reject({ success: false, message: error.message });
					}
					break;
				case 'progress':
					chunkList.push(...e.data.chunks);
					break;
				case 'fail':
					console.error('文件分片失败');
					break;
				default:
					break;
			}
		};
	});
}
```

文件分片 & MD5 计算的 `Web Worker` 如下：

```ts
// react-client\src\utils\slice-md5-worker.ts

import SparkMD5 from 'spark-md5';

interface IWorkerMessage {
	chunks: ArrayBuffer[] | null;
	fileHash?: string;
	messageType: 'fail' | 'success' | 'progress';
}

self.onmessage = async e => {
	const { targetFile, baseChunkSize } = e.data;
	await sliceFile(targetFile, baseChunkSize);
};

/**
 * 文件分片 & Hash计算
 * @param {File} targetFile 目标上传文件
 * @param {number} baseChunkSize 上传分块大小，单位Mb
 * @returns {chunkList:ArrayBuffer,fileHash:string}
 */
async function sliceFile(targetFile: File, baseChunkSize: number): Promise<void> {
	return new Promise((resolve, reject) => {
		// 初始化分片方法，兼容问题
		const blobSlice = File.prototype.slice;
		// 分片大小 baseChunkSize Mb
		const chunkSize = baseChunkSize * 1024 * 1024;
		// 分片数
		const targetChunkCount = targetFile && Math.ceil(targetFile.size / chunkSize);
		// 当前已执行分片数
		let currentChunkCount = 0;
		// 创建sparkMD5对象
		const spark = new SparkMD5.ArrayBuffer();
		// 创建文件读取对象
		const fileReader = new FileReader();
		// 文件hash
		let fileHash = null;
		// 分片数组
		const chunks: ArrayBuffer[] = [];
		// 当前分块信息
		const workerMessage: IWorkerMessage = {
			chunks,
			messageType: 'progress'
		};

		// FilerReader onload事件
		fileReader.onload = e => {
			// 当前读取的分块结果 ArrayBuffer
			const curChunk = e.target?.result as ArrayBuffer;
			chunks.push(curChunk);
			// 将当前分块追加到spark对象中
			spark.append(curChunk);
			currentChunkCount++;

			// 满20个分片才发送一次，防止webworker和主线程通信过于频繁导致性能问题
			if (chunks.length >= 20) {
				workerMessage.chunks = chunks;
				workerMessage.messageType = 'progress';
				self.postMessage(workerMessage);
				// 清空数组以便下一次发送
				chunks.splice(0, chunks.length);
			}

			// 判断分块是否全部读取成功
			if (currentChunkCount >= targetChunkCount) {
				// 全部读取，获取文件hash
				fileHash = spark.end();
				// 如果剩余分片少于20个，也发送出去
				if (chunks.length > 0) {
					workerMessage.chunks = chunks;
				}
				workerMessage.fileHash = fileHash;
				workerMessage.messageType = 'success';
				self.postMessage(workerMessage);
				resolve();
			} else {
				loadNext();
			}
		};

		// FilerReader onerror事件
		fileReader.onerror = () => {
			workerMessage.messageType = 'fail';
			self.postMessage(workerMessage);
			reject();
		};

		// 读取下一个分块
		const loadNext = () => {
			// 计算分片的起始位置和终止位置
			const start = chunkSize * currentChunkCount;
			let end = start + chunkSize;
			if (end > targetFile.size) {
				end = targetFile.size;
			}
			// 读取文件，触发onLoad
			fileReader.readAsArrayBuffer(blobSlice.call(targetFile, start, end));
		};

		loadNext();
	});
}
```

经过我们上面的处理后，便获得所有分片数组与文件的 Hash 值。

## 3.2 检验文件上传状态

**前端：**

```ts
// react-client\src\utils\file-upload.ts

// 获取文件上传状态
try {
	const params = {
		fileHash,
		totalCount: allChunkList.length,
		extname
	};
	const res = await vertifyFile(params);

	if (res.code === HttpStatus.FILE_EXIST) {
		// 文件已存在，秒传
		return {
			success: true,
			filePath: res.data.filePath,
			message: res.data.message || ''
		};
	} else if (res.code === HttpStatus.ALL_CHUNK_UPLOAD) {
		// 已完成所有分片上传，请合并文件
		const mergeParams = {
			fileHash,
			extname
		};
		try {
			const mergeRes = await mergeFile(mergeParams);
			if (mergeRes.code === HttpStatus.SUCCESS) {
				return {
					success: true,
					filePath: mergeRes.data.filePath,
					message: mergeRes.data.message || ''
				};
			} else {
				throw new Error('文件合并失败');
			}
		} catch {
			throw new Error('文件合并失败');
		}
	} else if (res.code === HttpStatus.SUCCESS) {
		// 获取需要上传的分片序列
		const { neededFileList, message } = res.data;
		if (!neededFileList.length) {
			return {
				success: true,
				filePath: res.data.filePath,
				message: message || ''
			};
		}
		// 部分上传成功，更新neededChunkList，断点续传
		neededChunkList = neededFileList;
	} else {
		throw new Error('获取文件上传状态失败');
	}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
} catch (error: any) {
	throw new Error(error.message || '获取文件上传状态失败');
}
```

**后端：**

```ts
// nest-server\src\app.service.ts

  async verifyFile(fileHash: string, totalCount: number, extname: string) {
    const fileSuffix = getFileSuffixByName(extname);
    const dirPath = join(process.cwd(), `/uploads/${fileSuffix}/${fileHash}`);
    const filePath = dirPath + '.' + extname;
    const fileDBPath = `/uploads/${fileSuffix}/${fileHash}.${extname}`;
    let res = Array(totalCount)
      .fill(0)
      .map((_, index) => index + 1);

    try {
      // 读取文件状态
      fs.statSync(filePath);
      // 读取成功，即秒传
      const data = {
        neededFileList: [],
        message: '该文件已被上传',
        filePath: fileDBPath,
      };
      return respHttp(HttpStatus.FILE_EXIST, data);
    } catch (fileError) {
      try {
        fs.statSync(dirPath);
        const files = await fs.readdir(dirPath);
        if (files.length < totalCount) {
          // 计算待上传序列
          res = res.filter((fileIndex) => {
            return !files.includes(`chunk-${fileIndex}`);
          });
          const data = { neededFileList: res };
          return respHttp(HttpStatus.SUCCESS, data);
        } else {
          // 已上传所有分块但未进行合并, 通知前端合并文件
          const data = {
            neededFileList: [],
            message: '已完成所有分片上传，请合并文件',
            filePath: fileDBPath,
          };
          return respHttp(HttpStatus.ALL_CHUNK_UPLOAD, data);
        }
      } catch (dirError) {
        // 读取文件夹失败，返回全序列
        const data = { neededFileList: res };
        return respHttp(HttpStatus.SUCCESS, data);
      }
    }
  }
```

文件上传状态主要有几种：

- 文件未上传，全部逻辑重新走一遍（上传所有分片、合并分片）
- 文件分片已经部分上传，走断点续传的逻辑（上传未上传的分片、合并分片）
- 文件已经上传，走秒传的逻辑：
  ![](/md_images/2.png)

## 3.2 上传分片

**前端：**

```ts
// react-client\src\utils\file-upload.ts

// 同步上传进度，断点续传情况下
progress = ((allChunkList.length - neededChunkList.length) / allChunkList.length) * 100;
if (!allChunkList.length) {
	throw new Error('文件分片失败');
}

// 为每个需要上传的分片发送请求
const requestList = allChunkList.map(async (chunk: ArrayBuffer, index: number) => {
	if (neededChunkList.includes(index + 1)) {
		const params = {
			chunk,
			chunkIndex: index + 1,
			fileHash,
			extname
		};
		try {
			await uploadChunkWithRetry(params, maxRetries, retryDelay);
			// 更新进度
			progress += Math.ceil(100 / allChunkList.length);
			if (progress >= 100) progress = 100;
			if (progress_cb) progress_cb(progress);
		} catch {
			throw new Error('存在上传失败的分片');
		}
	}
});
// 如果有失败的分片，抛出错误，并停止后面的合并操作
try {
	await Promise.all(requestList);
	// 发送合并请求
	try {
		const params = {
			fileHash,
			extname
		};
		const mergeRes = await mergeFile(params);
		if (mergeRes.code === HttpStatus.SUCCESS) {
			return {
				success: true,
				filePath: mergeRes.data.filePath,
				message: mergeRes.data.message || ''
			};
		} else {
			throw new Error('文件合并失败');
		}
	} catch {
		throw new Error('文件合并失败');
	}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
} catch (error: any) {
	throw new Error(error.message || '存在上传失败的分片');
}
```

重传机制如下：

```ts
// react-client\src\utils\file-upload.ts

// 分片上传重试
const uploadChunkWithRetry = async (
	params: IUploadChunkParams,
	maxRetries = 3,
	retryDelay = 1000
) => {
	let retries = 0;
	while (retries < maxRetries) {
		try {
			const res = await uploadChunk(params);
			if (res.code === HttpStatus.SUCCESS) {
				return res;
			} else {
				throw new Error('分片上传失败');
			}
		} catch {
			retries++;
			if (retries >= maxRetries) {
				throw new Error('分片上传失败');
			}
			await new Promise(resolve => setTimeout(resolve, retryDelay));
		}
	}
};
```

可以看到，对于我们需要上传的每个分片（可能是全部分片，也可能是剩余的分片）创建了一个异步上传方法（放入限定次数的循环中，即重传机制），然后利用 `Promise.all` 等待所有请求完成，发送合并请求。获取请求进度可以使用回调来更新进度。<br/>![](/md_images/3.png)

`formData` 类型的请求体中，文件等二进制数据应以 `Blob` 类型传输：

```ts
// react-client\src\utils\file-upload.ts

// 文件分片上传
export const uploadChunk = async (params: IUploadChunkParams) => {
	const formData = new FormData();
	formData.append('chunk', new Blob([params.chunk]));
	formData.append('chunkIndex', params.chunkIndex.toString());
	formData.append('fileHash', params.fileHash);
	formData.append('extname', params.extname);
	const res = await request('/file/upload', {
		method: 'POST',
		body: formData
	});
	return res;
};
```

**后端：**

```ts
// nest-server\src\app.controller.ts

  @Post('/upload')
  @UseInterceptors(
    FileInterceptor('chunk', {
      limits: {
        fileSize: 1024 * 1024 * 10,
      },
    }),
  )
  uploadChunk(
    @UploadedFile() chunk: Express.Multer.File,
    @Body() chunkInfo: IUploadChunk,
  ) {
    return this.appService.uploadChunk(chunk, chunkInfo);
  }
```

注意：因为我们的文件分片信息存放在 `formData` 类型的请求体中，因此要借助 `FileInterceptor` 中间件来处理文件上传，并将上传的文件和相关的分片信息传递给 `appService` 中的 `uploadChunk` 方法进行进一步处理。

```ts
// nest-server\src\app.service.ts

  async uploadChunk(chunk: Express.Multer.File, chunkInfo: any): Promise<any> {
    const { fileHash, chunkIndex, extname } = chunkInfo;

    const fileSuffix = getFileSuffixByName(extname);
    const dirPath = join(process.cwd(), `/uploads/${fileSuffix}/${fileHash}`);
    const chunkPath = join(dirPath, `chunk-${chunkIndex}`);

    try {
      const hasDir = await fs
        .access(dirPath)
        .then(() => true)
        .catch(() => false);

      if (!hasDir) {
        await fs.mkdir(dirPath, { recursive: true });
      }

      await fs.writeFile(chunkPath, chunk.buffer);

      return respHttp(HttpStatus.SUCCESS, null, '上传分片成功');
    } catch (error) {
      console.error(error);
      return respHttp(HttpStatus.FAIL, null, '上传分片失败');
    }
  }
```

## 3.3 合并分片

这个过程主要由后端完成：

```ts
// nest-server\src\app.service.ts

  async mergeFile(fileHash: string, extname: string) {
    const fileSuffix = getFileSuffixByName(extname);
    const dirPath = join(process.cwd(), `/uploads/${fileSuffix}/${fileHash}`);
    const filePath = dirPath + '.' + extname;
    const fileDBPath = `/uploads/${fileSuffix}/${fileHash}.${extname}`;

    try {
      // 检查文件是否已存在
      await fs.promises.access(filePath);
      const data = {
        neededFileList: [],
        message: '该文件已被上传',
        filePath: fileDBPath,
      };
      return respHttp(HttpStatus.FILE_EXIST, data);
    } catch (error) {
      // 文件不存在，继续执行
    }

    // 创建写入流
    const writeStream = fs.createWriteStream(filePath);

    // 读取文件夹，将文件夹中的所有分块进行合并
    try {
      const files = await fs.promises.readdir(dirPath);

      // 对文件进行排序
      files.sort((a, b) => {
        const indexA = parseInt(a.split('-').pop());
        const indexB = parseInt(b.split('-').pop());
        return indexA - indexB;
      });

      // 按顺序写入/合并
      for (let index = 0; index < files.length; index++) {
        const filename = files[index];
        const curFilePath = join(dirPath, filename);
        const readStream = fs.createReadStream(curFilePath);

        // 判断是否是最后一块
        const isLastChunk = index === files.length - 1;

        // 使用 await 确保异步操作完成
        await new Promise((resolve, reject) => {
          readStream.pipe(writeStream, { end: isLastChunk });
          readStream.on('end', resolve);
          readStream.on('error', reject);
        });
      }
    } catch (error) {
      console.error('Error reading directory:', error);
      return respHttp(HttpStatus.FAIL, null, '文件合并失败');
    }

    // 删除保存分块的文件夹
    try {
      await this.removeDir(dirPath);
    } catch (error) {
      console.error('Error removing directory:', error);
    }
    return respHttp(
      HttpStatus.SUCCESS,
      {
        filePath: fileDBPath,
      },
      '文件合并成功',
    );
  }

  async removeDir(dirPath: string) {
    try {
      const files = await fs.promises.readdir(dirPath);
      await Promise.all(
        files.map((file) => fs.promises.unlink(join(dirPath, file))),
      );
      await fs.promises.rmdir(dirPath);
      console.log('Folder deleted successfully');
    } catch (error) {
      console.error('Error deleting folder:', error);
      throw error;
    }
  }
```

可以看到，文件上传成功：

![](/md_images/4.png)

![](/md_images/5.png)
