import styles from './index.module.less';

import BigFileUpload from '@/components/BigFileUpload';

const ContainerComponent = () => {
	return (
		<div className={styles.containerBox}>
			<BigFileUpload />
		</div>
	);
};

export default ContainerComponent;
