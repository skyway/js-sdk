import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
} from 'axios';

import { Logger } from './logger';

const log = new Logger('packages/common/src/http.ts');

/**@internal */
export class HttpClient {
  api: AxiosInstance;

  constructor(baseURL: string) {
    this.api = axios.create({ baseURL });
  }

  /**@throws {@link HttpResponse} */
  async get<T extends unknown>(
    url: string,
    config?:
      | (AxiosRequestConfig<any> & {
          retry?: (err: HttpResponse) => Promise<boolean>;
        })
      | undefined
  ): Promise<T> {
    const res = await this.api
      .get<T>(url, config)
      .catch((err) => err as AxiosError);

    if (axios.isAxiosError(res)) {
      const error = { ...res.response, message: res.message } as HttpResponse;
      if (config?.retry) {
        const retry = await config.retry(error);
        if (retry) {
          log.warn('retry get', { url });
          return this.get(url, config);
        } else {
          log.warn('retry get failed', { url });
          throw error;
        }
      }
      log.warn('response error', { error });
      throw error;
    } else {
      return res.data;
    }
  }

  /**@throws {@link HttpResponse} */
  async post<T extends unknown>(
    url: string,
    data?: any,
    config?:
      | (AxiosRequestConfig<any> & {
          retry?: (err: HttpResponse) => Promise<boolean>;
        })
      | undefined
  ): Promise<T> {
    const res = await this.api
      .post<T>(url, data, config)
      .catch((err) => err as AxiosError);

    if (axios.isAxiosError(res)) {
      const error = {
        data: res.response?.data,
        status: res.response?.status,
        statusText: res.response?.statusText,
        message: res.message,
      } as HttpResponse;
      log.warn('error received', error);

      if (config?.retry) {
        const needRetry = await config.retry(error);
        if (needRetry) {
          log.warn('retry post', url, { data, error, needRetry });
          return this.post(url, data, config);
        } else {
          throw error;
        }
      }

      throw error;
    } else {
      return res.data;
    }
  }

  /**@throws {@link HttpResponse} */
  async put<T extends unknown>(
    url: string,
    data?: any,
    config?:
      | (AxiosRequestConfig<any> & {
          retry?: (err: HttpResponse) => Promise<boolean>;
        })
      | undefined
  ): Promise<T> {
    const res = await this.api
      .put<T>(url, data, config)
      .catch((err) => err as AxiosError);

    if (axios.isAxiosError(res)) {
      const error = { ...res.response, message: res.message } as HttpResponse;
      if (config?.retry) {
        const retry = await config.retry(error);
        if (retry) {
          log.warn('retry put', { url, data });
          return this.put(url, data, config);
        } else {
          log.warn('retry put failed', { url, data });
          throw error;
        }
      }
      log.warn('response error', { error });
      throw error;
    } else {
      return res.data;
    }
  }

  /**@throws {@link HttpResponse} */
  async delete<T extends unknown>(
    url: string,
    config?:
      | (AxiosRequestConfig<any> & {
          retry?: (err: HttpResponse) => Promise<boolean>;
        })
      | undefined
  ): Promise<T> {
    const res = await this.api
      .delete<T>(url, config)
      .catch((err) => err as AxiosError);

    if (axios.isAxiosError(res)) {
      const error = { ...res.response, message: res.message } as HttpResponse;
      if (config?.retry) {
        const retry = await config.retry(error);
        if (retry) {
          log.warn('retry delete', { url });
          return this.delete(url, config);
        } else {
          log.warn('retry delete failed', { url });
          throw error;
        }
      }
      log.warn('response error', { error });
      throw error;
    } else {
      return res.data;
    }
  }
}

/**@internal */
export type HttpResponse = AxiosResponse & { message: string };
