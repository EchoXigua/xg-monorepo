import type {
  DataCategory,
  TransportMakeRequestResponse,
} from '@xigua-monitor/types';

export type RateLimits = Record<string, number>;

export const DEFAULT_RETRY_AFTER = 60 * 1000; // 60 seconds

/**
 * Extracts Retry-After value from the request header or returns default value
 * @param header string representation of 'Retry-After' header
 * @param now current unix timestamp
 *
 */
export function parseRetryAfterHeader(
  header: string,
  now: number = Date.now(),
): number {
  const headerDelay = parseInt(`${header}`, 10);
  if (!isNaN(headerDelay)) {
    return headerDelay * 1000;
  }

  const headerDate = Date.parse(`${header}`);
  if (!isNaN(headerDate)) {
    return headerDate - now;
  }

  return DEFAULT_RETRY_AFTER;
}

/**
 * 用于获取特定数据类别的速率限制的禁用截止时间。如果该类别没有单独的速率限制，则返回通用的限制时间
 *
 * @param limits 包含不同数据类别的速率限制截止时间的对象
 * @param dataCategory 需要查询的具体数据类别
 * @return the time in ms that the category is disabled until or 0 if there's no active rate limit.
 */
export function disabledUntil(
  limits: RateLimits,
  dataCategory: DataCategory,
): number {
  return limits[dataCategory] || limits.all || 0;
}

/**
 * 用于检查特定的数据类别是否被速率限制
 *
 * @param limits 表示各个数据类别的速率限制时间
 * @param dataCategory 要检查是否被限制的类别
 * @param now  当前时间，用来与速率限制截止时间进行比较
 * @returns
 */
export function isRateLimited(
  limits: RateLimits,
  dataCategory: DataCategory,
  now: number = Date.now(),
): boolean {
  return disabledUntil(limits, dataCategory) > now;
}

/**
 * 用于从服务器响应的头部信息中提取速率限制（Rate Limit）信息，并更新现有的 RateLimits 对象
 *
 * @return the updated RateLimits object.
 */
export function updateRateLimits(
  limits: RateLimits,
  /**
   * statusCode: HTTP 状态码，用于判断响应是否表明达到速率限制
   * headers: HTTP 响应头，包含速率限制信息
   */
  { statusCode, headers }: TransportMakeRequestResponse,
  now: number = Date.now(),
): RateLimits {
  // 对现有对象进行浅拷贝
  const updatedRateLimits: RateLimits = {
    ...limits,
  };

  // "The name is case-insensitive."
  // 从头部信息中获取 x-sentry-rate-limits 和 retry-after 头
  // https://developer.mozilla.org/en-US/docs/Web/API/Headers/get
  const rateLimitHeader = headers && headers['x-sentry-rate-limits'];
  const retryAfterHeader = headers && headers['retry-after'];

  if (rateLimitHeader) {
    /**
     *
     * 1. 基本格式
     *  - x-sentry-rate-limits 响应头可以包含多个速率限制条目，它们之间用逗号（,）分隔
     *
     * 2. 每个条目的格式
     *  - <retry_after>: <categories>: <scope>: <reason_code>: <namespaces>
     *  每个条目由5个部分组成，每个部分之间用冒号（:）分隔
     *
     *  - <retry_after>：表示限制的时间，以秒为单位，当这个事件类别被限制时，它在 retry_after 秒内不会允许新的请求
     *  - <categories>：表示被限制的事件类别，类别之间用分号（;）分隔
     *  如 error、transaction 等。每个类别表示不同类型的数据，如错误、事务等
     *  如果没有指定类别，则说明限制适用于所有类别
     *  - <scope>：限制的范围，可以是组织（org）、项目（project）或密钥（key）
     *  SDK 不会处理这个字段，因为它主要是用于服务器端
     *  - <reason_code>：一个任意的字符串，表示限制的原因代码，例如 org_quota
     *  这个字段为服务器提供了额外信息，但对于 SDK 来说不重要
     *  - <namespaces>：一个用分号分隔的命名空间标识符列表，定义了受影响的命名空间
     *  只有当类别是 metric_bucket 时，才会出现这个字段
     *  metric_bucket 是一种特殊的数据类别，与某些度量指标相关
     *  如果没有指定 namespaces 或者 namespaces 中包含 custom，说明这个速率限制应用于自定义命名空间的指标
     *
     * @example 60: error;transaction: org: org_quota: custom
     */

    // x-sentry-rate-limits 头可能包含多个条目，它们之间用逗号分隔，这里将他们切割为数组
    for (const limit of rateLimitHeader.trim().split(',')) {
      /**
       * 每个条目进一步拆分为 5 个部分
       * retry_after：延迟时间，表示该类别被限制的秒数
       * categories：被限制的类别（如 error、transaction 等），多个类别之间用 ; 分隔
       * scope（SDK 忽略的字段）
       * reason_code（SDK 忽略的字段）
       * namespaces：适用于 metric_bucket 类别的命名空间列表
       */
      const [retryAfter, categories, , , namespaces] = limit.split(':', 5) as [
        string,
        ...string[],
      ];

      // 将 retry_after 字符串转为整数，以表示秒数，第二个参数10 代码转为10进制
      const headerDelay = parseInt(retryAfter, 10);
      // 如果是一个有效的数字，使用它作为延迟时间；否则，默认延迟 60 秒（这里都会转为毫秒）
      const delay = (!isNaN(headerDelay) ? headerDelay : 60) * 1000; // 60sec default

      if (!categories) {
        // 如果没有指定类别
        // 表示这个限制适用于所有事件类型，
        // 将 updatedRateLimits.all 更新为当前时间加上延迟时间 delay
        updatedRateLimits.all = now + delay;
      } else {
        // 有类别，拆分每个类别
        for (const category of categories.split(';')) {
          if (category === 'metric_bucket') {
            // 特殊处理

            // namespaces will be present when category === 'metric_bucket'
            // 如果没有指定命名空间，或者命名空间列表中包含 custom，则对该类别应用限制
            if (!namespaces || namespaces.split(';').includes('custom')) {
              updatedRateLimits[category] = now + delay;
            }
          } else {
            // 更新指定类别的限制为当前时间加上 delay
            updatedRateLimits[category] = now + delay;
          }
        }
      }
    }
  } else if (retryAfterHeader) {
    // 如果 x-sentry-rate-limits 头不存在，但存在 retry-after 头

    // 解析 retry-after 头的值，并更新通用的速率限制
    updatedRateLimits.all = now + parseRetryAfterHeader(retryAfterHeader, now);
  } else if (statusCode === 429) {
    // 既没有 x-sentry-rate-limits 头，也没有 retry-after 头
    // 但服务器返回的状态码是 429，表示已经达到请求限制

    // 将所有事件类别的速率限制设为 60 秒
    updatedRateLimits.all = now + 60 * 1000;
  }

  return updatedRateLimits;
}
