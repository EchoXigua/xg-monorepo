export type SdkSource = 'npm' | 'cdn' | 'loader';

/**
 * Get source of SDK.
 */
export function getSDKSource(): SdkSource {
  // @ts-expect-error __SENTRY_SDK_SOURCE__在构建过程中通过rollup注入
  return __SENTRY_SDK_SOURCE__;
}
