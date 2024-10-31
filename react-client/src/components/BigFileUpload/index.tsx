import styles from './index.module.less';

import { uploadFile } from '@/utils/file-upload';

const BigFileUpload = () => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const onProgress = (progress: number) => {
		console.log(`上传进度：${progress}%`);
	};
	const getFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
		if (e.target.files!.length > 0) {
			const file = e.target.files![0];
			if (file.size > 1024 * 1024 * 1024 * 5) {
				alert('文件过大，不能超过5GB');
				return;
			}
			const res = await uploadFile(file, 5, 3, 1000, onProgress);
			console.log(res);
		}
	};
	return (
		<div className={styles.BigFileUpload}>
			<input
				type="file"
				accept="*"
				onChange={e => {
					getFile(e);
				}}
			/>
		</div>
	);
};

export default BigFileUpload;
