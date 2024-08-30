import type { Options } from '@xigua-monitor/types';
import { getClient } from '../currentScopes';

// 声明了一个全局常量 __SENTRY_TRACING__，用于指示是否启用了追踪功能。
// 树摇机制可以在构建时移除未使用的代码，减少打包体积。
declare const __SENTRY_TRACING__: boolean | undefined;

/**
 * 用于检查 Sentry 中的追踪功能是否被启用
 * 当在SDK配置中定义了' tracesSampleRate '和' tracesSampler '中的至少一个时，将启用跟踪。
 *
 * @param maybeOptions
 * @returns
 */
export function hasTracingEnabled(
  maybeOptions?:
    | Pick<Options, 'tracesSampleRate' | 'tracesSampler' | 'enableTracing'>
    | undefined,
): boolean {
  // 首先检查 __SENTRY_TRACING__ 是否是布尔值，并且是否为 false
  if (typeof __SENTRY_TRACING__ === 'boolean' && !__SENTRY_TRACING__) {
    // 如果是，则返回 false，表示追踪功能被禁用
    return false;
  }

  // 获取当前的 Sentry 客户端实例
  const client = getClient();

  // 如果 maybeOptions 参数未提供，则尝试从客户端获取选项
  const options = maybeOptions || (client && client.getOptions());
  // eslint-disable-next-line deprecation/deprecation
  return (
    // 检查 options 是否有效，并判断是否启用了追踪功能
    !!options &&
    (options.enableTracing ||
      'tracesSampleRate' in options ||
      'tracesSampler' in options)
  );
}
