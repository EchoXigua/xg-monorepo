import {
  SDK_VERSION,
  getDefaultIntegrations,
  init as browserInit,
} from '@xigua-monitor/browser';

import type { Client } from '@xigua-monitor/types';
import { vueIntegration } from './integration';
import type { Options, TracingOptions } from './types';

/**
 * Vue SDK 的初始化函数,该函数负责配置和启动 Sentry 的 Vue 集成
 * @param config 用于覆盖 Sentry 的默认配置
 * @returns
 */
export function init(
  config: Partial<
    Omit<Options, 'tracingOptions'> & {
      tracingOptions: Partial<TracingOptions>;
    }
  > = {},
): Client | undefined {
  const options = {
    _metadata: {
      // _metadata 包含有关 SDK 的信息，主要用于内部跟踪和诊断。
      sdk: {
        name: 'xigua.javascript.vue',
        packages: [
          {
            name: 'npm:@xigua-monitor/vue',
            version: SDK_VERSION,
          },
        ],
        version: SDK_VERSION,
      },
    },
    //  包含了 Sentry SDK 的默认集成，这些集成是 Sentry 运行所必需的。
    defaultIntegrations: [...getDefaultIntegrations(config), vueIntegration()],
    // 覆盖默认配置
    ...config,
  };

  //  Sentry SDK 的核心初始化逻辑之一，负责启动 Sentry 客户端，开始捕获错误和追踪性能。
  return browserInit(options);
}
