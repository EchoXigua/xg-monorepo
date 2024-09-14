import type { DynamicSamplingContext } from '@xigua-monitor/types';

import { DEBUG_BUILD } from './debug-build';
import { isString } from './is';
import { logger } from './logger';

export const BAGGAGE_HEADER_NAME = 'baggage';

export const SENTRY_BAGGAGE_KEY_PREFIX = 'sentry-';

export const SENTRY_BAGGAGE_KEY_PREFIX_REGEX = /^sentry-/;

/**
 * Max length of a serialized baggage string
 *
 * https://www.w3.org/TR/baggage/#limits
 */
export const MAX_BAGGAGE_STRING_LENGTH = 8192;

/**
 * 这个函数的作用是将一个 baggage header 转换为动态采样上下文（Dynamic Sampling Context, DSC）。
 * 从传入的 baggage header 中提取所有以 sentry- 开头的键，并构造一个包含这些键值对的对象，返回给调用者
 *
 * @param baggageHeader 一个非常宽泛定义的参数,因为不同的框架和环境可能以不同的方式传递 baggage 数据
 * @returns dsc
 */
export function baggageHeaderToDynamicSamplingContext(
  baggageHeader: string | string[] | number | null | undefined | boolean,
): Partial<DynamicSamplingContext> | undefined {
  // 将传入的参数转为对象格式
  const baggageObject = parseBaggageHeader(baggageHeader);

  // 传入的 baggage header 不能被解析，则返回 undefined，没有生成任何动态采样上下文
  if (!baggageObject) {
    return undefined;
  }

  // 遍历并提取带有 sentry- 前缀的键
  // entries 将对象的键值对转换为数组格式
  const dynamicSamplingContext = Object.entries(baggageObject).reduce<
    Record<string, string>
  >((acc, [key, value]) => {
    // 检查键是否以 sentry- 开头
    if (key.match(SENTRY_BAGGAGE_KEY_PREFIX_REGEX)) {
      // 匹配成功，移除 sentry- 前缀，保留剩下的部分作为最终的键名
      const nonPrefixedKey = key.slice(SENTRY_BAGGAGE_KEY_PREFIX.length);
      acc[nonPrefixedKey] = value;
    }
    return acc;
  }, {});

  // 只有当对象中有键时才返回动态采样上下文对象。
  // 获取动态采样上下文中的所有键,如果key 大于 0 说明里面有key,返回这个dsc
  if (Object.keys(dynamicSamplingContext).length > 0) {
    return dynamicSamplingContext as Partial<DynamicSamplingContext>;
  } else {
    return undefined;
  }
}

/**
 * Turns a Dynamic Sampling Object into a baggage header by prefixing all the keys on the object with "sentry-".
 *
 * @param dynamicSamplingContext The Dynamic Sampling Context to turn into a header. For convenience and compatibility
 * with the `getDynamicSamplingContext` method on the Transaction class ,this argument can also be `undefined`. If it is
 * `undefined` the function will return `undefined`.
 * @returns a baggage header, created from `dynamicSamplingContext`, or `undefined` either if `dynamicSamplingContext`
 * was `undefined`, or if `dynamicSamplingContext` didn't contain any values.
 */
export function dynamicSamplingContextToSentryBaggageHeader(
  // this also takes undefined for convenience and bundle size in other places
  dynamicSamplingContext?: Partial<DynamicSamplingContext>,
): string | undefined {
  if (!dynamicSamplingContext) {
    return undefined;
  }

  // Prefix all DSC keys with "sentry-" and put them into a new object
  const sentryPrefixedDSC = Object.entries(dynamicSamplingContext).reduce<
    Record<string, string>
  >((acc, [dscKey, dscValue]) => {
    if (dscValue) {
      acc[`${SENTRY_BAGGAGE_KEY_PREFIX}${dscKey}`] = dscValue;
    }
    return acc;
  }, {});

  return objectToBaggageHeader(sentryPrefixedDSC);
}

/**
 * 将传入的 baggageHeader（可能是一个字符串、字符串数组、数字、null 或者 undefined）解析为一个对象
 * 这个对象的键值对可以表示 HTTP baggage 头中的键值对
 */
export function parseBaggageHeader(
  baggageHeader: string | string[] | number | null | undefined | boolean,
): Record<string, string> | undefined {
  if (
    // 为null 或者undefined
    !baggageHeader ||
    // 不是字符串 且 不是数组
    (!isString(baggageHeader) && !Array.isArray(baggageHeader))
  ) {
    // 返回 undefined，意味着输入无效
    return undefined;
  }

  // 处理数组形式
  if (Array.isArray(baggageHeader)) {
    // 遍历这个数组,将每一个元素传递给 baggageHeaderToObject 函数进行处理
    return baggageHeader.reduce<Record<string, string>>((acc, curr) => {
      // 将每个字符串解析为键值对，并将结果合并到一个对象中
      const currBaggageObject = baggageHeaderToObject(curr);

      // 处理这个对象中的键值对
      Object.entries(currBaggageObject).forEach(([key, value]) => {
        acc[key] = value;
      });
      return acc;
    }, {});
    // 经过reduce 处理后,数组中的所有值都会合并到一个对象上
  }

  // 处理字符串形式
  return baggageHeaderToObject(baggageHeader);
}

/**
 * 将一个 baggage header（它是一个简单的键值对映射）解析成一个扁平的对象
 *
 * @param baggageHeader The baggage header to parse.
 * @returns a flat object containing all the key-value pairs from `baggageHeader`.
 */
function baggageHeaderToObject(baggageHeader: string): Record<string, string> {
  // "key1=value1,key2=value2,key3=value3"
  return (
    baggageHeader
      .split(',')
      // ["key1=value1", "key2=value2", "key3=value3"]
      .map((baggageEntry) =>
        baggageEntry
          .split('=')
          // ["key1","value1"]
          // 移除多余的空格并对可能存在的 URL 编码字符进行解码
          .map((keyOrValue) => decodeURIComponent(keyOrValue.trim())),
      )
      .reduce<Record<string, string>>((acc, [key, value]) => {
        if (key && value) {
          acc[key] = value;
        }
        return acc;
      }, {})
  );
}

/**
 * Turns a flat object (key-value pairs) into a baggage header, which is also just key-value pairs.
 *
 * @param object The object to turn into a baggage header.
 * @returns a baggage header string, or `undefined` if the object didn't have any values, since an empty baggage header
 * is not spec compliant.
 */
function objectToBaggageHeader(
  object: Record<string, string>,
): string | undefined {
  if (Object.keys(object).length === 0) {
    // An empty baggage header is not spec compliant: We return undefined.
    return undefined;
  }

  return Object.entries(object).reduce(
    (baggageHeader, [objectKey, objectValue], currentIndex) => {
      const baggageEntry = `${encodeURIComponent(objectKey)}=${encodeURIComponent(objectValue)}`;
      const newBaggageHeader =
        currentIndex === 0 ? baggageEntry : `${baggageHeader},${baggageEntry}`;
      if (newBaggageHeader.length > MAX_BAGGAGE_STRING_LENGTH) {
        DEBUG_BUILD &&
          logger.warn(
            `Not adding key: ${objectKey} with val: ${objectValue} to baggage header due to exceeding baggage size limits.`,
          );
        return baggageHeader;
      } else {
        return newBaggageHeader;
      }
    },
    '',
  );
}
