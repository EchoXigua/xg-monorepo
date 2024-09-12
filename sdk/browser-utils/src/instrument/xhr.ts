import type {
  HandlerDataXhr,
  SentryWrappedXMLHttpRequest,
  WrappedFunction,
} from '@xigua-monitor/types';

import {
  addHandler,
  fill,
  isString,
  maybeInstrument,
  timestampInSeconds,
  triggerHandlers,
} from '@xigua-monitor/utils';
import { WINDOW } from '../types';

/**
 * 用于在 XHR 对象上存储 Sentry 相关的数据，确保可以通过这个键值访问到 Sentry 的 XHR 数据
 */
export const SENTRY_XHR_DATA_KEY = '__sentry_xhr_v3__';

type WindowWithXhr = Window & { XMLHttpRequest?: typeof XMLHttpRequest };

/**
 * 这个函数主要就是为 xhr 添加一个监控处理函数
 * 这个处理程序在请求开始和结束时被调用
 * 可以通过检查它是否有一个' endTimestamp '来识别
 *
 * Use at your own risk, this might break without changelog notice, only used internally.
 * @hidden
 */
export function addXhrInstrumentationHandler(
  handler: (data: HandlerDataXhr) => void,
): void {
  const type = 'xhr';
  addHandler(type, handler);
  maybeInstrument(type, instrumentXHR);
}

/**
 * 函数的作用是对浏览器的 XMLHttpRequest (XHR) 进行增强，
 * 以便在发送请求和接收响应时收集更多的性能和状态信息。
 *
 * 导出只是为了测试
 */
