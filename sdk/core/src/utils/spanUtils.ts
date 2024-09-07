import type {
  MeasurementUnit,
  //   Primitive,
  Span,
  SpanAttributes,
  SpanJSON,
  SpanOrigin,
  SpanStatus,
  SpanTimeInput,
  TraceContext,
} from '@xigua-monitor/types';
import {
  addNonEnumerableProperty,
  dropUndefinedKeys,
  // generateSentryTraceHeader,
  timestampInSeconds,
} from '@xigua-monitor/utils';

import { getAsyncContextStrategy } from '../asyncContext';
import { getCurrentScope } from '../currentScopes';

import { getMainCarrier } from '../carrier';
import { _getSpanForScope } from './spanOnScope';
import {
  getMetricSummaryJsonForSpan,
  // updateMetricSummaryOnSpan,
} from '../metrics/metric-summary';
import { SPAN_STATUS_OK, SPAN_STATUS_UNSET } from '../tracing/spanstatus';
import {
  SEMANTIC_ATTRIBUTE_SENTRY_OP,
  SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN,
} from '../semanticAttributes';
import type { SentrySpan } from '../tracing/sentrySpan';

// 下面两个常量与 OpenTelemetry 标准中的 trace flags 对齐，
// OpenTelemetry 是一种用于分布式追踪的开源标准
/** 表示 Span 没有被采样，值为 0x0 */
export const TRACE_FLAG_NONE = 0x0;
/** 表示 Span 已被采样，值为 0x1 */
export const TRACE_FLAG_SAMPLED = 0x1;

/**
 * Convert a span to a trace context, which can be sent as the `trace` context in a non-transaction event.
 */
export function spanToTraceContext(span: Span): TraceContext {
  const { spanId: span_id, traceId: trace_id } = span.spanContext();
  const { parent_span_id } = spanToJSON(span);

  return dropUndefinedKeys({ parent_span_id, span_id, trace_id });
}

/**
 * 这段代码涉及到分布式追踪中的一个重要概念——采样（Sampling）
 * 在分布式系统中，由于性能和存储空间的限制，
 * 不可能对所有请求都进行详细的追踪，因此通常会通过采样机制只对部分请求进行追踪。
 *
 * 这个函数就是用来判断某个 Span 是否被采样的
 *
 * 在大多数情况下，应该使用 span.isRecording() 方法，而不是直接使用 spanIsSampled
 * 不过，这两者在语义上有些不同，
 * 因为 span.isRecording() 在 Span 结束后会返回 false，而 spanIsSampled 只判断采样与否
 * 所以在需要区分这种语义时，应该使用 spanIsSampled。
 *
 */
export function spanIsSampled(span: Span): boolean {
  // 获取 Span 的上下文信息，包含 traceFlags 等字段。
  const { traceFlags } = span.spanContext();
  return traceFlags === TRACE_FLAG_SAMPLED;
}

/**
 * 这个函数的目的是处理不同格式的时间输入，并将其转换为以秒为单位的时间戳。
 */
export function spanTimeInputToSeconds(
  input: SpanTimeInput | undefined,
): number {
  // 数字类型，则调用 ensureTimestampInSeconds 来确保它是秒级别的时间戳。
  if (typeof input === 'number') {
    return ensureTimestampInSeconds(input);
  }

  // 数组，假设它是一个以 [seconds, nanoseconds] 为格式的时间戳（通常是高精度的时间戳，例如来自性能计时器），
  // 则通过将第一个元素加上第二个元素除以 1e9（十亿）来将纳秒部分转换为秒并加总
  if (Array.isArray(input)) {
    // See {@link HrTime} for the array-based time format
    return input[0] + input[1] / 1e9;
  }

  // Date 对象 则获取其毫秒数并转换为秒。
  if (input instanceof Date) {
    return ensureTimestampInSeconds(input.getTime());
  }

  // 如果输入未定义，则返回当前时间戳
  return timestampInSeconds();
}

