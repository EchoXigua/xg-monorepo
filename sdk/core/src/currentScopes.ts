import type { Scope, Client } from '@xigua-monitor/types';

import { getAsyncContextStrategy } from './asyncContext';
import { getMainCarrier } from './carrier';

/**
 * 获取当前活动的 Scope 对象
 */
export function getCurrentScope(): Scope {
  // 获取全局载体，Carrier 是一个全局对象，负责在应用程序中传递 Sentry 相关的状态和上下文
  const carrier = getMainCarrier();
  const acs = getAsyncContextStrategy(carrier);
  return acs.getCurrentScope();
}

/**
 * Get the currently active client.
 */
export function getClient<C extends Client>(): C | undefined {
  return getCurrentScope().getClient<C>();
}

/**
 * 这个函数用于获取当前活动的隔离范围
 * 隔离范围是指当前执行上下文中的活动范围，用于确保在分布式系统中，跨异步操作的追踪信息得以正确传播和维护
 */
export function getIsolationScope(): Scope {
  const carrier = getMainCarrier();
  const acs = getAsyncContextStrategy(carrier);
  return acs.getIsolationScope();
}

/**
 * 这个函数用于在 Sentry 中管理 scope（作用域）
 * 
 * Scope 是 Sentry 用来管理上下文信息的核心概念，在不同的作用域中可以保存不同的状态信息，
 * 比如用户信息、标签、额外数据等。这些作用域可以嵌套，并且可以用于组织 Sentry 事件和数据。

 * 这个形式下，函数创建一个新的 Scope 并将其设为活动的 Scope，随后在这个 Scope 上下文中执行传入的 callback
 */
export function withScope<T>(callback: (scope: Scope) => T): T;
/**
 * 这个形式允许传入一个现有的 Scope，如果传入了 undefined，则与第一个形式的行为相同，即创建新的 Scope。
 */
export function withScope<T>(
  scope: Scope | undefined,
  callback: (scope: Scope) => T,
): T;
/**
 * 要么创建一个新的活动范围，要么在给定的回调中将给定的范围设置为活动范围。
 */
export function withScope<T>(
  ...rest:
    | [callback: (scope: Scope) => T]
    | [scope: Scope | undefined, callback: (scope: Scope) => T]
): T {
  // 获取全局载体
  const carrier = getMainCarrier();
  // 获取异步上下文策略
  const acs = getAsyncContextStrategy(carrier);

  // If a scope is defined, we want to make this the active scope instead of the default one
  // 如果定义了作用域，我们希望将其作为活动作用域，而不是默认作用域
  if (rest.length === 2) {
    // rest等于2 说明传入了两个参数
    const [scope, callback] = rest;

    if (!scope) {
      // 作用域不存在，与创建新 Scope 的逻辑一致。
      return acs.withScope(callback);
    }

    // 将传入的 Scope 设置为当前活动的 Scope，并在其上下文中执行回调
    return acs.withSetScope(scope, callback);
  }

  // 只传入了一个参数（回调）， 创建新的 Scope，并在其上下文中执行回调。
  return acs.withScope(rest[0]);
}
