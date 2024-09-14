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

/**
 * 用于存储当前使用的时间源模式,（如 timeOrigin、navigationStart 或 dateNow），仅用于调试。
 */
export let _browserPerformanceTimeOriginMode: string;

/**
 * 立即调用的函数表达式 (IIFE)，它会在模块加载时立即执行，并返回一个数字或未定义的值。
 * 仅在浏览器中使用,且 performance API 支持的情况下
 */
export const browserPerformanceTimeOrigin = ((): number | undefined => {
  // Unfortunately browsers may report an inaccurate time origin data, through either performance.timeOrigin or
  // performance.timing.navigationStart, which results in poor results in performance data. We only treat time origin
  // data as reliable if they are within a reasonable threshold of the current time.

  // 从全局对象中获取 performance
  const { performance } = GLOBAL_OBJ as typeof GLOBAL_OBJ & Window;

  if (!performance || !performance.now) {
    // 如果不存在或者不支持 now 方法 将模式设置为 'none' 并返回 undefined
    _browserPerformanceTimeOriginMode = 'none';
    return undefined;
  }

  /** 定义一个阈值为 1 小时 */
  const threshold = 3600 * 1000;
  /** 获取高精度时间戳（相对当前页面加载的时间 */
  const performanceNow = performance.now();
  /** 获取的系统时间戳 */
  const dateNow = Date.now();

  // 计算时间偏差
  // 如果timeOrigin不可用，将 delta 设置为阈值，使其不被使用
  /**
   * timeOrigin:
   *    是一个高精度的时间戳，表示文档加载开始的时间。
   *    在不同的浏览器中，支持情况可能有所不同。例如，在 Safari 中，
   *    performance.timeOrigin 可能是 undefined。因此，在使用这个属性时需要注意浏览器的兼容性
   *
   * performance.now()
   *    返回一个表示自页面加载以来经过的毫秒数（带小数），可以用于精确的时间测量。
   *    返回的值是相对于页面加载时间的增量时间，通常以毫秒为单位，精确到小数点后 1 位
   * @example
   *    假设一个函数在页面加载后运行，调用 performance.now() 可以获取这个函数执行时的精确时间。
   *
   * Date.now()
   *    获取当前的时间戳，通常用于一般的时间记录，不涉及页面加载的上下文
   *    精度较低，通常只提供到毫秒级，而不提供微秒或纳秒级的精度
   */
  const timeOriginDelta = performance.timeOrigin
    ? Math.abs(performance.timeOrigin + performanceNow - dateNow)
    : threshold;
  // 判断其是否在阈值内
  const timeOriginIsReliable = timeOriginDelta < threshold;

  /**
   * 1. 性能时间戳的演变:
   *  performance.timing.navigationStart:
   *    - 这个属性在早期的 Web 性能 API 中用于表示文档开始加载的时间。
   *    它是基于页面导航的开始时间，通常被用作性能测量的基准点。
   *    - 然而，由于一些限制（如其不够精确，且不适用于所有场景），navigationStart 已被标记为已弃用。
   *
   *  performance.timeOrigin:
   *    - 这个属性是在 performance API 中引入的，用于提供文档开始加载的时间戳，且精度更高。
   *    - 虽然 timeOrigin 是更现代的选择，但其支持情况并不如 performance.timing 广泛，
   *    尤其在某些浏览器（如 Safari）中，performance.timeOrigin 可能是 undefined。
   *
   * 2. 浏览器支持情况
   *  Safari:
   *    - 在 Safari 浏览器中，performance.timeOrigin 在某些情况下可能不可用。
   *    这意味着开发者在使用该属性时需要进行适当的兼容性检查，以确保代码能够在所有目标浏览器中正常工作。
   *  Web Workers:
   *    - 在 Web Workers 中，performance.timing 也不可用。这限制了开发者在后台线程中获取性能时间戳的能力。
   *    Web Workers 是一种在后台线程中执行 JavaScript 的方式，通常用于处理不阻塞主线程的耗时任务。
   *
   * 3. 回退到 Date API
   *    如果浏览器不支持 performance.timeOrigin，则开发者可以选择退回到 Date.now()
   *    尽管 Date.now() 的精度低于 performance.now() 和 performance.timeOrigin，但它在几乎所有环境中都是可用的，确保了代码的兼容性。
   */
  // eslint-disable-next-line deprecation/deprecation
  const navigationStart =
    performance.timing && performance.timing.navigationStart;
  const hasNavigationStart = typeof navigationStart === 'number';
  // 如果navigationStart不可用，设置delta为threshold，不使用它
  const navigationStartDelta = hasNavigationStart
    ? Math.abs(navigationStart + performanceNow - dateNow)
    : threshold;
  const navigationStartIsReliable = navigationStartDelta < threshold;
  // 这里的逻辑和 上面的类似

  // 如果 timeOrigin 或 navigationStart 有可靠的时间源
  if (timeOriginIsReliable || navigationStartIsReliable) {
    // 根据偏差选择更可靠的时间源，并更新 _browserPerformanceTimeOriginMode。
    if (timeOriginDelta <= navigationStartDelta) {
      _browserPerformanceTimeOriginMode = 'timeOrigin';
      return performance.timeOrigin;
    } else {
      _browserPerformanceTimeOriginMode = 'navigationStart';
      return navigationStart;
    }
  }

  // 如果没有可靠的时间源，默认返回当前的系统时间
  _browserPerformanceTimeOriginMode = 'dateNow';
  return dateNow;
})();
