import { setTimeout } from '@xigua-monitor/browser-utils';

type DebouncedCallback = {
  (): void | unknown;
  // 立即调用被防抖的函数
  flush: () => void | unknown;
  // 取消防抖，重置计时器
  cancel: () => void;
};
type CallbackFunction = () => unknown;
// 用于指定最大等待时间
type DebounceOptions = { maxWait?: number };

/**
 * 简单的 debounce 函数，模仿了 lodash.debounce 的行为
 *
 * This function takes a callback function (@param fun) and delays its invocation
 * by @param wait milliseconds. Optionally, a maxWait can be specified in @param options,
 * which ensures that the callback is invoked at least once after the specified max. wait time.
 *
 * @param func the function whose invocation is to be debounced
 * @param wait the minimum time until the function is invoked after it was called once
 * @param options the options object, which can contain the `maxWait` property
 *
 * @returns the debounced version of the function, which needs to be called at least once to start the
 *          debouncing process. Subsequent calls will reset the debouncing timer and, in case @paramfunc
 *          was already invoked in the meantime, return @param func's return value.
 *          The debounced function has two additional properties:
 *          - `flush`: Invokes the debounced function immediately and returns its return value
 *          - `cancel`: Cancels the debouncing process and resets the debouncing timer
 */
export function debounce(func: CallbackFunction, wait: number, options?: DebounceOptions): DebouncedCallback {
  // 存储回调函数的返回值
  let callbackReturnValue: unknown;
// 存储普通定时器
  let timerId: ReturnType<typeof setTimeout> | undefined;
  // 存储最大等待定时器的 ID
  let maxTimerId: ReturnType<typeof setTimeout> | undefined;

  const maxWait = options && options.maxWait ? Math.max(options.maxWait, wait) : 0;

  // 负责清除定时器，调用 func，并返回其值
  function invokeFunc(): unknown {
    cancelTimers();
    callbackReturnValue = func();
    return callbackReturnValue;
  }

  // 清除所有定时器
  function cancelTimers(): void {
    timerId !== undefined && clearTimeout(timerId);
    maxTimerId !== undefined && clearTimeout(maxTimerId);
    timerId = maxTimerId = undefined;
  }

  // 如果有定时器正在等待，则立即调用 invokeFunc，否则返回最后的返回值
  function flush(): unknown {
    if (timerId !== undefined || maxTimerId !== undefined) {
      return invokeFunc();
    }
    return callbackReturnValue;
  }

  function debounced(): unknown {
    // 清除当前的定时器（如果存在），然后设置一个新的定时器
    if (timerId) {
      clearTimeout(timerId);
    }
    timerId = setTimeout(invokeFunc, wait);

    // 如果设置了 maxWait，则也设置最大等待定时器
    /**
     * 这里设置最大等待定时器的作用：
     * 如果用户在短时间内多次触发某个事件（例如输入框的键入事件），普通的 debounce 机制会导致目标函数在最后一次触发后的一段时间后才执行。
     * 然而，如果用户持续触发事件，函数可能根本不会执行。
     * 设置最大等待时间可以确保即使事件持续发生，函数也能在最大等待时间内被执行一次
     */
    if (maxWait && maxTimerId === undefined) {
      maxTimerId = setTimeout(invokeFunc, maxWait);
    }

    return callbackReturnValue;
  }

  debounced.cancel = cancelTimers;
  debounced.flush = flush;
  return debounced;
}
