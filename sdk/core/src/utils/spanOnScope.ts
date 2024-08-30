import type { Scope, Span } from '@xigua-monitor/types';
import { addNonEnumerableProperty } from '@xigua-monitor/utils';

/**
 * Scope 和 Span：
 *
 * - 在分布式追踪系统中，Span 是一个基本的追踪单元，表示操作的一个时间段。
 * 多个 Span 可以组成一个 Trace，用于追踪整个请求的执行路径。
 *
 * - Scope 是 Sentry 中的一种上下文，它在一定范围内保存了与追踪相关的信息。
 * Span 可以与 Scope 关联起来，以便在特定范围内进行追踪。
 */

/**
 * 这个常量用于在 scope 对象中存储或访问与 span 相关的数据
 */
const SCOPE_SPAN_FIELD = '_sentrySpan';

type ScopeWithMaybeSpan = Scope & {
  [SCOPE_SPAN_FIELD]?: Span;
};

/**
 * 这个函数允许在特定的作用域（Scope）中设置或移除活动的 Span，从而有效地管理和追踪不同上下文中的操作。
 *
 * @param scope  作用域对象（Scope），表示当前的上下文或范围
 * @param span 活动的 Span 对象，表示一个跟踪单元
 *
 * NOTE: This should NOT be used directly, but is only used internally by the trace methods.
 * 这个函数被标记为不应该直接使用，因为它是内部逻辑的一部分，通常由更高级别的追踪或监控方法调用
 */
export function _setSpanForScope(scope: Scope, span: Span | undefined): void {
  if (span) {
    // 存在 span，将其作为不可枚举属性添加到 scope 对象中
    // 通过使用不可枚举属性，Span 对象不会干扰到对象的其他操作（遍历之类的），从而保持对象的整洁和简洁。
    addNonEnumerableProperty(
      scope as ScopeWithMaybeSpan,
      SCOPE_SPAN_FIELD,
      span,
    );
  } else {
    // 删除 scope 对象上的 SCOPE_SPAN_FIELD 属性
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (scope as ScopeWithMaybeSpan)[SCOPE_SPAN_FIELD];
  }
}

/**
 * 这个函数用于返回个 scope 中 _sentrySpan 字段的值
 * NOTE: This should NOT be used directly, but is only used internally by the trace methods.
 * 这行注释非常重要，它强调了这个函数是一个内部函数，只应该由内部的追踪方法（trace methods）使用，不应该被外部代码直接调用。
 * 这种注释通常用来提醒开发者避免误用函数，并且指明这个函数是为了特定用途而设计的
 */
export function _getSpanForScope(scope: ScopeWithMaybeSpan): Span | undefined {
  return scope[SCOPE_SPAN_FIELD];
}
