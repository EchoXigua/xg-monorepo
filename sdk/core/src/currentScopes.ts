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
