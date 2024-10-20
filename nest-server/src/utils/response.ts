// 应该用响应拦截器实现相同的效果：https://juejin.cn/post/7426978989044809782#heading-32
// 此处为了节省时间，直接使用函数实现

export const respHttp = (respCode: number, data?: any, message?: string) => {
  const resp = {
    code: respCode,
    data: data || {},
    message: message || '',
  };
  return resp;
};