/**
 * 这个函数的作用是检查传入的时间戳是否是以毫秒为单位的，
 * 如果是，它会将其转换为秒级别；否则，直接返回原始值。
 */
function ensureTimestampInSeconds(timestamp: number): number {
  // 判断时间戳是否以毫秒为单位。因为秒级别的 UNIX 时间戳通常不超过 10 位数字，
  // 而毫秒级别的时间戳会有 13 位以上。
  const isMs = timestamp > 9999999999;
  return isMs ? timestamp / 1000 : timestamp;
}

/**
 * 这段代码的主要作用是将一个 Span 对象转换为其对应的 JSON 表示形式。
 * 这在需要序列化 Span 对象、进行日志记录、或通过网络传输追踪数据时非常有用。
 *
 * @param span
 * @returns
 */
export function spanToJSON(span: Span): Partial<SpanJSON> {
  // 检查 Span 是否是 Sentry 特有的 Span 类型
  // 如果是，则调用其 getSpanJSON 方法直接获取 JSON 表示
  if (spanIsSentrySpan(span)) {
    return span.getSpanJSON();
  }

  try {
    // 从span 中提取当前span 的id 和 追踪id
    const { spanId: span_id, traceId: trace_id } = span.spanContext();

    // Handle a span from @opentelemetry/sdk-base-trace's `Span` class
    // 如果 Span 是 OpenTelemetry SDK 的 Span，
    // 代码会提取其中的属性并转换为 Sentry 期望的 JSON 格式。
    if (spanIsOpenTelemetrySdkTraceBaseSpan(span)) {
      const { attributes, startTime, name, endTime, parentSpanId, status } =
        span;

      // 使用 dropUndefinedKeys 函数过滤掉值为 undefined 的属性，
      // 确保返回的 JSON 对象中只包含有效的键值对。
      return dropUndefinedKeys({
        span_id,
        trace_id,
        data: attributes,
        description: name,
        parent_span_id: parentSpanId,
        start_timestamp: spanTimeInputToSeconds(startTime),
        // This is [0,0] by default in OTEL, in which case we want to interpret this as no end time
        timestamp: spanTimeInputToSeconds(endTime) || undefined,
        status: getStatusMessage(status),
        op: attributes[SEMANTIC_ATTRIBUTE_SENTRY_OP],
        origin: attributes[SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN] as
          | SpanOrigin
          | undefined,
        _metrics_summary: getMetricSummaryJsonForSpan(span),
      });
    }

    // 如果 Span 既不是 Sentry 的 Span，也不是 OpenTelemetry SDK 的 Span，
    // 则仅返回基本的 span_id 和 trace_id。
    return {
      span_id,
      trace_id,
    };
  } catch {
    return {};
  }
}

/**
 * 由于循环依赖的限制，函数无法直接通过 instanceof 来检查 Span 是否为 SentrySpan 类型。
 * 所以通过检查 Span 对象是否有 getSpanJSON 方法来判断它是否为 SentrySpan 类型。
 *
 * 这里解释下循环依赖问题：
 * 判断一个对象是否为某个类的实例，最直接的方法是使用 instanceof 操作符
 * span instanceof SentrySpan;
 * 然而，要使用 instanceof，你需要在当前模块中导入 SentrySpan 类
 * SentrySpan 类 在 spanSpan.ts 中，而这个文件中又引入了 spanUtils.ts，就会产生循环依赖
 *
 *
 * spanToJSON 中调用 spanIsSentrySpan 检查 span 的类型
 *
 * 说一下 ts 中的 is
 * span is SentrySpan 是一种类型保护（type guard）语法
 * 它用于在函数中通过检查某些条件来“缩小”变量的类型范围
 * 这里如果这个函数返回 true，那么传入的 span 参数就是 SentrySpan 类型
 * 这在处理多个可能类型的对象时特别有用。
 */
