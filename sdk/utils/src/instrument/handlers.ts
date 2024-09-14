import { DEBUG_BUILD } from '../debug-build';
import { logger } from '../logger';
import { getFunctionName } from '../stacktrace';

/** 定义了一组字符串常量，表示不同的仪器化类型 */
export type InstrumentHandlerType =
  | 'console'
  | 'dom'
  | 'fetch'
  | 'fetch-body-resolved'
  | 'history'
  | 'xhr'
  | 'error'
  | 'unhandledrejection';

/** 定义了一个回调函数的类型，该回调函数接受一个参数  */
export type InstrumentHandlerCallback = (data: any) => void;

// 全局变量
/**
 * 用于存储各个仪器化类型对应的处理函数
 * 每个处理函数都是一个回调函数的数组。
 */
const handlers: {
  [key in InstrumentHandlerType]?: InstrumentHandlerCallback[];
} = {};
/**
 * 用于跟踪每种仪器化类型是否已经被调用。
 */
const instrumented: { [key in InstrumentHandlerType]?: boolean } = {};

/**
 * 这里类似发布订阅
 */

/**
 * 注册一个新的处理器（handler）到指定的仪器化类型
 */
export function addHandler(
  type: InstrumentHandlerType,
  handler: InstrumentHandlerCallback,
): void {
  handlers[type] = handlers[type] || [];
  (handlers[type] as InstrumentHandlerCallback[]).push(handler);
}

/**
 * 重置所有的仪器化处理器
 * 通常在测试中使用，以确保在每次测试前有干净的状态。
 */
export function resetInstrumentationHandlers(): void {
  Object.keys(handlers).forEach((key) => {
    handlers[key as InstrumentHandlerType] = undefined;
  });
}

/**
 * 可能运行一个监控函数，除非它已经被调用过
 * 检查 instrumented 对象中是否已经标记了该类型。
 * 如果没有，则调用传入的 instrumentFn 函数，并将该类型标记为已调用。
 */
export function maybeInstrument(
  type: InstrumentHandlerType,
  instrumentFn: () => void,
): void {
  if (!instrumented[type]) {
    instrumentFn();
    instrumented[type] = true;
  }
}

/**
 * 触发特定仪器化类型的所有处理器，并传递数据
 * 这里相当于emit触发后执行的逻辑，取出对应的fn [] 挨个执行
 */
export function triggerHandlers(
  type: InstrumentHandlerType,
  data: unknown,
): void {
  const typeHandlers = type && handlers[type];
  if (!typeHandlers) {
    return;
  }

  for (const handler of typeHandlers) {
    try {
      handler(data);
    } catch (e) {
      DEBUG_BUILD &&
        logger.error(
          `Error while triggering instrumentation handler.\nType: ${type}\nName: ${getFunctionName(handler)}\nError:`,
          e,
        );
    }
  }
}
