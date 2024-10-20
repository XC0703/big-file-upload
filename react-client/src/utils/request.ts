/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 基于fetch封装的请求方法（包含添加拦截器）
 * 介绍博客可见：https://juejin.cn/post/7301947438885191695#heading-20
 */

// 服务端接口的 baseURL
export const apiBaseURL = 'http://127.0.0.1:3000/api';

// 响应类型
interface IApiResponse<TResponse> {
	code: number;
	message: string | '';
	data: TResponse;
}
// 请求类型
interface IRequestOptions<TRequest> {
	method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	headers?: { [key: string]: string };
	body?: TRequest;
}

// 定义拦截器的接口
interface Interceptor<T> {
	onFulfilled?: (value: T) => T | Promise<T>;
	onRejected?: (error: any) => any;
}

// 定义拦截器管理类--用于管理多个拦截器，可以通过use()方法向拦截器数组中添加一个拦截器，可以通过forEach()方法对所有的拦截器进行遍历和执行。
class InterceptorManager<T> {
	private interceptors: Array<Interceptor<T>>;

	constructor() {
		this.interceptors = [];
	}

	use(interceptor: Interceptor<T>) {
		this.interceptors.push(interceptor);
	}

	forEach(fn: (interceptor: Interceptor<T>) => void) {
		this.interceptors.forEach(interceptor => {
			if (interceptor) {
				fn(interceptor);
			}
		});
	}
}

// 添加拦截器的 request 函数
export default async function request<TResponse = any, TRequest = any>(
	url: string,
	options: IRequestOptions<TRequest> = {
		method: 'GET'
	}
): Promise<IApiResponse<TResponse>> {
	const requestInterceptors = new InterceptorManager();
	const responseInterceptors = new InterceptorManager();

	// 定义请求拦截器
	requestInterceptors.use({
		onFulfilled: (options: any) => {
			// console.log('请求拦截器：处理请求');
			options.headers = {
				...options.headers
			};
			// 对于 FormData 类型的 body，不使用 JSON.stringify 序列化，也无需设置 Content-Type
			if (options.body instanceof FormData) {
				options.headers = {
					...options.headers
				};
			} else {
				// 暂时只处理 JSON 类型的 Content-Type，其它类型的 Content-Type 可以自行添加和处理
				options.headers = {
					...options.headers,
					'Content-Type': 'application/json'
				};
				if (options.body) {
					options.body = JSON.stringify(options.body);
				}
			}
			return options;
		},
		onRejected: error => {
			// console.log('请求拦截器：处理错误', error);
			return error;
		}
	});
	requestInterceptors.forEach(async interceptor => {
		options = ((await interceptor.onFulfilled?.(options)) ?? options) as any;
	});

	// 发起请求
	let response = await fetch(apiBaseURL + url, {
		method: options.method,
		headers: options.headers,
		body: options.body as string
	});
	if (!response.ok) {
		throw new Error(`Request failed with status code ${response.status}`);
	}

	// 定义响应拦截器
	responseInterceptors.use({
		onFulfilled: (response: any) => {
			// console.log('响应拦截器：处理响应');
			return response;
		},
		onRejected: error => {
			// console.log('响应拦截器：处理错误', error);
			return error;
		}
	});
	responseInterceptors.forEach(async interceptor => {
		response = (interceptor.onFulfilled?.(response) ?? response) as any;
	});

	return response.json() as Promise<IApiResponse<TResponse>>;
}
