import type { Options } from '@xigua-monitor/types';
import { SDK_VERSION } from '@xigua-monitor/utils';

/**
 * 用于构建 SDK 初始化选项中的元数据 (metadata)
 *
 * 注意:此函数与Remix和NextJS和SvelteKit中的“buildMetadata”相同。
 * 由于包的大小原因，我们没有提取它。
 * @see https://github.com/getsentry/sentry-javascript/pull/7404
 * @see https://github.com/getsentry/sentry-javascript/pull/4196
 *
 * 如果对这个函数进行了更改，请考虑同时更新其他函数。
 *
 * @param options 发生变异的SDK选项对象
 * @param names SDK 的名称 如 nextjs 或 remix
 */
export function applySdkMetadata(
  options: Options,
  name: string,
  names = [name],
  source = 'npm',
): void {
  // 获取元数据
  const metadata = options._metadata || {};

  // 不存在sdk 信息,则构建sdk 元数据
  if (!metadata.sdk) {
    metadata.sdk = {
      name: `sentry.javascript.${name}`,
      packages: names.map((name) => ({
        name: `${source}:@xigua-monitir/${name}`,
        // name: `${source}:@sentry/${name}`,
        version: SDK_VERSION,
      })),
      version: SDK_VERSION,
    };
  }

  // 更新配置的元数据,使得这些元数据在 SDK 初始化时可用
  options._metadata = metadata;
}
