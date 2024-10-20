import styles from './index.module.less';

import { uploadFile } from '@/utils/file-upload';

const BigFileUpload = () => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const onProgress = (progress: number) => {
		console.log(`上传进度：${progress}%`);
	};
	const getFile = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (e.target.files!.length > 0) {
			const file = e.target.files![0];
			uploadFile(file, 5, onProgress);
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
