import type { AxiosInstance } from 'axios';

type RequestOption = {
  acceptError: boolean;
  raw: boolean;
};

type SendOption = {
  method: string;
  url: string;
  data: any;
  option: Partial<RequestOption>;
};

export class RequestError {
  static token = new RequestError(401, '登录过期，请重新登陆');
  static notfound = new RequestError(404, '请求数据未找到');
  static network = new RequestError(-6, '无法连接到服务器');
  static response = new RequestError(-5, '后台数据格式错误');

  constructor(
    public code = 0,
    public message = '',
  ) {}

  equal(err: RequestError) {
    return err.code === this.code && err.message === this.message;
  }
}

export class XGRequest {
  static errorAlert: (error: RequestError) => void = () => {};
  static authDeal: (error: RequestError) => void = () => {};
  static handleHearder: () => { headers: {} } = () => {
    return { headers: {} };
  };

  constructor(
    public baseUrl: string,
    public axios: AxiosInstance,
  ) {}

  private send(options: SendOption) {
    let data: any;
    let params: any;
    if (['get', 'delete'].includes(options.method)) {
      params = options.data;
    }

    if (['post', 'patch'].includes(options.method)) {
      data = options.data;
    }

    const p = Promise.resolve().then(() => {
      return this.axios({
        method: options.method,
        // headers: {
        //   //   access_token: option.token || '',
        // },
        ...XGRequest.handleHearder(),
        data,
        params,
        url: `${this.baseUrl}/${options.url}`.replace(/\/\//g, '/'),
      });
    });
    return this.handleError(p, options.option);
  }

  private handleError(res: Promise<any>, opt: Partial<RequestOption>) {
    return opt.raw
      ? res
      : res
          .then((response) => {
            const result = this.handleResponse(response);
            if (result instanceof RequestError) {
              throw result;
            } else {
              return result;
            }
          })
          .catch((err) => {
            let error: RequestError;
            if (err instanceof RequestError) {
              error = err;
            } else {
              error = this.handleResponse(err.response);
            }

            if (!opt.acceptError) {
              XGRequest.errorAlert(err);
              if (RequestError.token.equal(error)) {
                XGRequest.authDeal(error);
              }
            }

            return Promise.reject(err);
          });
  }

  private handleResponse(res: any) {
    const { data } = res;

    if (data && data.success) {
      return data.result;
    } else if (data && !data.success && data.code === 404) {
      return RequestError.notfound;
    } else if (data && !data.success && data.code === 401) {
      return RequestError.token;
    } else if (data) {
      return new RequestError(data.code, data.message);
    } else {
      return RequestError.response;
    }
  }

  get(url: string, data: any = {}, option: Partial<RequestOption> = {}) {
    return this.send({ method: 'get', url, data, option });
  }
  post(url: string, data: any = {}, option: Partial<RequestOption> = {}) {
    return this.send({ method: 'post', url, data, option });
  }
  delete(url: string, data: any = {}, option: Partial<RequestOption> = {}) {
    return this.send({ method: 'delete', url, data, option });
  }
  patch(url: string, data: any = {}, option: Partial<RequestOption> = {}) {
    return this.send({ method: 'patch', url, data, option });
  }
}
