import type {
  Event,
  Exception,
  Mechanism,
  StackFrame,
} from '@xigua-monitor/types';

import { GLOBAL_OBJ } from './worldwide';

interface CryptoInternal {
  getRandomValues(array: Uint8Array): Uint8Array;
  randomUUID?(): string;
}

/** An interface for common properties on global */
interface CryptoGlobal {
  msCrypto?: CryptoInternal;
  crypto?: CryptoInternal;
}

/**
 * 装传入的数据转为数组
 * @param maybeArray
 * @returns
 */
export function arrayify<T = unknown>(maybeArray: T | T[]): T[] {
  return Array.isArray(maybeArray) ? maybeArray : [maybeArray];
}

/**
 * 这个函数用于生成 UUIDv4（版本4 UUID）
 *
 * @returns string Generated UUID4.
 */
export function uuid4(): string {
  // 获取全局对象
  const gbl = GLOBAL_OBJ as typeof GLOBAL_OBJ & CryptoGlobal;

  // 从全局对象中获取 crypto 属性
  // crypto 是用于加密操作的 Web API，msCrypto 是针对旧版本 Internet Explorer 的兼容性处理
  const crypto = gbl.crypto || gbl.msCrypto;

  // 定义一个默认函数，使用 Math.random() 生成一个 0 到 16 之间的随机数。
  let getRandomByte = (): number => Math.random() * 16;
  try {
    // 如果浏览器支持 crypto.randomUUID 方法，直接调用它生成 UUID，并去掉其中的破折号
    if (crypto && crypto.randomUUID) {
      return crypto.randomUUID().replace(/-/g, '');
    }

    // 如果支持 getRandomValues，则重定义 getRandomByte 函数，以安全地生成随机数。
    if (crypto && crypto.getRandomValues) {
      getRandomByte = () => {
        // crypto.getRandomValues might return undefined instead of the typed array
        // in old Chromium versions (e.g. 23.0.1235.0 (151422))
        // However, `typedArray` is still filled in-place.
        // @see https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues#typedarray

        // 创建一个长度为 1 的 Uint8Array，表示无符号的 8 位整数数组。
        // 在这里，我们用它来存储一个随机字节。
        const typedArray = new Uint8Array(1);
        // 这是一个安全的随机数生成函数。它填充传入的 typedArray
        // 使其每个元素都包含一个随机的 8 位无符号整数（范围在 0 到 255 之间）
        crypto.getRandomValues(typedArray);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        // 返回 typedArray 中的第一个随机字节
        return typedArray[0]!;
      };
    }
  } catch (_) {
    // some runtimes can crash invoking crypto
    // https://github.com/getsentry/sentry-javascript/issues/8935
  }

  // http://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid-in-javascript/2117523#2117523
  // Concatenating the following numbers as strings results in '10000000100040008000100000000000'
  /**
   * UUIDv4 的结构是 xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
   * x 是一个随机的十六进制数字（0-9, a-f）
   * 4 固定表示版本号。
   * y 是一个随机数，范围在 8-11 之间，表示变体
   *
   * 1e7、1e3、4e3 和 1e11：这些都是科学记数法表示的数字：
   * 1e7 等于 10,000,000
   * 1e3 等于 1,000
   * 4e3 等于 4,000
   * 1e11 等于 100,000,000,000
   *
   * [1e7] 在运算的时候会转为基本类型，最终会调用toString 转为 字符串的1e7
   * 后面的加法运算都是字符串的拼接
   *
   * 经过拼接后，会得到一个大致的 UUID 字符串，形状为 10000000100040008000100000000000
   * 这只是一个基础格式，接下来需要根据 UUID 的规则进一步处理
   */
  return (([1e7] as unknown as string) + 1e3 + 4e3 + 8e3 + 1e11).replace(
    //  匹配 UUID 中的 0、1 和 8，并使用 getRandomByte 函数生成的随机数进行替换，生成最终的 UUID 字符串
    /[018]/g,
    (c) =>
      // eslint-disable-next-line no-bitwise
      (
        (c as unknown as number) ^
        /**
         * getRandomByte() 生成一个随机字节（0 到 15）
         * 使用位运算符 & 保留其最低的 4 位。
         * 这确保了生成的数字范围在 0 到 15 之间。
         * >> 使用右移位运算符对随机字节进行调整。它的目的是根据 c 的值来决定右移的位数，确保生成符合 UUID 规则的格式。
         */
        ((getRandomByte() & 15) >> ((c as unknown as number) / 4))
      ).toString(16),
    // 将最终的数字转换为十六进制字符串
  );
}

function getFirstException(event: Event): Exception | undefined {
  return event.exception && event.exception.values
    ? event.exception.values[0]
    : undefined;
}

/**
 * Extracts either message or type+value from an event that can be used for user-facing logs
 * @returns event's description
 */
export function getEventDescription(event: Event): string {
  const { message, event_id: eventId } = event;
  if (message) {
    return message;
  }

  const firstException = getFirstException(event);
  if (firstException) {
    if (firstException.type && firstException.value) {
      return `${firstException.type}: ${firstException.value}`;
    }
    return (
      firstException.type || firstException.value || eventId || '<unknown>'
    );
  }
  return eventId || '<unknown>';
}
