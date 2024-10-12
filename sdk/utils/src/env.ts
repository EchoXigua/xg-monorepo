/*
 * This module exists for optimizations in the build process through rollup and terser.  We define some global
 * constants, which can be overridden during build. By guarding certain pieces of code with functions that return these
 * constants, we can control whether or not they appear in the final bundle. (Any code guarded by a false condition will
 * never run, and will hence be dropped during treeshaking.) The two primary uses for this are stripping out calls to
 * `logger` and preventing node-related code from appearing in browser bundles.
 *
 * Attention:
 * This file should not be used to define constants/flags that are intended to be used for tree-shaking conducted by
 * users. These flags should live in their respective packages, as we identified user tooling (specifically webpack)
 * having issues tree-shaking these constants across package boundaries.
 * An example for this is the __SENTRY_DEBUG__ constant. It is declared in each package individually because we want
 * users to be able to shake away expressions that it guards.
 */

declare const __SENTRY_BROWSER_BUNDLE__: boolean | undefined;

export type SdkSource = 'npm' | 'cdn' | 'loader';

/**
 * 用于判断当前是否是在构建浏览器打包的环境中
 *
 * @returns true if this is a browser bundle build.
 */
export function isBrowserBundle(): boolean {
  return (
    // 在构建阶段引入全局变量来标识打包环境
    // __SENTRY_BROWSER_BUNDLE__ 可能是在打包配置（如 Webpack 或 Rollup）中定义的，用于区分浏览器和非浏览器的构建方式
    typeof __SENTRY_BROWSER_BUNDLE__ !== 'undefined' &&
    !!__SENTRY_BROWSER_BUNDLE__
  );
}

/**
 * Get source of SDK.
 */
export function getSDKSource(): SdkSource {
  // @ts-expect-error __SENTRY_SDK_SOURCE__在构建过程中通过rollup注入
  return __SENTRY_SDK_SOURCE__;
}
