import { isRegExp, isString, isVueViewModel } from './is';

/**
 * 将给定字符串截断为最大字符数
 *
 * @param str An object that contains serializable values
 * @param max Maximum number of characters in truncated string (0 = unlimited)
 * @returns string Encoded
 */
export function truncate(str: string, max: number = 0): string {
  if (typeof str !== 'string' || max === 0) {
    return str;
  }
  return str.length <= max ? str : `${str.slice(0, max)}...`;
}

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

/**
 * Join values in array
 * @param input array of values to be joined together
 * @param delimiter string to be placed in-between values
 * @returns Joined values
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function safeJoin(input: any[], delimiter?: string): string {
  if (!Array.isArray(input)) {
    return '';
  }

  const output = [];
  // eslint-disable-next-line @typescript-eslint/prefer-for-of
  for (let i = 0; i < input.length; i++) {
    const value = input[i];
    try {
      // This is a hack to fix a Vue3-specific bug that causes an infinite loop of
      // console warnings. This happens when a Vue template is rendered with
      // an undeclared variable, which we try to stringify, ultimately causing
      // Vue to issue another warning which repeats indefinitely.
      // see: https://github.com/getsentry/sentry-javascript/pull/8981
      if (isVueViewModel(value)) {
        output.push('[VueViewModel]');
      } else {
        output.push(String(value));
      }
    } catch (e) {
      output.push('[value cannot be serialized]');
    }
  }

  return output.join(delimiter);
}
