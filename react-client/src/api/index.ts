import { IVertifyParams, IVertifyRes, IUploadChunkParams, IMergeFileParams } from '@/api/type';
import request from '@/utils/request';

// 验证上传的文件状态
export const vertifyFile = async (params: IVertifyParams) => {
	const res = await request<IVertifyRes, IVertifyParams>('/file/verify', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: params
	});
	return res;
};

// 文件分片上传
export const uploadChunk = async (params: IUploadChunkParams) => {
	const formData = new FormData();
	formData.append('chunk', new Blob([params.chunk]));
	formData.append('chunkIndex', params.chunkIndex.toString());
	formData.append('fileHash', params.fileHash);
	const res = await request('/file/upload', {
		method: 'POST',
		body: formData
	});
	return res;
};

// 文件合并
export const mergeFile = async (params: IMergeFileParams) => {
	const res = await request('/file/merge', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: params
	});
	return res;
};
