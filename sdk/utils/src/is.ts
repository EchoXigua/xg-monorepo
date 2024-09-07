import type {
  ParameterizedString,
  PolymorphicEvent,
  Primitive,
} from '@xigua-monitor/types';

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

/**
 * Checks whether given value's type is a string
 * {@link isString}.
 *
 * @param wat A value to be checked.
 * @returns A boolean representing the result.
 */
export function isString(wat: unknown): wat is string {
  return isBuiltin(wat, 'String');
}

/**
 * Checks whether given value's type is an regexp
 * {@link isRegExp}.
 *
 * @param wat A value to be checked.
 * @returns A boolean representing the result.
 */
export function isRegExp(wat: unknown): wat is RegExp {
  return isBuiltin(wat, 'RegExp');
}

interface VueViewModel {
  // Vue3
  __isVue?: boolean;
  // Vue2
  _isVue?: boolean;
}
/**
 * Checks whether given value's type is a Vue ViewModel.
 *
 * @param wat A value to be checked.
 * @returns A boolean representing the result.
 */
export function isVueViewModel(wat: unknown): boolean {
  // Not using Object.prototype.toString because in Vue 3 it would read the instance's Symbol(Symbol.toStringTag) property.
  return !!(
    typeof wat === 'object' &&
    wat !== null &&
    ((wat as VueViewModel).__isVue || (wat as VueViewModel)._isVue)
  );
}

/**
 * Checks whether given value's type is an Element instance
 * {@link isElement}.
 *
 * @param wat A value to be checked.
 * @returns A boolean representing the result.
 */
export function isElement(wat: unknown): boolean {
  return typeof Element !== 'undefined' && isInstanceOf(wat, Element);
}

/**
 * 检查给定值的类型是否为所提供构造函数的实例
 *
 * {@link isInstanceOf}.
 *
 * @param wat A value to be checked.
 * @param base A constructor to be used in a check.
 * @returns A boolean representing the result.
 */
export function isInstanceOf(wat: any, base: any): boolean {
  try {
    return wat instanceof base;
  } catch (_e) {
    return false;
  }
}

/**
 * 检查给定值的类型是否为几个Error或Error-like类型之一
 * {@link isError}.
 *
 * @param wat A value to be checked.
 * @returns A boolean representing the result.
 */
export function isError(wat: unknown): wat is Error {
  switch (objectToString.call(wat)) {
    case '[object Error]':
    case '[object Exception]':
    case '[object DOMException]':
      return true;
    default:
      return isInstanceOf(wat, Error);
  }
}

/**
 * 检查给定值的类型是否为Event实例
 * {@link isEvent}.
 *
 * @param wat A value to be checked.
 * @returns A boolean representing the result.
 */
export function isEvent(wat: unknown): wat is PolymorphicEvent {
  return typeof Event !== 'undefined' && isInstanceOf(wat, Event);
}

/**
 * Checks whether given value is a primitive (undefined, null, number, boolean, string, bigint, symbol)
 * {@link isPrimitive}.
 *
 * @param wat A value to be checked.
 * @returns A boolean representing the result.
 */
export function isPrimitive(wat: unknown): wat is Primitive {
  return (
    wat === null ||
    isParameterizedString(wat) ||
    (typeof wat !== 'object' && typeof wat !== 'function')
  );
}

/**
 * Checks whether given string is parameterized
 * {@link isParameterizedString}.
 *
 * @param wat A value to be checked.
 * @returns A boolean representing the result.
 */
export function isParameterizedString(
  wat: unknown,
): wat is ParameterizedString {
  return (
    typeof wat === 'object' &&
    wat !== null &&
    '__sentry_template_string__' in wat &&
    '__sentry_template_values__' in wat
  );
}

/**
 *
 * {@link isDOMError}.
 *
 * @param wat A value to be checked.
 * @returns A boolean representing the result.
 */
export function isDOMError(wat: unknown): boolean {
  return isBuiltin(wat, 'DOMError');
}

/**
 *
 * {@link isDOMException}.
 *
 * @param wat A value to be checked.
 * @returns A boolean representing the result.
 */
export function isDOMException(wat: unknown): boolean {
  return isBuiltin(wat, 'DOMException');
}

/**
 * Checks whether given value's type is ErrorEvent
 * {@link isErrorEvent}.
 *
 * @param wat A value to be checked.
 * @returns A boolean representing the result.
 */
export function isErrorEvent(wat: unknown): boolean {
  return isBuiltin(wat, 'ErrorEvent');
}

/**
 * Checks whether given value's type is a SyntheticEvent
 * {@link isSyntheticEvent}.
 *
 * @param wat A value to be checked.
 * @returns A boolean representing the result.
 */
export function isSyntheticEvent(wat: unknown): boolean {
  return (
    isPlainObject(wat) &&
    'nativeEvent' in wat &&
    'preventDefault' in wat &&
    'stopPropagation' in wat
  );
}
