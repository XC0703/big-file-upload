import {
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { AppService } from './app.service';
import { FileInterceptor } from '@nestjs/platform-express';

interface IVerifyFile {
  fileHash: string;
  totalCount: number;
  extname: string;
}
interface IUploadChunk {
  fileHash: string;
  chunkIndex: number;
}
interface IMergeFile {
  fileHash: string;
  extname: string;
}

@Controller('/api/file')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Post('/verify')
  verifyFile(@Body() fileInfo: IVerifyFile) {
    const { fileHash, totalCount, extname } = fileInfo;
    return this.appService.verifyFile(fileHash, totalCount, extname);
  }

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

  @Post('/merge')
  mergeFile(@Body() fileInfo: IMergeFile) {
    const { fileHash, extname } = fileInfo;
    return this.appService.mergeFile(fileHash, extname);
  }
}
