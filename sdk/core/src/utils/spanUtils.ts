import type {
  MeasurementUnit,
  //   Primitive,
  Span,
  // SpanAttributes,
  // SpanJSON,
  // SpanOrigin,
  // SpanStatus,
  // SpanTimeInput,
  // TraceContext,
} from '@xigua-monitor/types';

import { getAsyncContextStrategy } from '../asyncContext';
import { getCurrentScope } from '../currentScopes';

import { getMainCarrier } from '../carrier';
import { _getSpanForScope } from './spanOnScope';

/**
 * 这个函数用于返回当前活跃的 span
 */
export function getActiveSpan(): Span | undefined {
  // 获取全局载体
  const carrier = getMainCarrier();
  // 获取异步上下文策略
  const acs = getAsyncContextStrategy(carrier);

  // 如果 acs 对象中定义了 getActiveSpan 方法，那么就调用这个方法并返回其结果
  if (acs.getActiveSpan) {
    // 这个方法会通过该策略获取当前的 span
    return acs.getActiveSpan();
  }

  // acs 中没有 getActiveSpan 方法，那么函数会回退到使用 _getSpanForScope(getCurrentScope())。
  // 这表示使用当前 scope 中的 span 作为回退方案。
  return _getSpanForScope(getCurrentScope());
}
