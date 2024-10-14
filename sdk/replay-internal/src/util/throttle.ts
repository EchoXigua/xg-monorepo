/** 函数第一次被节流的状态 */
export const THROTTLED = '__THROTTLED';
/** 在后续调用中已经被节流的状态 */
export const SKIPPED = '__SKIPPED';

/**
 * 创建一个限制执行频率的函数（如窗口调整大小、鼠标滚动等），确保在指定的时间段内，一个特定的函数不会被调用超过指定的次数
 * 这个函数的行为在处理高频事件时非常有用，比如滚动、窗口调整大小或用户输入等
 * 
 * 如果在 durationSeconds（指定的秒数）时间段内调用超过了 maxCount（最大调用次数），则函数不再执行
 * 
 * THROTTLED：如果这是第一次被节流（即超过调用限制的第一次），函数返回 THROTTLED
 * SKIPPED：如果在同一时间段内再调用时仍然被节流（即已经超过了调用限制），函数返回 SKIPPED
 *
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function throttle<T extends (...rest: any[]) => any>(
  fn: T,
  maxCount: number,
  durationSeconds: number,
): (...rest: Parameters<T>) => ReturnType<T> | typeof THROTTLED | typeof SKIPPED {
  // 存储每秒的调用计数
  const counter = new Map<number, number>();

  // 清理旧条目，删除超出 durationSeconds 的条目
  const _cleanup = (now: number): void => {
    const threshold = now - durationSeconds;
    counter.forEach((_value, key) => {
      if (key < threshold) {
        counter.delete(key);
      }
    });
  };

  //  获取总调用次数
  const _getTotalCount = (): number => {
    return [...counter.values()].reduce((a, b) => a + b, 0);
  };

  // 跟踪当前函数是否处于节流状态
  let isThrottled = false;

  return (...rest: Parameters<T>): ReturnType<T> | typeof THROTTLED | typeof SKIPPED => {
    // 获取当前时间（秒）
    const now = Math.floor(Date.now() / 1000);

    // 首先，确保删除所有旧条目
    _cleanup(now);

    // 检查调用次数是否超过限制，如果超过限制，返回节流状态
    if (_getTotalCount() >= maxCount) {
      const wasThrottled = isThrottled;
      isThrottled = true;
      // 如果是第一次被节流，则返回 THROTTLED，否则返回 SKIPPED
      return wasThrottled ? SKIPPED : THROTTLED;
    }

    // 没有超过调用限制，更新当前时间的计数
    isThrottled = false;
    const count = counter.get(now) || 0;
    counter.set(now, count + 1);

    // 调用原始函数 fn
    return fn(...rest);
  };
}