function spanIsSentrySpan(span: Span): span is SentrySpan {
  return typeof (span as SentrySpan).getSpanJSON === 'function';
}

/**
 * 检查该对象是否具有以下属性：attributes、startTime、name、endTime、status
 * 这些属性是 OpenTelemetrySdkTraceBaseSpan 类型的关键标识，通过检查它们的存在性来确定对象的类型。
 *
 * @param span
 * @returns
 */
function spanIsOpenTelemetrySdkTraceBaseSpan(
  span: Span,
): span is OpenTelemetrySdkTraceBaseSpan {
  const castSpan = span as OpenTelemetrySdkTraceBaseSpan;
  return (
    !!castSpan.attributes &&
    !!castSpan.startTime &&
    !!castSpan.name &&
    !!castSpan.endTime &&
    !!castSpan.status
  );
}

/**
 * 这段代码的目的是将一个 SpanStatus 对象转换为一个适用于 JSON 表示的状态消息字符串
 *
 * @param status
 * @returns
 */
export function getStatusMessage(
  status: SpanStatus | undefined,
): string | undefined {
  // 如果 status 是 undefined 或者 状态未设置，返回 undefined
  if (!status || status.code === SPAN_STATUS_UNSET) {
    return undefined;
  }

  // 如果 status.code 是 SPAN_STATUS_OK，
  // 返回字符串 'ok'，表示 Span 操作成功，这是追踪系统中的一种常见状态。
  if (status.code === SPAN_STATUS_OK) {
    return 'ok';
  }

  // 如果 status.code 是其他值，优先返回 status.message，这是一条描述性的信息
  // 如果 message 未设置，则返回默认的 'unknown_error'，以指示发生了未知错误
  return status.message || 'unknown_error';
}

/** Exported only for tests. */
export interface OpenTelemetrySdkTraceBaseSpan extends Span {
  attributes: SpanAttributes;
  startTime: SpanTimeInput;
  name: string;
  status: SpanStatus;
  endTime: SpanTimeInput;
  parentSpanId?: string;
}

/** 存储 子span 的字段名  */
const CHILD_SPANS_FIELD = '_sentryChildSpans';
/** 存储 根span 的字段名  */
const ROOT_SPAN_FIELD = '_sentryRootSpan';

/**
 * 这是一个扩展 Span 类型的类型别名，表示一个可能包含子 Span、根 Span的 Span 对象
 */
type SpanWithPotentialChildren = Span & {
  [CHILD_SPANS_FIELD]?: Set<Span>;
  [ROOT_SPAN_FIELD]?: Span;
};

/**
 * 这个函数用于将一个子 Span 添加到另一个 Span 中，同时保持对根 Span 的引用。
 * 这在分布式追踪系统中非常重要，因为它允许你在追踪过程中维护 Span 的层次结构，
 * 并且能够通过 Span 查找到它的根 Span 和所有子 Span。
 */
