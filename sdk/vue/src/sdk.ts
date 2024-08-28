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
      sdk: {
        name: 'sentry.javascript.vue',
        packages: [
          {
            name: 'npm:@sentry/vue',
            version: SDK_VERSION,
          },
        ],
        version: SDK_VERSION,
      },
    },
    defaultIntegrations: [...getDefaultIntegrations(config), vueIntegration()],
    ...config,
  };

  return browserInit(options);
}
