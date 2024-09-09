import type {
  Transport,
  TransportMakeRequestResponse,
  TransportRequest,
} from '@xigua-monitor/types';
import {
  clearCachedImplementation,
  getNativeImplementation,
} from '@xigua-monitor/browser-utils';
import { createTransport } from '@xigua-monitor/core';

import { rejectedSyncPromise } from '@xigua-monitor/utils';
import type { WINDOW } from '../helpers';

import type { BrowserTransportOptions } from './types';

/**
 * 这个哈数基于 Fetch API 实现的 Sentry 传输机制，主要用于将事件发送到 Sentry 的服务器
 *
 * @param options 传输的配置选项
 * @param nativeFetch 浏览器原生的 fetch
 * @returns
 */
export function makeFetchTransport(
  options: BrowserTransportOptions,
  nativeFetch: typeof WINDOW.fetch | undefined = getNativeImplementation(
    'fetch',
  ),
): Transport {
  /** 当前未完成请求的总大小,用于判断是否可以使用 keepalive 属性 */
  let pendingBodySize = 0;
  /** 当前未完成请求的数量，同样用于限制并发请求 */
  let pendingCount = 0;

  /**
   * 发送请求的核心逻辑，负责组装请求并发送
   *
   * @param request 包含了需要发送的事件数据
   * @returns
   */
  function makeRequest(
    request: TransportRequest,
  ): PromiseLike<TransportMakeRequestResponse> {
    /**
     * 在每个请求开始时，更新 pendingBodySize 和 pendingCount，以便后续判断是否能使用 keepalive 属性。
     */
    const requestSize = request.body.length;
    pendingBodySize += requestSize;
    pendingCount++;

    const requestOptions: RequestInit = {
      body: request.body, // 要发送的事件内容
      method: 'POST',
      referrerPolicy: 'origin', // 只发送页面的源信息作为引用
      headers: options.headers,
      // Outgoing requests are usually cancelled when navigating to a different page, causing a "TypeError: Failed to
      // fetch" error and sending a "network_error" client-outcome - in Chrome, the request status shows "(cancelled)".
      // The `keepalive` flag keeps outgoing requests alive, even when switching pages. We want this since we're
      // frequently sending events right before the user is switching pages (eg. whenfinishing navigation transactions).
      // Gotchas:
      // - `keepalive` isn't supported by Firefox
      // - As per spec (https://fetch.spec.whatwg.org/#http-network-or-cache-fetch):
      //   If the sum of contentLength and inflightKeepaliveBytes is greater than 64 kibibytes, then return a network error.
      //   We will therefore only activate the flag when we're below that limit.
      // There is also a limit of requests that can be open at the same time, so we also limit this to 15
      // See https://github.com/getsentry/sentry-javascript/pull/7553 for details
      keepalive: pendingBodySize <= 60_000 && pendingCount < 15,
      ...options.fetchOptions,
    };

    if (!nativeFetch) {
      clearCachedImplementation('fetch');
      return rejectedSyncPromise('No fetch implementation available');
    }

    try {
      return nativeFetch(options.url, requestOptions).then((response) => {
        pendingBodySize -= requestSize;
        pendingCount--;
        return {
          statusCode: response.status,
          headers: {
            'x-sentry-rate-limits': response.headers.get(
              'X-Sentry-Rate-Limits',
            ),
            'retry-after': response.headers.get('Retry-After'),
          },
        };
      });
    } catch (e) {
      clearCachedImplementation('fetch');
      pendingBodySize -= requestSize;
      pendingCount--;
      return rejectedSyncPromise(e);
    }
  }

  return createTransport(options, makeRequest);
}