export function addChildSpanToSpan(
  span: SpanWithPotentialChildren,
  childSpan: Span,
): void {
  /**
   * 在分布式追踪系统中，Span 对象可能会嵌套在多层层次结构中。
   * 每个 Span 都可能有一个父 Span，而整个层次结构的起点是根 Span。
   * 通过在每个子 Span 上存储根 Span 的引用，可以方便地追溯到整个追踪操作的起点
   *
   * 这个操作对于实现 getRootSpan() 功能至关重要，因为 getRootSpan()
   * 需要能够在层次结构中的任何 Span 对象上调用，并准确地返回整个追踪的根 Span。
   */

  // 首先获取当前 Span 的根 Span，如果没有则将当前 span 作为自己的根 span
  const rootSpan = span[ROOT_SPAN_FIELD] || span;
  // 在子 span 上添加 _sentryRootSpan 属性，这个属性是不可枚举的
  // 不会出现在 for...in 或 Object.keys() 中
  addNonEnumerableProperty(
    childSpan as SpanWithPotentialChildren,
    ROOT_SPAN_FIELD,
    rootSpan,
  );

  /**
   * 为了能够追踪和管理一个 Span 的所有子 Span，在父 Span 上存储子 Span 的集合是非常重要的。
   * 这不仅可以帮助理解和可视化追踪的层次结构，还可以实现一些更复杂的操作，
   * 比如 getSpanDescendants()，它需要遍历某个 Span 的所有子 Span，甚至可能包括子孙 Span
   * 通过维护这个子 Span 集合，可以确保在需要时能够方便地访问和操作所有相关的 Span 对象
   */

  // 检查当前 Span 是否已经有子 Span 集合
  if (span[CHILD_SPANS_FIELD]) {
    // 如果有，直接将 childSpan 添加到这个集合中
    span[CHILD_SPANS_FIELD].add(childSpan);
  } else {
    // 如果没有，在 span 上添加 _sentryChildSpans 属性，并初始化为一个包含 childSpan 的 Set 集合
    addNonEnumerableProperty(span, CHILD_SPANS_FIELD, new Set([childSpan]));
  }

  // 通过这个函数，Sentry 可以有效地维护 Span 的层次结构，并且能够在需要时快速访问 Span 的父子关系
}

/**
 * 返回给定span 的根 span
 * 通过 addChildSpanToSpan 函数，里面会维护子span 和 根span 的引用关系
 */
export function getRootSpan(span: SpanWithPotentialChildren): Span {
  return span[ROOT_SPAN_FIELD] || span;
}

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

/**
 * Convert a span to a trace context, which can be sent as the `trace` context in an event.
 * By default, this will only include trace_id, span_id & parent_span_id.
 * If `includeAllData` is true, it will also include data, op, status & origin.
 */
/**
 * 将一个 Span 对象转换为 TraceContext，可以作为事件中的 trace 上下文发送
 *
 * @param span
 * @returns 返回一个 TraceContext 对象，其中包含从 Span 提取的字段。
 */
export function spanToTransactionTraceContext(span: Span): TraceContext {
  // 获取 Span 的上下文，提取 spanId 和 traceId 并分别命名为 span_id 和 trace_id
  const { spanId: span_id, traceId: trace_id } = span.spanContext();
  // 将 Span 转换为 JSON 格式，从中提取 data、op、parent_span_id、status 和 origin
  const { data, op, parent_span_id, status, origin } = spanToJSON(span);

  // 移除对象中值为 undefined 的键，返回最终的 TraceContext 对象
  return dropUndefinedKeys({
    parent_span_id,
    span_id,
    trace_id,
    data,
    op,
    status,
    origin,
  });
}

/**
 * 返回给定 Span 及其所有子孙的数组
 * Returns an array of the given span and all of its descendants.
 */
export function getSpanDescendants(span: SpanWithPotentialChildren): Span[] {
  // 使用 Set 结构来存储 Span 对象，确保不会有重复的 Span
  const resultSet = new Set<Span>();

  // 通过递归的方式遍历 Span 的子节点，将它们添加到结果集合中
  function addSpanChildren(span: SpanWithPotentialChildren): void {
    // 已经存在,说明存在循环引用，立即返回以避免无限递归
    if (resultSet.has(span)) {
      return;
      // 这里需要忽略未采样的 span
    } else if (spanIsSampled(span)) {
      resultSet.add(span);
      // 获取子 span
      const childSpans = span[CHILD_SPANS_FIELD]
        ? Array.from(span[CHILD_SPANS_FIELD])
        : [];

      // 继续递归其子 span
      for (const childSpan of childSpans) {
        addSpanChildren(childSpan);
      }
    }
  }

  addSpanChildren(span);

  // 将 Set 转换为数组并返回，包含所有的 Span 及其子孙
  return Array.from(resultSet);
}
