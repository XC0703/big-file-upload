import { vertifyFile, uploadChunk, mergeFile } from '@/api';
import { HttpStatus } from '@/utils/constant';

/**
 * 分片上传：
 * 1. 将文件进行分片并计算Hash值：得到 allChunkList---所有分片，fileHash---文件的hash值
 * 2. 通过fileHash请求服务端，判断文件上传状态，得到 neededFileList---待上传文件分片
 * 3. 同步上传进度，针对不同文件上传状态调用 progress_cb
 * 4. 发送上传请求
 * 5. 发送文件合并请求
 * @param {File} file 目标上传文件
 * @param {number} baseChunkSize 上传分块大小，单位Mb
 * @param {Function} progress_cb 更新上传进度的回调函数
 * @returns {Promise}
 */

export async function uploadFile(
	file: File,
	baseChunkSize: number,
	progress_cb: (progress: number) => void
): Promise<void> {
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
				handleFile(file, progress_cb, chunkList, fileHash);
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
}

async function handleFile(
	file: File,
	progress_cb: (progress: number) => void,
	chunkList: ArrayBuffer[],
	fileHash: string
) {
	const filename = file.name;
	// 所有分片 ArrayBuffer[]
	const allChunkList = chunkList;
	// 需要上传的分片序列 number[]
	let neededChunkList: number[] = [];
	// 上传进度
	let progress = 0;
	// 发送请求,获取文件上传状态
	try {
		const params = {
			fileHash,
			totalCount: allChunkList.length,
			extname: filename.split('.')[1]
		};
		const res = await vertifyFile(params);
		if (res.code === HttpStatus.SUCCESS) {
			const { neededFileList, message } = res.data;
			if (message) {
				console.info(message);
			}
			// 无待上传文件，秒传
			if (!neededFileList.length) {
				return;
			}

			// 部分上传成功，更新unUploadChunkList
			neededChunkList = neededFileList;
		} else {
			console.error('获取文件上传状态失败');
		}
	} catch {
		console.error('获取文件上传状态失败');
	}

	// 同步上传进度，断点续传情况下
	progress = ((allChunkList.length - neededChunkList.length) / allChunkList.length) * 100;
	// 上传
	if (allChunkList.length) {
		// 为每个需要上传的分片发送请求
		const requestList = allChunkList.map(async (chunk: ArrayBuffer, index: number) => {
			if (neededChunkList.includes(index + 1)) {
				const params = {
					chunk,
					chunkIndex: index + 1,
					fileHash
				};
				try {
					const res = await uploadChunk(params);
					if (res.code === HttpStatus.SUCCESS) {
						// 更新进度
						progress += Math.ceil(100 / allChunkList.length);
						if (progress >= 100) progress = 100;
						progress_cb(progress);
						return Promise.resolve();
					} else {
						return Promise.reject('上传失败');
					}
				} catch {
					return Promise.reject('上传失败');
				}
			}
		});
		// 等待所有请求完成，发送合并请求
		Promise.all(requestList).then(async () => {
			const params = {
				fileHash,
				extname: filename.split('.')[1]
			};
			try {
				const res = await mergeFile(params);
				if (res.code === HttpStatus.SUCCESS) {
					console.info('文件合并成功');
				} else {
					console.error('文件合并失败');
				}
			} catch {
				console.error('文件合并失败');
			}
		});
	}
}

// /**
//  * 文件分片 & Hash计算
//  * @param {File} targetFile 目标上传文件
//  * @param {number} baseChunkSize 上传分块大小，单位Mb
//  * @returns {chunkList:ArrayBuffer,fileHash:string}
//  */
// async function sliceFile(
// 	targetFile: File,
// 	baseChunkSize: number
// ): Promise<{ chunkList: ArrayBuffer[]; fileHash: string }> {
// 	return new Promise((resolve, reject) => {
// 		// 初始化分片方法，兼容问题
// 		const blobSlice = File.prototype.slice;
// 		// 分片大小 baseChunkSize Mb
// 		const chunkSize = baseChunkSize * 1024 * 1024;
// 		// 分片数
// 		const targetChunkCount = targetFile && Math.ceil(targetFile.size / chunkSize);
// 		// 当前已执行分片数
// 		let currentChunkCount = 0;
// 		// 当前以收集的分片
// 		const chunkList: ArrayBuffer[] = [];
// 		// 创建sparkMD5对象
// 		const spark = new SparkMD5.ArrayBuffer();
// 		// 创建文件读取对象
// 		const fileReader = new FileReader();
// 		// 文件hash
// 		let fileHash = null;

// 		// FilerReader onload事件
// 		fileReader.onload = e => {
// 			// 当前读取的分块结果 ArrayBuffer
// 			const curChunk = e.target?.result as ArrayBuffer;
// 			// 将当前分块追加到spark对象中
// 			spark.append(curChunk);
// 			currentChunkCount++;
// 			chunkList.push(curChunk);
// 			// 判断分块是否全部读取成功
// 			if (currentChunkCount >= targetChunkCount) {
// 				// 全部读取，获取文件hash
// 				fileHash = spark.end();
// 				resolve({ chunkList, fileHash });
// 			} else {
// 				loadNext();
// 			}
// 		};

// 		// FilerReader onerror事件
// 		fileReader.onerror = () => {
// 			reject(null);
// 		};

// 		// 读取下一个分块
// 		const loadNext = () => {
// 			// 计算分片的起始位置和终止位置
// 			const start = chunkSize * currentChunkCount;
// 			let end = start + chunkSize;
// 			if (end > targetFile.size) {
// 				end = targetFile.size;
// 			}
// 			// 读取文件，触发onLoad
// 			fileReader.readAsArrayBuffer(blobSlice.call(targetFile, start, end));
// 		};

// 		loadNext();
// 	});
// }
