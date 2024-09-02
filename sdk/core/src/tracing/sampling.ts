import type { Options, SamplingContext } from '@xigua-monitor/types';
import { logger } from '@xigua-monitor/utils';

import { DEBUG_BUILD } from '../debug-build';
import { hasTracingEnabled } from '../utils/hasTracingEnabled';
import { parseSampleRate } from '../utils/parseSampleRate';

/**
 * 这个函数用于根据给定的选项做出采样决策。它在每次创建根跨度（root span）时被调用，
 * 并返回一个布尔值，表示该跨度是否应该被采样，以及对应的采样率
 * 只有被采样的根 span才会发送给 sentry
 *
 * @param options
 * @param samplingContext 当前采样的上下文，包括父span 的采样状态等信息
 * @returns [表示该跨度是否被采样，可选的采样率]
 */
export function sampleSpan(
  options: Pick<
    Options,
    // tracesSampleRate: 全局采样率，范围从 0 到 1
    // tracesSampler: 自定义采样函数，返回一个采样率
    // enableTracing: 表示是否启用跟踪
    'tracesSampleRate' | 'tracesSampler' | 'enableTracing'
  >,
  samplingContext: SamplingContext,
): [sampled: boolean, sampleRate?: number] {
  if (!hasTracingEnabled(options)) {
    // 如果没有启用跟踪，则直接返回 [false]，表示不采样
    return [false];
  }

  // 接下来确定采样率
  // we would have bailed already if neither `tracesSampler` nor `tracesSampleRate` nor `enableTracing` were defined, so one of these should
  // work; prefer the hook if so
  let sampleRate;

  // 优先使用 tracesSampler 函数的返回值
  if (typeof options.tracesSampler === 'function') {
    sampleRate = options.tracesSampler(samplingContext);
  } else if (samplingContext.parentSampled !== undefined) {
    // 如果没有定义采样函数，则检查父span的采样状态,存在则使用父 span的 采样率
    sampleRate = samplingContext.parentSampled;
  } else if (typeof options.tracesSampleRate !== 'undefined') {
    // 如果父状态也未定义，则使用全局采样率 tracesSampleRate。
    sampleRate = options.tracesSampleRate;
  } else {
    // 如果上述都未定义且 enableTracing 为真，则默认为 100% 采样率
    sampleRate = 1;
  }

  // 由于这是来自用户提供的，所以我们得确保这个值是有效的 0~1

  // 解析采样率，确保其为有效值
  const parsedSampleRate = parseSampleRate(sampleRate);

  // 如果采样率无效，记录警告并返回 [false]
  if (parsedSampleRate === undefined) {
    DEBUG_BUILD &&
      logger.warn(
        '[Tracing] Discarding transaction because of invalid sample rate.',
      );
    return [false];
  }

  // 如果采样率为 0 或者 false，表示应该删除事务
  if (!parsedSampleRate) {
    DEBUG_BUILD &&
      logger.log(
        `[Tracing] Discarding transaction because ${
          typeof options.tracesSampler === 'function'
            ? 'tracesSampler returned 0 or false'
            : 'a negative sampling decision was inherited or tracesSampleRate is set to 0'
        }`,
      );
    return [false, parsedSampleRate];
  }

  // Now we roll the dice. Math.random is inclusive of 0, but not of 1, so strict < is safe here. In case sampleRate is
  // a boolean, the < comparison will cause it to be automatically cast to 1 if it's true and 0 if it's false.
  /**
   * 这段代码处理了采样决策的最后一步，具体来说，它通过生成随机数来确定是否保留该跨度
   *
   * parsedSampleRate 可能是一个介于 0 和 1 之间的数字，也可能是一个布尔值
   * 如果 parsedSampleRate 是 true，在比较中会被转换为 1；如果是 false，则会转换为 0。
   * 这意味着如果 parsedSampleRate 是 true，随机数必须小于 1 才能采样。
   * 如果 parsedSampleRate 是 false，随机数必须小于 0（这永远不会发生），因此一定不会采样。
   */
  // 使用 Math.random() 根据解析后的采样率决定是否采样
  const shouldSample = Math.random() < parsedSampleRate;

  // 表示该跨度不符合采样条件，需要丢弃
  if (!shouldSample) {
    // 在调试模式下（DEBUG_BUILD 为 true），记录一条日志，说明该事务由于不在随机采样中而被丢弃
    DEBUG_BUILD &&
      logger.log(
        `[Tracing] Discarding transaction because it's not included in the random sample (sampling rate = ${Number(
          sampleRate,
        )})`,
      );
    return [false, parsedSampleRate];
  }

  // 这一段代码实现了采样的随机决策逻辑，并根据结果决定是否丢弃该事务

  return [true, parsedSampleRate];
}
