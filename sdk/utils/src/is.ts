const objectToString = Object.prototype.toString;

/**
 * 检查传入的是否符合Promise A+ 规范，也就是检查是否为promise
 * @param wat A value to be checked.
 */
export function isThenable(wat: any): wat is PromiseLike<any> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return Boolean(wat && wat.then && typeof wat.then === 'function');
}

/**
 * 用于检查一个给定的值是否是特定内置类（如 Array、Date、RegExp 等）
 *
 * @param wat The value to be checked
 * @param className
 * @returns A boolean representing the result.
 */
function isBuiltin(wat: unknown, className: string): boolean {
  return objectToString.call(wat) === `[object ${className}]`;
}

/**
 * 用于检查一个给定的值是否是一个普通对象字面量或类实例。
 *
 * {@link isPlainObject}.
 *
 * @param wat A value to be checked.
 * @returns A boolean representing the result.
 */
export function isPlainObject(wat: unknown): wat is Record<string, unknown> {
  return isBuiltin(wat, 'Object');
}
