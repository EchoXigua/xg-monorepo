import type { HandlerDataHistory } from '@xigua-monitor/types';
import {
  addHandler,
  fill,
  maybeInstrument,
  supportsHistory,
  triggerHandlers,
} from '@xigua-monitor/utils';
import { WINDOW } from '../types';

let lastHref: string | undefined;

/**
 * 为 fetch 请求添加一个拦截器，当 fetch 请求开始和结束时，这个拦截器函数（handler）会被调用。
 * 这个 handler 会接收到一些与 fetch 请求相关的数据
 * 通过检查传入数据中的 endTimestamp 字段，可以区分拦截器函数是在处理开始还是结束的事件。
 *
 * 这个功能是为内部使用而设计的，意味着它可能不会被公开或提供给外部开发者使用
 *
 * 拦截 fetch 请求对于很多场景都非常有用，比如:
 * - 可以记录每个 fetch 请求的开始和结束时间，从而计算出请求的耗时
 * - 可以捕捉 fetch 请求中的错误（如网络错误、服务器错误等），并记录这些错误以供分析
 * - 可以统计应用发起的 API 请求频率、失败率等，以此来分析应用的网络性能和稳定性
 *
 * @hidden
 */
export function addHistoryInstrumentationHandler(
  handler: (data: HandlerDataHistory) => void,
): void {
  const type = 'history';
  // 给 history 注册一个处理函数
  addHandler(type, handler);
  // 确保 instrumentHistory 函数只会在第一次调用时执行。
  maybeInstrument(type, instrumentHistory);
}

/**
 * 这个函数为浏览器的 history API 添加了拦截器
 *
 * @returns
 */
function instrumentHistory(): void {
  // 检查当前环境是否支持 history API
  if (!supportsHistory()) {
    return;
  }

  // 保存一份原始的 onpopstate
  const oldOnPopState = WINDOW.onpopstate;

  // 重写 onpopstate
  // onpopstate 是一个在用户点击浏览器的后退或前进按钮时触发的事件。
  WINDOW.onpopstate = function (this: WindowEventHandlers, ...args: unknown[]) {
    const to = WINDOW.location.href;
    // 跟踪当前的URL状态，因为我们总是只接收更新后的状态
    const from = lastHref;
    lastHref = to;
    const handlerData: HandlerDataHistory = { from, to };
    // 触发 history 事件,会去执行先前注册的history 对应的 处理函数
    triggerHandlers('history', handlerData);

    // 执行完成后,再去执行原始的 oldOnPopState
    if (oldOnPopState) {
      // Apparently this can throw in Firefox when incorrectly implemented plugin is installed.
      // https://github.com/getsentry/sentry-javascript/issues/3344
      // https://github.com/bugsnag/bugsnag-js/issues/469
      try {
        return oldOnPopState.apply(this, args);
      } catch (_oO) {
        // no-empty
      }
    }
  };

  /**
   * 是一个高阶函数，它返回一个新的函数来替代原始的历史方法。
   * @param originalHistoryFunction 原始的 pushState 或 replaceState 函数
   * @returns
   */
  function historyReplacementFunction(
    originalHistoryFunction: () => void,
  ): () => void {
    return function (this: History, ...args: unknown[]): void {
      //  这行代码的目的是检查传递给 pushState 或 replaceState 的第三个参数，它是新的 URL。
      const url = args.length > 2 ? args[2] : undefined;
      if (url) {
        // coerce to string (this is what pushState does)
        // 将当前的 URL 存储在 from 中
        const from = lastHref;
        // 将新url 存储在 to 中
        const to = String(url);

        // 更新全局变量 lastHref 为新 URL
        lastHref = to;
        const handlerData: HandlerDataHistory = { from, to };
        // 触发 history 事件
        triggerHandlers('history', handlerData);
      }

      // 调用原始的 pushState 或 replaceState
      return originalHistoryFunction.apply(this, args);
    };
  }

  // 拦截 pushState 和 replaceState 方法：
  fill(WINDOW.history, 'pushState', historyReplacementFunction);
  fill(WINDOW.history, 'replaceState', historyReplacementFunction);
}
