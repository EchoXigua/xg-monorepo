import type { ConsoleLevel } from '@xigua-monitor/types';

import { GLOBAL_OBJ } from './worldwide';

/**
 * 日志函数类型，接受不定数量的参数，参数类型不确定，可以是任意类型
 */
type LoggerMethod = (...args: unknown[]) => void;
/**
 * 每个日志级别映射一个日志处理函数
 */
type LoggerConsoleMethods = Record<ConsoleLevel, LoggerMethod>;

/**
 * 这里导出一个空对象，但是该对象可能会被控制台的仪器（console instrumentation）修改，
 * 这意味着它可能用于保存原始的控制台方法，以便在需要时恢复或参考
 */
export const originalConsoleMethods: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // 确保对象的属性仅限于 ConsoleLevel 中定义的值
  [key in ConsoleLevel]?: (...args: any[]) => void;
} = {};

/**
 * 函数的主要目的是临时禁用 Sentry 的控制台工具（console instrumentation），
 * 并允许在控制台消息的原始功能下运行给定的回调函数。
 * 这在调试或特定的测试场景中非常有用，因为它可以防止 Sentry 插桩干扰控制台输出。
 *
 *
 * @param callback 一个不带参数并返回类型 T 的函数。该函数将在控制台的原始状态下执行
 * @returns The results of the callback
 */
export function consoleSandbox<T>(callback: () => T): T {
  // 首先检查全局js对象 中是否存在 console
  if (!('console' in GLOBAL_OBJ)) {
    // 如果不存在，则直接调用 callback 并返回其结果
    return callback();
  }

  // 获取全局的 console 对象并强制转换为 Console 类型。
  const console = GLOBAL_OBJ.console as Console;
  // 存储当前控制台方法的原始实现
  const wrappedFuncs: Partial<LoggerConsoleMethods> = {};

  // 获取所有的控制台级别（例如 debug, info, warn, error, 等）
  const wrappedLevels = Object.keys(originalConsoleMethods) as ConsoleLevel[];

  // Restore all wrapped console methods
  // 遍历每个控制台级别
  wrappedLevels.forEach((level) => {
    const originalConsoleMethod = originalConsoleMethods[level] as LoggerMethod;

    // 将原始的方法存储在 wrappedFuncs 中
    wrappedFuncs[level] = console[level] as LoggerMethod | undefined;

    // 并将当前的控制台方法替换为 Sentry 的包装版本
    console[level] = originalConsoleMethod;
  });

  try {
    // 在这里执行callback 的时候， console 已经被替换，能够捕获和记录日志，而不影响被包裹的状态
    // finnally 会将 console 还原
    return callback();
  } finally {
    // 将所有控制台方法恢复为原始状态。这保证了即使在调用过程中发生错误，控制台也不会保持被包装的状态。
    wrappedLevels.forEach((level) => {
      console[level] = wrappedFuncs[level] as LoggerMethod;
    });
  }
}
