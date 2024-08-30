import { GLOBAL_OBJ } from './worldwide';

const ONE_SECOND_IN_MS = 1000;

/**
 * 函数返回自 UNIX 纪元（1970 年 1 月 1 日 00:00:00 UTC）以来的时间戳，单位为秒。
 *
 * 在未来版本（v8）中将返回值进行舍入，因为当前实现可能会返回带小数的秒数时间戳
 */
export function dateTimestampInSeconds(): number {
  // ate.now() 方法获取当前的毫秒级时间戳
  // 将其除以 1000（即 ONE_SECOND_IN_MS）将其转换为秒
  return Date.now() / ONE_SECOND_IN_MS;
}

/**
 * 函数返回一个函数，该函数用于生成当前时间的 UNIX 时间戳（秒），这个时间戳考虑了浏览器的 Performance API 提供的更精确的时间测量功能。
 *
 * Wrapping the native API works around differences in behavior from different browsers.
 */
function createUnixTimestampInSecondsFunc(): () => number {
  // 从全局对象获取 performance
  const { performance } = GLOBAL_OBJ as typeof GLOBAL_OBJ & {
    performance?: Performance;
  };
  // 检查 performance  api 是否可用（浏览器是否支持）
  if (!performance || !performance.now) {
    // 不可用则回退使用 dateTimestampInSeconds
    return dateTimestampInSeconds;
  }

  // 一些浏览器和环境没有timeOrigin，所以我们退回到使用Date.now()来计算开始时间。
  // 计算得到一个近似的 timeOrigin，这个时间起点代表了开始计时的时间点（大致等于页面加载开始的时间点）
  const approxStartingTimeOrigin = Date.now() - performance.now();

  // 如果浏览器提供了 timeOrigin 则使用，没有则使用计算的
  const timeOrigin =
    performance.timeOrigin == undefined
      ? approxStartingTimeOrigin
      : performance.timeOrigin;

  /**
   * Date.now()： 返回的是当前的 UNIX 时间戳，以毫秒为单位
   * performance.now()：
   *  - 是从性能计时开始（通常是页面加载开始时刻）到当前的时间差，也就是一个从 0 开始增加的时间，以毫秒为单位。
   *  - 它是一个单调递增的时钟，这意味着它不会因为系统时间的改变而回退或前进。因此，它特别适合测量时间间隔。
   *  - performance.now() 的精度更高，可以精确到小数点后三位
   *
   * 通过 Date.now() 减去 performance.now() 可以得到一个接近于页面加载时刻的 UNIX 时间戳，这个时间戳就是 approxStartingTimeOrigin。
   *
   * performance.timeOrigin:
   *   浏览器性能计时的起始时间，即 performance.now() 开始计时的时刻。这是一个 UNIX 时间戳，通常等于页面加载的时间
   *
   */

  /**
   * performance.now() 是一个单调递增的时钟，意味着它从 0 开始计时，并且始终以固定的速率增加，不会受到系统时间变化的影响
   * 要计算当前的实际时间（即 UNIX 时间戳，通常是指自 1970 年 1 月 1 日以来的秒数），
   * 需要将 performance.now() 的值加上“时间起点”（即 performance.timeOrigin 或 approxStartingTimeOrigin）。
   * 时间起点是浏览器加载页面时的实际时间，而 performance.now() 是自该起点以来经过的时间。将这两者相加即可得出当前的实际时间
   *
   * TODO：
   * 这段代码未处理一个潜在问题：performance.now() 所依赖的单调时钟可能会与实际的“墙上时钟”（即系统时间）发生偏差。
   * 如果系统时间发生了变化（例如手动调整时间、夏令时切换等），那么使用 Date.now() 计算出的 approxStartingTimeOrigin 可能会产生误差。
   * 这种偏差可能会导致返回的时间戳不准确。比如，如果 performance.now() 与 Date.now() 之间的计算有误差，
   * 那么最终计算出的 UNIX 时间戳可能不再是精确的实际时间。
   * 代码的作者建议，应该研究如何检测和修正这种时钟漂移问题，以确保返回的时间戳始终准确。
   * 可能的方案包括定期同步 performance.now() 和 Date.now()，或者通过其他机制检测时钟的漂移并进行修正。
   *
   * See: https://github.com/getsentry/sentry-javascript/issues/2590
   * See: https://github.com/mdn/content/issues/4713
   * See: https://dev.to/noamr/when-a-millisecond-is-not-a-millisecond-3h6
   */
  return () => {
    // 最终返回的函数通过将 timeOrigin 和 performance.now() 相加得到当前时间戳，并将其转换为秒数
    return (timeOrigin + performance.now()) / ONE_SECOND_IN_MS;
  };
}

/**
 * 返回一个获取时间戳的函数（以秒为单位）
 * 它根据浏览器是否支持 Performance API 来选择使用 Performance API 或 Date API 获取时间戳
 *
 * 这里提到一个已知的bug：
 * 由于浏览器实现 Performance API 的方式，当计算机进入睡眠模式时， Performance API 所依赖的时钟可能会停止。
 * 这意味着当计算机从睡眠状态恢复时，performance.now() 所返回的时间将不会包括计算机处于睡眠状态的那段时间。
 * 这种时钟停止的情况会导致 dateTimestampInSeconds 和 timestampInSeconds 之间产生偏差（skew）。
 * 这种偏差可能会随着计算机进入睡眠的时间长短而增大，可能达到数天、数周甚至数月
 * See https://github.com/getsentry/sentry-javascript/issues/2590.
 */
export const timestampInSeconds = createUnixTimestampInSecondsFunc();
