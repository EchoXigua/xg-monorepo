import { DEBUG_BUILD } from './debug-build';
import { logger } from './logger';

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
