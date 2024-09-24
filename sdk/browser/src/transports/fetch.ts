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
      headers: options.headers, // 请求头配置 例如身份认证、内容类型
      /**
       * 这里解释了 keepalive 的用途以及它在浏览器中的限制
       *
       * 背景：
       *    当用户从一个页面导航到另一个页面时，浏览器通常会取消正在进行的请求。
       *    这会导致类似 TypeError: Failed to fetch 的错误，并且发送事件的网络请求会被中断，无法完成数据的传输。
       *    这在 Chrome 中的表现为请求状态为“已取消”（cancelled）。
       *    Sentry 经常在用户完成页面切换（如导航结束时）发送事件，因此需要确保在页面跳转或关闭时，仍能成功发送数据。
       * 用途：
       *    keepalive 使请求在页面关闭或导航时保持活动状态，即使浏览器正在跳转到新页面，该请求也会被保持直至完成，避免请求被取消，这就是 keepalive 的用途。
       *
       * 限制：
       *  - keepalive 不是所有浏览器都支持，Firefox 就不支持该选项。这意味着在 Firefox 中，页面导航时的请求可能会被取消。
       *  - 根据 Fetch API 规范（参考），当请求的内容长度加上当前进行中的 keepalive 请求大小超过 64 KiB 时，
       *  浏览器会返回一个网络错误（network error）。因此，如果请求的体积较大，keepalive 会失效。
       *  代码中通过检查 pendingBodySize <= 60_000 来限制请求体积，确保不会超出浏览器限制
       *  - 浏览器还对 keepalive 请求的并发数有一定限制，通常不能同时发送太多请求。
       *  为了避免这个问题，代码中将 pendingCount 限制为 15，即同一时间最多允许 15 个请求处于 keepalive 状态。
       *
       * See https://github.com/getsentry/sentry-javascript/pull/7553 for details
       */
      keepalive: pendingBodySize <= 60_000 && pendingCount < 15,
      ...options.fetchOptions,
    };

    // 如果原生不支持 fetch
    if (!nativeFetch) {
      // 清除 fetch 缓存
      clearCachedImplementation('fetch');
      // 返回一个 拒绝的 promise
      return rejectedSyncPromise('No fetch implementation available');
    }

    // 说明原生fetch 可用
    try {
      debugger;
      // 使用fetch 发送post请求
      return nativeFetch(options.url, requestOptions).then((response) => {
        // 请求完成后更新 请求体大小和请求数
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
      // 如果发送请求的过程中发生错误，清除缓存的 fetch 实现
      clearCachedImplementation('fetch');

      // 更新信息
      pendingBodySize -= requestSize;
      pendingCount--;
      // 返回一个拒绝的promise
      return rejectedSyncPromise(e);
    }
  }

  // 返回一个 transport
  return createTransport(options, makeRequest);
}
