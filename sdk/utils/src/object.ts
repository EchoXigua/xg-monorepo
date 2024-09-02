import type { WrappedFunction } from '@xigua-monitor/types';

import { DEBUG_BUILD } from './debug-build';
import { logger } from './logger';
import {
  // isElement,
  // isError,
  // isEvent,
  // isInstanceOf,
  isPlainObject,
  // isPrimitive,
} from './is';

/**
 * 函数的主要作用是用一个包装版本替代对象中的某个方法，同时保留原始方法，
 * 以便后续在包装方法中能够调用原始方法。
 * 这种技术在监控、错误处理或日志记录等场景中非常有用。
 *
 * @param source 一个对象，包含需要被包装的方法
 * @param name 要包装的方法的名称
 * @param replacementFactory  一个高阶函数，接受原始方法并返回一个包装版本。
 * 返回的函数必须是普通函数(非箭头函数)，以便保留正确的 this 上下文
 * 通过 call apply 去调用，而不是直接调用，这样能正确的使用this
 *
 * @returns void
 */
export function fill(
  source: { [key: string]: any },
  name: string,
  replacementFactory: (...args: any[]) => any,
): void {
  // 指定的方法不存在，直接返回
  if (!(name in source)) {
    return;
  }

  // 获取原始方法:
  const original = source[name] as () => any;
  // 获取包装后的方法
  const wrapped = replacementFactory(original) as WrappedFunction;

  // 检查 wrapped 是否为一个函数。如果是，标记这个函数，记住原始函数。
  if (typeof wrapped === 'function') {
    markFunctionWrapped(wrapped, original);
  }

  // 替换原始方法
  source[name] = wrapped;
}

/**
 * 用于在给定的对象上定义一个不可枚举的属性
 *
 * @param obj 目标对象，即要在其上定义属性的对象
 * @param name 要定义的属性名称
 * @param value 要赋予该属性的值
 */
export function addNonEnumerableProperty(
  obj: object,
  name: string,
  value: unknown,
): void {
  try {
    Object.defineProperty(obj, name, {
      // enumerable: 是否可枚举。这里被注释掉了，因为 enumerable: false 是默认值，为了减少打包后的代码大小，不显式地设置它。
      value: value,
      writable: true,
      configurable: true,
    });
  } catch (o_O) {
    // 在某些情况下，Object.defineProperty 可能会因为对象被冻结（Object.freeze）或其他原因导致失败
    DEBUG_BUILD &&
      logger.log(
        `Failed to add non-enumerable property "${name}" to object`,
        obj,
      );
  }
}

/**
 * Remembers the original function on the wrapped function and
 * patches up the prototype.
 *
 * @param wrapped 被包装后的函数
 * @param original 原始的未包装函数
 */
export function markFunctionWrapped(
  wrapped: WrappedFunction,
  original: WrappedFunction,
): void {
  try {
    // 尝试将 wrapped 和 original 的原型设置为相同的对象
    // 为了确保在使用 instanceof 检查时能够正确工作
    const proto = original.prototype || {};
    wrapped.prototype = original.prototype = proto;

    // 将原始方法添加为 wrapped 的一个非枚举属性，这样可以在后续需要时获取原始方法
    addNonEnumerableProperty(wrapped, '__sentry_original__', original);
  } catch (o_O) {} // eslint-disable-line no-empty
}

/**
 *
 * 这个函数的目的是从给定对象中移除所有值为 undefined 的字段。
 * 它支持对对象和数组进行递归处理，并且能够处理循环引用。
 *
 * Attention: This function keeps circular references in the returned object.
 */
export function dropUndefinedKeys<T>(inputValue: T): T {
  // This map keeps track of what already visited nodes map to.
  // Our Set - based memoBuilder doesn't work here because we want to the output object to have the same circular
  // references as the input object.
  // 用于跟踪已经访问过的节点，以处理循环引用
  const memoizationMap = new Map<unknown, unknown>();

  // This function just proxies `_dropUndefinedKeys` to keep the `memoBuilder` out of this function's API
  // 这是一个递归函数，实际执行移除 undefined 值的操作
  return _dropUndefinedKeys(inputValue, memoizationMap);
}

/**
 *
 * @param inputValue 待处理的输入值
 * @param memoizationMap 用于记录已经访问的对象，以避免重复处理
 * @returns
 */
function _dropUndefinedKeys<T>(
  inputValue: T,
  memoizationMap: Map<unknown, unknown>,
): T {
  // 检查输入值是否是一个普通对象
  if (isPojo(inputValue)) {
    // 检查是否已经访问过该对象
    const memoVal = memoizationMap.get(inputValue);
    if (memoVal !== undefined) {
      // 访问过了 直接返回
      return memoVal as T;
    }

    // 创建一个新的返回对象
    const returnValue: { [key: string]: any } = {};
    // 将其映射到 memoizationMap 中
    memoizationMap.set(inputValue, returnValue);

    // 遍历这个对象上的所有key，不等于 undefined 的，就会递归调用，进一步获取值
    for (const key of Object.keys(inputValue)) {
      if (typeof inputValue[key] !== 'undefined') {
        returnValue[key] = _dropUndefinedKeys(inputValue[key], memoizationMap);
      }
    }

    return returnValue as T;
  }

  // 对于数组，采用类似的方法，检查是否已经访问过该数组，创建新的返回数组
  if (Array.isArray(inputValue)) {
    const memoVal = memoizationMap.get(inputValue);
    if (memoVal !== undefined) {
      return memoVal as T;
    }

    const returnValue: unknown[] = [];
    memoizationMap.set(inputValue, returnValue);

    inputValue.forEach((item: unknown) => {
      returnValue.push(_dropUndefinedKeys(item, memoizationMap));
    });

    return returnValue as unknown as T;
  }

  // 如果输入值既不是对象也不是数组，则直接返回该值
  return inputValue;
}

/**
 * 这个函数用于判断一个值是否为普通对象
 *
 * @param input
 * @returns
 */
function isPojo(input: unknown): input is Record<string, unknown> {
  if (!isPlainObject(input)) {
    return false;
  }

  try {
    // 过检查对象的原型链来确定其构造函数的名称，以此判断该对象是否为普通对象
    const name = (
      Object.getPrototypeOf(input) as { constructor: { name: string } }
    ).constructor.name;
    return !name || name === 'Object';
  } catch {
    return true;
  }
}

/**
 * 这个函数的作用从一个被包装的函数中提取出其原始版本
 *
 * See `markFunctionWrapped` for more information.
 *
 * @param func 一个被包装的函数
 * 这个函数应该包含一个特殊属性 __sentry_original__，用于存储原始函数
 *
 * @returns 返回 func 的原始函数
 */
export function getOriginalFunction(
  func: WrappedFunction,
): WrappedFunction | undefined {
  return func.__sentry_original__;
}
