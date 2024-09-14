import type {
  Integration,
  Span,
  SpanAttributes,
  SpanTimeInput,
  StartSpanOptions,
} from '@xigua-monitor/types';
import type { SentrySpan } from '@xigua-monitor/core';

import {
  getClient,
  getCurrentScope,
  spanToJSON,
  startInactiveSpan,
  withActiveSpan,
} from '@xigua-monitor/core';

import { WINDOW } from '../types';

/**
 * 用于检查给定的 value 是否是一个有效的数值，
 * 即该值必须是 number 类型并且是一个有限数值（不是 NaN、Infinity 或 -Infinity）
 *
 * isFinite 是 js 中的一个全局函数,用于检查一个数值是否是有限的数（即排除 NaN、Infinity 和 -Infinity）
 */
export function isMeasurementValue(value: unknown): value is number {
  return typeof value === 'number' && isFinite(value);
}

/**
 * 用于在事务中启动子 Span，并确保该子 Span 使用其创建时的时间戳（如果该时间戳早于父事务的实际开始时间戳）
 *
 * 函数的主要作用是确保在创建子 Span 时，能够根据父 Span 的实际开始时间调整时间戳，从而维护时间序列的准确性。
 * 这样在监控和性能跟踪中，可以更清晰地反映出各个操作的关系和时间消耗，有助于后续的性能分析和故障排查。
 *
 * @param parentSpan 父 Span 对象，代表当前的操作上下文
 * @param startTimeInSeconds 子 Span 的起始时间，以秒为单位
 * @param endTime 子 Span 的结束时间，允许的输入类型（如时间戳、延迟等）
 * @param param3 用于启动 Span 的选
 * @returns
 */
export function startAndEndSpan(
  parentSpan: Span,
  startTimeInSeconds: number,
  endTime: SpanTimeInput,
  { ...ctx }: StartSpanOptions,
): Span | undefined {
  // 将父 Span 转换为 JSON 格式，并提取其开始时间
  const parentStartTime = spanToJSON(parentSpan).start_timestamp;

  // 如果父 Span 的开始时间存在且晚于子 Span 的开始时间，则尝试更新父 Span 的开始时间
  if (parentStartTime && parentStartTime > startTimeInSeconds) {
    // We can only do this for SentrySpans...
    if (
      typeof (parentSpan as Partial<SentrySpan>).updateStartTime === 'function'
    ) {
      (parentSpan as SentrySpan).updateStartTime(startTimeInSeconds);
    }
  }

  // 接受 parentSpan 作为当前活动的 Span
  return withActiveSpan(parentSpan, () => {
    //  创建一个新的子 Span，并传入开始时间和其他上下文选项
    const span = startInactiveSpan({
      startTime: startTimeInSeconds,
      ...ctx,
    });

    // 如果成功创建了子 Span，则调用其 end 方法来结束该 Span，传入结束时间
    if (span) {
      span.end(endTime);
    }

    // 返回创建的子 Span，供测试或其他用途使用
    return span;
  });
}

/** 用于获取浏览器的 Performance API */
export function getBrowserPerformanceAPI(): Performance | undefined {
  // @ts-expect-error we want to make sure all of these are available, even if TS is sure they are
  // 确认是否有 window 对象，确保运行在浏览器环境中（某些非浏览器环境如 Node.js 中是没有 window 的）
  // 检查 window 对象是否支持 addEventListener，这也是现代浏览器的一个特性。
  // 检查 window 对象是否支持 Performance API，该 API 提供了与页面加载和渲染时间相关的信息
  // 如果都支持,最后返回 performance
  return WINDOW && WINDOW.addEventListener && WINDOW.performance;
}

/**
 * 将以毫秒为单位的时间转换为以秒为单位的时间
 * @param time time in ms
 */
export function msToSec(time: number): number {
  return time / 1000;
}
