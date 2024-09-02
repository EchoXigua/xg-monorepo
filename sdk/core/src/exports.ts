import type {
  // CaptureContext,
  // CheckIn,
  // Event,
  // EventHint,
  // EventProcessor,
  // Extra,
  // Extras,
  // FinishedCheckIn,
  // MonitorConfig,
  // Primitive,
  Session,
  SessionContext,
  SeverityLevel,
  User,
} from '@xigua-monitor/types';
import {
  GLOBAL_OBJ,
  isThenable,
  logger,
  timestampInSeconds,
  uuid4,
} from '@xigua-monitor/utils';

import {
  getClient,
  getCurrentScope,
  getIsolationScope,
  //   withIsolationScope,
} from './currentScopes';
import { DEFAULT_ENVIRONMENT } from './constants';
import type { ExclusiveEventHintOrCaptureContext } from './utils/prepareEvent';
import { parseEventHintOrCaptureContext } from './utils/prepareEvent';
import { closeSession, makeSession, updateSession } from './session';

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

/**
 * 这个函数用于在当前隔离范围（isolation scope）内启动一个新的会话，并将该会话设置为活动会话。
 * 它允许你为会话提供额外的上下文信息，并在启动新会话之前结束现有的会话。
 *
 * @param context (optional) 应用于返回会话对象的附加属性
 *
 * @returns 新的活动会话
 */
export function startSession(context?: SessionContext): Session {
  // 会获取客户端实例
  const client = getClient();
  // 获取隔离作用域
  const isolationScope = getIsolationScope();
  // 获取当前作用域
  const currentScope = getCurrentScope();

  // 从客户端信息中提取版本,环境(如果客户端存在)
  const { release, environment = DEFAULT_ENVIRONMENT } =
    (client && client.getOptions()) || {};

  // 浏览器的用户代理字符串，只有在浏览器环境下才会存在
  const { userAgent } = GLOBAL_OBJ.navigator || {};

  // 使用上述信息创建一个新的会话对象
  const session = makeSession({
    release,
    environment,
    user: currentScope.getUser() || isolationScope.getUser(),
    ...(userAgent && { userAgent }),
    ...context,
  });

  // 在启动新会话之前，会检查当前隔离范围内是否存在一个已经激活的会话
  // 如果存在且状态为 'ok'，则将其状态更新为 'exited'
  const currentSession = isolationScope.getSession();
  if (currentSession && currentSession.status === 'ok') {
    updateSession(currentSession, { status: 'exited' });
  }
  // 结束当前会话，准备启动新会话
  endSession();

  // 函数将新创建的会话设置为当前范围和隔离范围的活动会话：
  isolationScope.setSession(session);

  // 在 SDK 的未来版本（v8）中，可能只使用隔离范围来管理会话，取消对当前范围的依赖。
  // For v7 though, we can't "soft-break" people using getCurrentHub().getScope().setSession()
  currentScope.setSession(session);

  // 返回这个新创建的会话
  return session;
}

/**
 * 函数的主要功能是结束当前会话并清理相关的状态。
 * 在应用程序中，可能存在多个会话范围，例如隔离范围（isolationScope）和当前范围（currentScope）。
 */
export function endSession(): void {
  // 获取隔离范围, 通常表示一个隔离的上下文，可能在一些特定的任务或进程中使用
  const isolationScope = getIsolationScope();
  // 获取当前范围,当前活动的上下文，通常是当前线程或活动的主要会话上下文
  const currentScope = getCurrentScope();

  // 尝试从 currentScope 或 isolationScope 中获取当前的会话
  const session = currentScope.getSession() || isolationScope.getSession();
  if (session) {
    // 如果存在会话的话,关闭该会话
    closeSession(session);
  }

  //发送会话更新。这意味着会话已经结束，任何需要同步的会话数据都会通过这个更新发送出去
  _sendSessionUpdate();

  // 将 isolationScope 和 currentScope 的会话状态清空。
  isolationScope.setSession();

  // 在未来版本中，可能会移除对 currentScope 的会话设置，仅保留 isolationScope 的会话管理。
  // 这可能是为了简化代码或增强隔离范围的使用。然而，目前为了保持向后兼容性，仍然保留了对 currentScope 的支持。
  // For v7 though, we can't "soft-break" people using getCurrentHub().getScope().setSession()
  currentScope.setSession();
}

/**
 * 这个函数的作用是发送当前作用域（scope）中的会话数据到 Sentry
 */
function _sendSessionUpdate(): void {
  // 隔离作用域
  const isolationScope = getIsolationScope();
  // 当前作用域
  const currentScope = getCurrentScope();
  // 客户端实例
  const client = getClient();
  // 未来可能会移除 currentScope 以简化逻辑，但目前仍然保留以兼容旧的 SDK 版本。
  // For v7 though, we can't "soft-break" people using getCurrentHub().getScope().setSession()

  // 获取当前会话
  const session = currentScope.getSession() || isolationScope.getSession();
  if (session && client) {
    // 将会话数据发送到 Sentry
    client.captureSession(session);
  }
}

/**
 * 用于管理会话的捕获和发送。它根据传入的参数决定是否结束会话
 *
 * @param end If set the session will be marked as exited and removed from the scope.
 *            Defaults to `false`.
 */
export function captureSession(end: boolean = false): void {
  // both send the update and pull the session from the scope
  if (end) {
    // 如果设为 true，表示需要结束当前会话
    endSession();
    return;
  }

  // 发送当前会话数据，但不会结束会话
  _sendSessionUpdate();
}
