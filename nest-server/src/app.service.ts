import { Injectable } from '@nestjs/common';
import * as fs from 'fs-extra';
import { join } from 'path';
import { respHttp } from './utils/response';
import { HttpStatus } from './utils/constant';
import { getFileSuffixByName } from './utils/general';

@Injectable()
export class AppService {
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
}
