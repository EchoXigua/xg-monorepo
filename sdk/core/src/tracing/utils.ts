import type { Span, Scope } from '@xigua-monitor/types';
import {
  addNonEnumerableProperty,
  // stripUrlQueryAndFragment,
} from '@xigua-monitor/utils';
import {
  getClient,
  getCurrentScope,
  getIsolationScope,
  withScope,
} from '../currentScopes';
import { getMainCarrier } from '../carrier';
import type { AsyncContextStrategy } from '../asyncContext/types';
import { _getSpanForScope, _setSpanForScope } from '../utils/spanOnScope';
import { getAsyncContextStrategy } from '../asyncContext';

// so it can be used in manual instrumentation without necessitating a hard dependency on @sentry/utils
// export { stripUrlQueryAndFragment } from '@sentry/utils';

/** 用于表示在开始跨度时存储的普通作用域字段名 */
const SCOPE_ON_START_SPAN_FIELD = '_sentryScope';
/** 用于表示在开始跨度时存储的隔离作用域字段名 */
const ISOLATION_SCOPE_ON_START_SPAN_FIELD = '_sentryIsolationScope';

/** 对 Span 类型的扩展 */
type SpanWithScopes = Span & {
  [SCOPE_ON_START_SPAN_FIELD]?: Scope; // 存储普通作用域的字段
  [ISOLATION_SCOPE_ON_START_SPAN_FIELD]?: Scope; // 存储隔离作用域的字段
};

/**
 * 这个函数用于在一个跨度（span）上存储与其相关的作用域（scope）和隔离作用域（isolation scope）
 *
 * @param span 需要设置作用域的跨度，可以是 Span 类型或 undefined
 * @param scope 需要存储的普通作用域
 * @param isolationScope 需要存储的隔离作用域
 */
export function setCapturedScopesOnSpan(
  span: Span | undefined,
  scope: Scope,
  isolationScope: Scope,
): void {
  // 首先检查 span 是否存在。如果存在，则执行后续操作
  if (span) {
    // 在 span 上添加两个非枚举属性
    addNonEnumerableProperty(
      span,
      ISOLATION_SCOPE_ON_START_SPAN_FIELD,
      isolationScope,
    );
    addNonEnumerableProperty(span, SCOPE_ON_START_SPAN_FIELD, scope);
  }
}

/**
 * 从一个 span 对象中提取当 span 开始时处于活动状态的 scope 和 isolationScope，并将其返回为一个对象
 */
export function getCapturedScopesOnSpan(span: Span): {
  scope?: Scope;
  isolationScope?: Scope;
} {
  return {
    scope: (span as SpanWithScopes)[SCOPE_ON_START_SPAN_FIELD],
    isolationScope: (span as SpanWithScopes)[
      ISOLATION_SCOPE_ON_START_SPAN_FIELD
    ],
  };
}
