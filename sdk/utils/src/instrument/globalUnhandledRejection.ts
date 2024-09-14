/* eslint-disable @typescript-eslint/no-explicit-any */

import type { HandlerDataUnhandledRejection } from '@xigua-monitor/types';

import { GLOBAL_OBJ } from '../worldwide';
import { addHandler, maybeInstrument, triggerHandlers } from './handlers';

/** 用于保存原来的全局未处理拒绝处理程序，这里的逻辑和 onerror基本类似 */
let _oldOnUnhandledRejectionHandler:
  | (typeof GLOBAL_OBJ)['onunhandledrejection']
  | null = null;

/**
 * 这个函数目的是在全局处理未处理的 Promise 拒绝时进行插桩，从而实现错误监控。
 *
 * 只在内部使用
 * @hidden
 */
export function addGlobalUnhandledRejectionInstrumentationHandler(
  handler: (data: HandlerDataUnhandledRejection) => void,
): void {
  // 用于处理捕获到的未处理拒绝事件
  const type = 'unhandledrejection';
  addHandler(type, handler);
  maybeInstrument(type, instrumentUnhandledRejection);
}

/**
 * 实际进行插桩的函数
 *
 * @link {instrumentError}
 */
function instrumentUnhandledRejection(): void {
  // 保存当前的全局未处理拒绝处理程序，以便在需要时调用。
  _oldOnUnhandledRejectionHandler = GLOBAL_OBJ.onunhandledrejection;

  //  将全局的未处理拒绝处理程序替换为一个新的函数，以便进行监控：
  GLOBAL_OBJ.onunhandledrejection = function (e: any): boolean {
    // 将事件数据赋值给 handlerData
    const handlerData: HandlerDataUnhandledRejection = e;

    // 调用已注册的处理程序，传入捕获的数据
    triggerHandlers('unhandledrejection', handlerData);

    // 检查原有的处理程序 是否存在且不是由 Sentry 插桩的
    if (
      _oldOnUnhandledRejectionHandler &&
      !_oldOnUnhandledRejectionHandler.__SENTRY_LOADER__
    ) {
      // eslint-disable-next-line prefer-rest-params
      // 调用原有的处理程序以确保原有逻辑不受影响
      return _oldOnUnhandledRejectionHandler.apply(this, arguments);
    }

    // 返回 true，表示处理已经完成
    return true;
  };

  // 标记当前的未处理拒绝处理程序已经被 Sentry 插桩。这可以帮助后续的逻辑判断这个处理程序的来源
  GLOBAL_OBJ.onunhandledrejection.__SENTRY_INSTRUMENTED__ = true;
}
