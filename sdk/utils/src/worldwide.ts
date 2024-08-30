import type { Client, MetricsAggregator, Scope } from '@xigua-monitor/types';

import type { SdkSource } from './env';

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