export function instrumentXHR(): void {
  // 检查当前浏览器是否支持 XMLHttpRequest，如果不支持则直接返回
  if (!(WINDOW as WindowWithXhr).XMLHttpRequest) {
    return;
  }

  // 获取原型对象，以便对其方法进行增强
  const xhrproto = XMLHttpRequest.prototype;

  // 包装 xhr 的原生open 方法，允许我们在打开请求时添加自定义逻辑
  fill(xhrproto, 'open', function (originalOpen: () => void): () => void {
    return function (
      this: XMLHttpRequest & SentryWrappedXMLHttpRequest,
      ...args: unknown[]
    ): void {
      // 获取当前时间戳并乘以 1000（将其转换为毫秒，以便后续计算请求持续时间
      const startTimestamp = timestampInSeconds() * 1000;

      // 解析请求方法以及 url，args[0] 是请求方法（如 GET 或 POST），args[1] 是请求的 URL
      // xhr 的open 总是会最少带两个参数，但是为了安全起见会验证，如果没有方法& url，会退出
      const method = isString(args[0]) ? args[0].toUpperCase() : undefined; // 请求方法转大写（存在）
      const url = parseUrl(args[1]);

      // 请求方法 或者 请求url 不存在 直接调用原生的open方法
      // 在没有有效请求方法和 URL 时不进行增强
      if (!method || !url) {
        return originalOpen.apply(this, args);
      }

      // 在 this（即当前的 XMLHttpRequest 实例）存在请求信息
      this[SENTRY_XHR_DATA_KEY] = {
        method,
        url,
        request_headers: {},
      };

      // 如果请求方法是 POST 且 URL 包含 sentry_key
      // 这表示该请求是 Sentry 内部的请求，不应被捕获和记录
      if (method === 'POST' && url.match(/sentry_key/)) {
        this.__sentry_own_request__ = true;
      }

      /**
       * 定义状态变化处理程序，在 XMLHttpRequest 的 readyState 变化时调用，处理响应状态。
       * @returns
       */
      const onreadystatechangeHandler: () => void = () => {
        // 在这个函数中，this 的上下文与外部函数（即 open 方法的增强函数）中的 this 不同
        //  在 XMLHttpRequest 的上下文中，this 应该指向当前的请求实例，
        // 但因为某种原因，外部和内部的上下文不一致，因此需要特别注意

        // 从当前实例上获取 sentry 存储在 xhr 实例上的数据
        const xhrInfo = this[SENTRY_XHR_DATA_KEY];

        // 如果没有，说明不是同一个 xhr 实例，直接返回
        if (!xhrInfo) {
          return;
        }

        // 状态为 4 表示请求已完成
        if (this.readyState === 4) {
          // 尝试获取响应状态码并存储在 xhrInfo 中
          try {
            // 在某些平台或浏览器中，访问 XMLHttpRequest 的 status 属性可能会抛出异常。
            // 例如，在某些环境中，如果请求尚未完成，尝试访问 status 属性可能会导致运行时错误。
            // 使用 try...catch 块来捕获异常，以防止程序崩溃。
            xhrInfo.status_code = this.status;
          } catch (e) {
            /* do nothing */
          }

          // 构造处理数据
          const handlerData: HandlerDataXhr = {
            endTimestamp: timestampInSeconds() * 1000, // 结束时间
            startTimestamp, // 开始时间
            xhr: this, // xhr 实例
          };

          // 触发 xhr 时间，通知对应的事件处理函数执行
          triggerHandlers('xhr', handlerData);
        }
      };

      // 如果 this 已经定义了 onreadystatechange 属性，并且它是一个函数
      if (
        'onreadystatechange' in this &&
        typeof this.onreadystatechange === 'function'
      ) {
        // 拦截 这个函数
        fill(this, 'onreadystatechange', function (original: WrappedFunction) {
          return function (
            this: SentryWrappedXMLHttpRequest,
            ...readyStateArgs: unknown[]
          ): void {
            // 在调用原生这个函数之前，去执行我们的一些逻辑
            onreadystatechangeHandler();
            return original.apply(this, readyStateArgs);
          };
        });
      } else {
        // 如果没有定义 直接注册状态变化处理函数
        this.addEventListener('readystatechange', onreadystatechangeHandler);
      }

      /**
       * 拦截 send 方法，以便能够访问和记录用户或库定义的请求头
       * 此拦截仅适用于用户或库定义的请求头，而不包括浏览器自动分配的默认请求头（例如 User-Agent）
       * 另外，代码也指出 setRequestHeader 方法无法设置 Cookie 请求头，因为浏览器会自动处理 Cookie，并不会让开发者手动设置。
       */
      fill(this, 'setRequestHeader', function (original: WrappedFunction) {
        return function (
          this: SentryWrappedXMLHttpRequest,
          ...setRequestHeaderArgs: unknown[]
        ): void {
          //  解构出请求头的名称（header）和对应的值（value）
          const [header, value] = setRequestHeaderArgs;

          // 获取存储在当前 xhr 实例身上的 sentry 数据
          const xhrInfo = this[SENTRY_XHR_DATA_KEY];

          // 检查是否存在 Sentry 数据，并确保 header 和 value 是字符串。
          if (xhrInfo && isString(header) && isString(value)) {
            // 将请求头名称（转换为小写）和其值存储到 request_headers 对象中
            // 为了确保请求头的一致性，并方便后续处理
            xhrInfo.request_headers[header.toLowerCase()] = value;
          }

          // 调用原生方法
          return original.apply(this, setRequestHeaderArgs);
        };
      });

      // 调用 xhr 原生的 open 方法
      return originalOpen.apply(this, args);
    };
  });

  // 拦截 send 方法，以便记录发送请求时的一些信息
  fill(xhrproto, 'send', function (originalSend: () => void): () => void {
    return function (
      this: XMLHttpRequest & SentryWrappedXMLHttpRequest,
      ...args: unknown[]
    ): void {
      // 获取存储在当前 xhr 实例身上的 sentry 数据
      const sentryXhrData = this[SENTRY_XHR_DATA_KEY];

      // 如果不存在，说明当前请求不是 Sentry 监控的请求，直接调用 原生的send 方法
      if (!sentryXhrData) {
        return originalSend.apply(this, args);
      }

      // args[0] 通常是请求体，存在的话 将其存储到 sentry body数据中
      if (args[0] !== undefined) {
        sentryXhrData.body = args[0];
      }

      // 构建事件处理数据
      const handlerData: HandlerDataXhr = {
        startTimestamp: timestampInSeconds() * 1000, // 开始时间
        xhr: this, // xhr 实例
      };

      // 处理 xhr 事件， 里面的事件可以通过 endTimestamp 来判断请求的开始还是结束
      triggerHandlers('xhr', handlerData);

      // 调用原生的 send 方法
      return originalSend.apply(this, args);
    };
  });
}

/**
 * 它用于解析给定的 URL 并返回一个字符串形式的完整 URL，或者在解析失败的情况下返回 undefined。
 * @param url
 * @returns
 */
function parseUrl(url: string | unknown): string | undefined {
  // 如果是字符串 直接返回
  if (isString(url)) {
    return url;
  }

  try {
    // 如果 url 是一个有效的 URL 对象，toString() 将返回完整的 URL 字符串
    return (url as URL).toString();
  } catch {} // eslint-disable-line no-empty

  // 如果 url 既不是字符串类型也不能成功转换为 URL，函数将返回 undefined
  return undefined;
}
