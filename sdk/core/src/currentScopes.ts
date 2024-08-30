import type { Scope, Client } from '@xigua-monitor/types';

import { getAsyncContextStrategy } from './asyncContext';
import { getMainCarrier } from './carrier';

/**
 * Get the currently active scope.
 */
export function getCurrentScope(): Scope {
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
