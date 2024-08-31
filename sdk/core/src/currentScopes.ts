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
 * Creates a new scope with and executes the given operation within.
 * The scope is automatically removed once the operation
 * finishes or throws.
 */
export function withScope<T>(callback: (scope: Scope) => T): T;
/**
 * Set the given scope as the active scope in the callback.
 */
export function withScope<T>(
  scope: Scope | undefined,
  callback: (scope: Scope) => T,
): T;
/**
 * Either creates a new active scope, or sets the given scope as active scope in the given callback.
 */
export function withScope<T>(
  ...rest:
    | [callback: (scope: Scope) => T]
    | [scope: Scope | undefined, callback: (scope: Scope) => T]
): T {
  const carrier = getMainCarrier();
  const acs = getAsyncContextStrategy(carrier);

  // If a scope is defined, we want to make this the active scope instead of the default one
  if (rest.length === 2) {
    const [scope, callback] = rest;

    if (!scope) {
      return acs.withScope(callback);
    }

    return acs.withSetScope(scope, callback);
  }

  return acs.withScope(rest[0]);
}
