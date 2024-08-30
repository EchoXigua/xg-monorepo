import type { Client, MetricsAggregator, Scope } from '@xigua-monitor/types';

import type { SdkSource } from './env';
import { SDK_VERSION } from './version';

interface SentryCarrier {
  acs?: any;
  stack?: any;

  globalScope?: Scope;
  defaultIsolationScope?: Scope;
  defaultCurrentScope?: Scope;
  globalMetricsAggregators?: WeakMap<Client, MetricsAggregator> | undefined;

  /** Overwrites TextEncoder used in `@sentry/utils`, need for `react-native@0.73` and older */
  encodePolyfill?: (input: string) => Uint8Array;
  /** Overwrites TextDecoder used in `@sentry/utils`, need for `react-native@0.73` and older */
  decodePolyfill?: (input: Uint8Array) => string;
}

// TODO(v9): Clean up or remove this type
type BackwardsCompatibleSentryCarrier = SentryCarrier & {
  // pre-v7 hub (replaced by .stack)
  hub: any;
  integrations?: any[];
  logger: any;
  extensions?: {
    /** Extension methods for the hub, which are bound to the current Hub instance */
    // eslint-disable-next-line @typescript-eslint/ban-types
    [key: string]: Function;
  };
};

/** Internal global with common properties and Sentry extensions  */
export type InternalGlobal = {
  navigator?: { userAgent?: string };
  console: Console;
  PerformanceObserver?: any;
  Sentry?: any;
  onerror?: {
    (
      event: object | string,
      source?: string,
      lineno?: number,
      colno?: number,
      error?: Error,
    ): any;
    __SENTRY_INSTRUMENTED__?: true;
    __SENTRY_LOADER__?: true;
  };
  onunhandledrejection?: {
    (event: unknown): boolean;
    __SENTRY_INSTRUMENTED__?: true;
    __SENTRY_LOADER__?: true;
  };
  SENTRY_ENVIRONMENT?: string;
  SENTRY_DSN?: string;
  SENTRY_RELEASE?: {
    id?: string;
  };
  SENTRY_SDK_SOURCE?: SdkSource;
  /**
   * Debug IDs are indirectly injected by Sentry CLI or bundler plugins to directly reference a particular source map
   * for resolving of a source file. The injected code will place an entry into the record for each loaded bundle/JS
   * file.
   */
  _sentryDebugIds?: Record<string, string>;
  __SENTRY__: Record<Exclude<string, 'version'>, SentryCarrier> & {
    version?: string;
  } & BackwardsCompatibleSentryCarrier;
  /**
   * Raw module metadata that is injected by bundler plugins.
   *
   * Keys are `error.stack` strings, values are the metadata.
   */
  _sentryModuleMetadata?: Record<string, any>;
  _sentryEsmLoaderHookRegistered?: boolean;
};

/** 获取当前JavaScript运行时的全局对象 */
export const GLOBAL_OBJ = globalThis as unknown as InternalGlobal;

/**
 * 这个函数用于管理全局单例实例的通用工具，它确保在全局环境中某个特定对象（如 Sentry）上只有一个实例存在
 *
 * If the singleton doesn't already exist in `__SENTRY__`, it will be created using the given factory
 * function and added to the `__SENTRY__` object.
 *
 * @param name 全局单例在 __SENTRY__ 对象上的名称
 * @param creator 这是一个工厂函数，用于创建单例对象。如果在 __SENTRY__ 对象中不存在该单例实例，则会调用这个函数生成一个新的实例。
 * @param obj 它指定了要查找 __SENTRY__ 的全局对象。如果未提供，默认为 GLOBAL_OBJ。
 * @returns 返回全局单例对象
 */
export function getGlobalSingleton<T>(
  name: keyof SentryCarrier,
  creator: () => T,
  obj?: unknown,
): T {
  // 获取全局对象
  const gbl = (obj || GLOBAL_OBJ) as InternalGlobal;
  // 初始化 __SENTRY__
  const __SENTRY__ = (gbl.__SENTRY__ = gbl.__SENTRY__ || {});
  // 为当前 SDK 版本创建或获取一个版本化的承载器，不存在的默认为空对象
  const versionedCarrier = (__SENTRY__[SDK_VERSION] =
    __SENTRY__[SDK_VERSION] || {});

  // 返回当前版本的中对应名称的单例，如果不存在调用 creator 函数创建新的单例实例，并将其存储，然后返回该实例。
  return versionedCarrier[name] || (versionedCarrier[name] = creator());
}
