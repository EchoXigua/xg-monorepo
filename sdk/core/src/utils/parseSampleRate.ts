import { logger } from '@xigua-monitor/utils';
import { DEBUG_BUILD } from '../debug-build';

/**
 * 这个函数的目的是从给定的值中解析出一个有效的采样率
 * This will either return a boolean or number sample rate, if the sample rate is valid (between 0 and 1).
 * If a string is passed, we try to convert it to a number.
 *
 * Any invalid sample rate will return `undefined`.
 */
export function parseSampleRate(sampleRate: unknown): number | undefined {
  // 如果是 布尔值 将其转为数字 true --->1   false ---->0
  if (typeof sampleRate === 'boolean') {
    return Number(sampleRate);
  }

  // 字符串将其解析为浮点数
  const rate =
    typeof sampleRate === 'string' ? parseFloat(sampleRate) : sampleRate;

  // 检查是否为数字类型，如果不是数字类型 或者 是 nan ，rate 需要在 0-1之间
  if (typeof rate !== 'number' || isNaN(rate) || rate < 0 || rate > 1) {
    // 如果 rate 无效，则在调试模式下记录一条警告日志，说明给定的采样率无效，并返回 undefined
    DEBUG_BUILD &&
      logger.warn(
        `[Tracing] Given sample rate is invalid. Sample rate must be a boolean or a number between 0 and 1. Got ${JSON.stringify(
          sampleRate,
        )} of type ${JSON.stringify(typeof sampleRate)}.`,
      );
    return undefined;
  }

  // 返回有效的采样率
  return rate;
}
