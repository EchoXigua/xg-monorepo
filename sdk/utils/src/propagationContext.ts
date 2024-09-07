import type { PropagationContext } from '@xigua-monitor/types';
import { uuid4 } from './misc';

/**
 * 返回一个新的最小传播上下文
 */
export function generatePropagationContext(): PropagationContext {
  return {
    traceId: uuid4(),
    spanId: uuid4().substring(16),
  };
}
