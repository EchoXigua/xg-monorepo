import type { PropagationContext, TraceparentData } from '@xigua-monitor/types';
import { baggageHeaderToDynamicSamplingContext } from './baggage';
import { uuid4 } from './misc';

// eslint-disable-next-line @sentry-internal/sdk/no-regexp-constructor -- RegExp is used for readability here
export const TRACEPARENT_REGEXP = new RegExp(
  '^[ \\t]*' + // 匹配开头的空白字符（空格或制表符）
    '([0-9a-f]{32})?' + // 可选的 32 位十六进制数字，表示 trace_id
    '-?([0-9a-f]{16})?' + // 选的 16 位十六进制数字，表示 span_id，前面可以有一个连字符
    '-?([01])?' + //  可选的 0 或 1，表示是否被采样，前面可以有一个连字符
    '[ \\t]*$', // 匹配结尾的空白字符
);

/**
 * 这个函数从 traceparent 字符串中提取数据，返回一个包含 traceId、parentSampled 和 parentSpanId 的对象
 *
 * @param traceparent Traceparent string
 *
 * @returns 对象包含来自标头的数据，如果跟踪父字符串格式错误，则未定义
 */
export function extractTraceparentData(
  traceparent?: string,
): TraceparentData | undefined {
  // 为空直接返回undefined
  if (!traceparent) {
    return undefined;
  }

  // 通过正则匹配
  const matches = traceparent.match(TRACEPARENT_REGEXP);
  // 没有匹配结果,直接返回undefined
  if (!matches) {
    return undefined;
  }

  // 检查采样标志（parentSampled）的值，如果为 '1' 则为 true，如果为 '0' 则为 false。
  let parentSampled: boolean | undefined;
  if (matches[3] === '1') {
    parentSampled = true;
  } else if (matches[3] === '0') {
    parentSampled = false;
  }

  return {
    traceId: matches[1],
    parentSampled,
    parentSpanId: matches[2],
  };
}

/**
 * 这个函数从 Sentry 追踪头和行李数据中创建传播上下文。
 * 如果没有提供头部，则创建一个最小的传播上下文。
 *
 * @param sentryTrace
 * @param baggage
 * @returns
 */
export function propagationContextFromHeaders(
  sentryTrace: string | undefined,
  baggage: string | number | boolean | string[] | null | undefined,
): PropagationContext {
  // 提取 sentryTrace 的数据
  const traceparentData = extractTraceparentData(sentryTrace);
  // 提取动态采样上下文
  const dynamicSamplingContext = baggageHeaderToDynamicSamplingContext(baggage);

  const { traceId, parentSpanId, parentSampled } = traceparentData || {};

  // 没有有效的 traceparentData，则生成新的 traceId 和 spanId
  if (!traceparentData) {
    return {
      traceId: traceId || uuid4(),
      spanId: uuid4().substring(16),
    };
  } else {
    // 有效的 traceparentData
    return {
      traceId: traceId || uuid4(),
      parentSpanId: parentSpanId || uuid4().substring(16),
      spanId: uuid4().substring(16),
      sampled: parentSampled,
      dsc: dynamicSamplingContext || {}, // If we have traceparent data but no DSC it means we are not head of trace and we must freeze it
    };
  }
}
