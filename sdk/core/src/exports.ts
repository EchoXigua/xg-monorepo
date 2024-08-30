import {
  getClient,
  getCurrentScope,
  //   getIsolationScope,
  //   withIsolationScope,
} from './currentScopes';
import type { ExclusiveEventHintOrCaptureContext } from './utils/prepareEvent';
import { parseEventHintOrCaptureContext } from './utils/prepareEvent';

/**
 * 这个函数用于捕获异常事件并将其发送到 Sentry
 * 这个函数在错误处理和日志系统中非常有用，尤其是在跟踪和报告异常时
 *
 * @param exception 想要捕获并发送到 Sentry 的异常
 * @param hint 与该异常相关的附加数据。它可能包括一些额外的上下文信息或者提示
 * @returns 返回一个字符串，表示捕获的 Sentry 事件的唯一标识符
 * 这个 ID 可以用来在 Sentry 的控制台中查找和跟踪该事件
 */
export function captureException(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exception: any,
  hint?: ExclusiveEventHintOrCaptureContext,
): string {
  // 这个函数通常用于获取当前的 Sentry 作用域
  // Sentry 的作用域用于管理和存储与事件相关的上下文信息，例如用户信息、标签、额外数据等
  // captureException 这是 Scope 对象上的方法，用于捕获并记录异常。
  // 它将异常对象和相关的上下文数据传递给 Sentry，生成一个事件并发送到 Sentry 服务器
  return getCurrentScope().captureException(
    exception,
    parseEventHintOrCaptureContext(hint),
  );
}
