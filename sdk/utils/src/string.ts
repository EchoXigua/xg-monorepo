import { isRegExp, isString, isVueViewModel } from './is';

/**
 * 检查给定的字符串是否匹配一个特定的字符串或正则表达式
 *
 * @param value 需要测试的字符串
 * @param pattern 一个正则表达式或字符串，用于与 value 进行匹配
 * @param requireExactStringMatch 如果为 true，则要求 value 与字符串模式完全匹配
 * 如果为 false，则只要求 value 包含该模式。
 */
export function isMatchingPattern(
  value: string,
  pattern: RegExp | string,
  requireExactStringMatch: boolean = false,
): boolean {
  if (!isString(value)) {
    // 不是字符串 直接返回 false
    return false;
  }

  // 正则
  if (isRegExp(pattern)) {
    return pattern.test(value);
  }

  // 字符串
  if (isString(pattern)) {
    return requireExactStringMatch
      ? value === pattern
      : value.includes(pattern);
  }

  return false;
}

/**
 * 这个函数检查给定的字符串是否匹配提供的字符串或正则表达式模式中的任意一个。
 *
 * @param testString 需要测试的字符串
 * @param patterns 一个字符串或正则表达式的数组，用于与 testString 进行匹配
 * @param requireExactStringMatch 如果为 true，则要求字符串与模式中的字符串完全匹配；
 * 如果为 false，则只要求字符串包含该模式
 *
 * @returns
 */
export function stringMatchesSomePattern(
  testString: string,
  patterns: Array<string | RegExp> = [],
  requireExactStringMatch: boolean = false,
): boolean {
  return patterns.some((pattern) =>
    // 如果有任意一个模式匹配成功，some 方法将返回 true
    isMatchingPattern(testString, pattern, requireExactStringMatch),
  );
}
