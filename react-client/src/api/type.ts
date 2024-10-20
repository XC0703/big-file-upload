// 验证上传的文件状态接口请求参数
export interface IVertifyParams {
	// 文件Hash
	fileHash: string;
	// 文件总片数
	totalCount: number;
	// 文件后缀名
	extname: string;
}

// 验证上传的文件状态接口返回参数
export interface IVertifyRes {
	// 需要上传的分片序列
	neededFileList: number[];
	// 消息
	message: string;
}

// 文件分片上传接口请求参数
export interface IUploadChunkParams {
	// 文件分片
	chunk: ArrayBuffer;
	// 当前分片序号
	chunkIndex: number;
	// 文件Hash
	fileHash: string;
}

// 通知后端合并文件接口请求参数
export interface IMergeFileParams {
	// 文件Hash
	fileHash: string;
	// 文件后缀名
	extname: string;
}
