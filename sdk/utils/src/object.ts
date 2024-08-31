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
