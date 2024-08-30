/**
 * 装传入的数据转为数组
 * @param maybeArray
 * @returns
 */
export function arrayify<T = unknown>(maybeArray: T | T[]): T[] {
  return Array.isArray(maybeArray) ? maybeArray : [maybeArray];
}
