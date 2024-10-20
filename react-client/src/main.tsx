import React from 'react';
import ReactDOM from 'react-dom/client';

import Home from '@/pages/home';
import '@/assets/styles/global.less';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
	<React.Fragment>
		<Home></Home>
	</React.Fragment>
);
