import type { MeasurementUnit, Span } from '@xigua-monitor/types';
import type { MetricSummary } from '@xigua-monitor/types';
import { dropUndefinedKeys } from '@xigua-monitor/utils';

/**
 * key: bucketKey
 * value: [exportKey, MetricSummary]
 *
 * MetricSummary 是一个表示某些统计指标的对象
 */
type MetricSummaryStorage = Map<string, [string, MetricSummary]>;

/** 表示在 Span 对象中存储指标的字段名称 */
const METRICS_SPAN_FIELD = '_sentryMetrics';

/** 扩展了 Span 对象的类型，它可能包含一个 METRICS_SPAN_FIELD 字段 */
type SpanWithPotentialMetrics = Span & {
  [METRICS_SPAN_FIELD]?: MetricSummaryStorage;
};

/**
 * 这个函数的主要作用是从一个 Span 对象中提取其相关的指标摘要（metric summary），并将其转换为 JSON 兼容的格式。
 * 如果 Span 对象中没有存储任何指标摘要，则函数返回 undefined。
 */
export function getMetricSummaryJsonForSpan(
  span: Span,
): Record<string, Array<MetricSummary>> | undefined {
  // 尝试从 Span 中获取指标的值（MetricSummaryStorage）
  const storage = (span as SpanWithPotentialMetrics)[METRICS_SPAN_FIELD];

  // storage 不存在，即 Span 中没有存储任何指标摘要，函数直接返回 undefined
  if (!storage) {
    return undefined;
  }

  // 初始化一个空的 output 对象
  const output: Record<string, Array<MetricSummary>> = {};

  // 遍历 storage 中的每一项，每个 bucketKey，提取 exportKey 和 MetricSummary
  for (const [, [exportKey, summary]] of storage) {
    // 将 MetricSummary 加入到 output 对应的 exportKey 数组中。
    const arr = output[exportKey] || (output[exportKey] = []);
    arr.push(dropUndefinedKeys(summary));
  }

  return output;
}
