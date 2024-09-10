import type { HandlerDataError } from '@xigua-monitor/types';

import { GLOBAL_OBJ } from '../worldwide';
import { addHandler, maybeInstrument, triggerHandlers } from './handlers';

/**
 * 全局变量，用来保存旧的全局错误处理函数
 * 在替换 window.onerror 之前，先保存旧的处理程序，以便在自定义的错误处理程序执行后仍然调用它。
 */
let _oldOnErrorHandler: (typeof GLOBAL_OBJ)['onerror'] | null = null;

/**
 * 这个函数主要作用是通过在全局范围内捕获 window.onerror 事件，将全局错误传递给指定的处理程序（handler）
 *
 * 这允许我们在应用中监控并捕获所有未处理的全局错误事件，并将这些错误数据发送到 Sentry 等错误追踪系统中
 * 这个函数只在内部使用
 * @hidden
 */
export function addGlobalErrorInstrumentationHandler(
  handler: (data: HandlerDataError) => void,
): void {
  const type = 'error';
  addHandler(type, handler);
  maybeInstrument(type, instrumentError);
}

/**
 * "插桩"（Instrumentation）是软件工程中的一个术语，指的是在程序运行过程中插入一些额外的代码，
 * 以便收集程序的行为数据，比如日志、性能分析、错误跟踪等。
 * 插桩的代码通常不会改变程序的核心逻辑，它的作用是监控和记录程序的运行情况。
 *
 * instrumentError 通过重新定义 window.onerror 来插入一段新的错误处理逻辑，从而监控和捕获全局错误。
 * 它还保留了原有的错误处理程序，确保旧的逻辑不会受到影响，这正是插桩的典型应用场景——在原有逻辑中增加新的功能，而不改变原有逻辑的行为。
 */

/**
 * 捕获全局的 JavaScript 错误，并将这些错误信息发送到自定义的处理函数进行进一步处理。
 * 这个函数修改了全局的 window.onerror，使得任何页面上的 JavaScript 错误都可以被自动捕获。
 */
function instrumentError(): void {
  // 在覆盖全局的 window.onerror 处理程序之前，
  // 先将现有的 onerror 函数保存在 _oldOnErrorHandler 中
  // 如果应用中已经有其他错误处理程序，这样可以在自定义的处理程序执行后，
  // 调用原有的处理逻辑，不会影响已有的错误处理机制。
  _oldOnErrorHandler = GLOBAL_OBJ.onerror;

  /** 覆盖全局错误处理函数 */
  GLOBAL_OBJ.onerror = function (
    msg: string | object, // 错误消息，或者是对象
    url?: string, // 发生错误的脚本的 URL
    line?: number, // 错误发生的行号
    column?: number, // 错误发生的列号
    error?: Error, // 一个 Error 对象，包含详细的错误信息
  ): boolean {
    // 构造错误数据
    const handlerData: HandlerDataError = {
      column,
      error,
      line,
      msg,
      url,
    };

    // 触发自定义的错误处理程序
    // 这里就去会执行 addHandler(type, handler) 中对应的 handler
    triggerHandlers('error', handlerData);

    // 在新的错误处理程序执行完毕后，检查是否存在旧的 window.onerror 处理程序
    // 如果存在且它不是 Sentry 内部的加载器（通过 __SENTRY_LOADER__ 属性判断），
    // 则执行旧的处理逻辑，确保不会破坏原有的应用错误处理行为。
    if (_oldOnErrorHandler && !_oldOnErrorHandler.__SENTRY_LOADER__) {
      // eslint-disable-next-line prefer-rest-params
      return _oldOnErrorHandler.apply(this, arguments);
    }

    // 返回 false 表示我们已经处理了这个错误，并阻止浏览器执行默认的错误处理行为（比如在控制台中打印错误消息）。
    return false;
  };

  // 给新的 window.onerror 函数添加一个标记，表明它已经被 Sentry 的错误捕获逻辑插桩过。
  // 这是为了防止重复插桩以及便于识别。
  GLOBAL_OBJ.onerror.__SENTRY_INSTRUMENTED__ = true;
}
