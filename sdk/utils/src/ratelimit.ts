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
  const updatedRateLimits: RateLimits = {
    ...limits,
  };

  // "The name is case-insensitive."
  // https://developer.mozilla.org/en-US/docs/Web/API/Headers/get
  const rateLimitHeader = headers && headers['x-sentry-rate-limits'];
  const retryAfterHeader = headers && headers['retry-after'];

  if (rateLimitHeader) {
    /**
     * rate limit headers are of the form
     *     <header>,<header>,..
     * where each <header> is of the form
     *     <retry_after>: <categories>: <scope>: <reason_code>: <namespaces>
     * where
     *     <retry_after> is a delay in seconds
     *     <categories> is the event type(s) (error, transaction, etc) being rate limited and is of the form
     *         <category>;<category>;...
     *     <scope> is what's being limited (org, project, or key) - ignored by SDK
     *     <reason_code> is an arbitrary string like "org_quota" - ignored by SDK
     *     <namespaces> Semicolon-separated list of metric namespace identifiers. Defines which namespace(s) will be affected.
     *         Only present if rate limit applies to the metric_bucket data category.
     */
    for (const limit of rateLimitHeader.trim().split(',')) {
      const [retryAfter, categories, , , namespaces] = limit.split(':', 5) as [
        string,
        ...string[],
      ];
      const headerDelay = parseInt(retryAfter, 10);
      const delay = (!isNaN(headerDelay) ? headerDelay : 60) * 1000; // 60sec default
      if (!categories) {
        updatedRateLimits.all = now + delay;
      } else {
        for (const category of categories.split(';')) {
          if (category === 'metric_bucket') {
            // namespaces will be present when category === 'metric_bucket'
            if (!namespaces || namespaces.split(';').includes('custom')) {
              updatedRateLimits[category] = now + delay;
            }
          } else {
            updatedRateLimits[category] = now + delay;
          }
        }
      }
    }
  } else if (retryAfterHeader) {
    updatedRateLimits.all = now + parseRetryAfterHeader(retryAfterHeader, now);
  } else if (statusCode === 429) {
    updatedRateLimits.all = now + 60 * 1000;
  }

  return updatedRateLimits;
}
