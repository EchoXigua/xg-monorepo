import { defineIntegration, hasTracingEnabled } from '@xigua-monitor/core';
import type { Client, IntegrationFn } from '@xigua-monitor/types';
import { GLOBAL_OBJ, arrayify, consoleSandbox } from '@xigua-monitor/utils';

import { DEFAULT_HOOKS } from './constants';
import { DEBUG_BUILD } from './debug-build';
import { attachErrorHandler } from './errorhandler';
import { createTracingMixins } from './tracing';
import type { Options, Vue, VueOptions } from './types';

const globalWithVue = GLOBAL_OBJ as typeof GLOBAL_OBJ & { Vue: Vue };

const DEFAULT_CONFIG: VueOptions = {
  Vue: globalWithVue.Vue,
  attachProps: true,
  logErrors: true,
  hooks: DEFAULT_HOOKS,
  timeout: 2000,
  trackComponents: false,
};

const INTEGRATION_NAME = 'Vue';

const _vueIntegration = ((integrationOptions: Partial<VueOptions> = {}) => {
  return {
    name: INTEGRATION_NAME,
    setup(client) {
      _setupIntegration(client, integrationOptions);
    },
  };
}) satisfies IntegrationFn;

export const vueIntegration = defineIntegration(_vueIntegration);

/**
 * 这个函数的主要作用是配置并启动 Sentry 的 Vue 集成
 * @param client Sentry 的 Client 对象，包含了 SDK 的核心配置和功能
 * @param integrationOptions 用于用户自定义 Sentry 在 Vue 中的行为和配置。
 * @returns
 */
function _setupIntegration(
  client: Client,
  integrationOptions: Partial<VueOptions>,
): void {
  /**
   * 最终的配置对象，它是通过合并默认配置、客户端配置、用户自定义配置
   */
  const options: Options = {
    ...DEFAULT_CONFIG,
    ...client.getOptions(),
    ...integrationOptions,
  };

  /**
   * 如果 options 中没有 Vue（针对 Vue 2）或 app（针对 Vue 3），会在控制台中发出警告并提前返回。
   * 这意味着用户没有提供必要的 Vue 实例，Sentry 将无法捕获 Vue 相关的错误。
   */
  if (!options.Vue && !options.app) {
    consoleSandbox(() => {
      // eslint-disable-next-line no-console
      console.warn(
        `[@xigua-monitor/vue]: Misconfigured SDK. Vue specific errors will not be captured.
Update your \`XgMonitor.init\` call with an appropriate config option:
\`app\` (Application Instance - Vue 3) or \`Vue\` (Vue Constructor - Vue 2).`,
      );
    });
    return;
  }

  if (options.app) {
    // 如果配置中提供了 app（Vue 3），它会被处理成数组，然后对每个 Vue 应用调用 vueInit 函数。
    const apps = arrayify(options.app);
    apps.forEach((app) => vueInit(app, options));
  } else if (options.Vue) {
    // 如果配置中提供了 Vue（Vue 2），直接调用 vueInit 进行初始化。
    vueInit(options.Vue, options);
  }
}

/**
 * 这个函数则是执行实际的初始化工作，包括附加错误处理程序、检查应用挂载状态、以及根据配置决定是否启用性能追踪
 * @param app
 * @param options
 */
const vueInit = (app: Vue, options: Options): void => {
  // 在 DEBUG_BUILD 模式下，首先检查 Vue 应用是否已经挂载
  if (DEBUG_BUILD) {
    /**
     * Vue 应用应该在 Sentry.init() 调用之后挂载。这是为了确保 Sentry 能够正确地捕获 Vue 应用中的错误。
     * Sentry SDK 在检查应用挂载状态时，访问的是 Vue 内部的 _instance 属性。
     * 这些属性在 Vue 文档中并不是公开的 API，因此可能属于私有属性或内部实现的一部分。
     * 如果检查不到这些属性（可能因为应用使用了不同的 Vue 版本或自定义实现），SDK 会忽略这个检查，
     * 而不会因此报错或抛出异常。这使得代码更具兼容性，适应不同的 Vue 环境。
     */
    // See: https://github.com/vuejs/core/blob/eb2a83283caa9de0a45881d860a3cbd9d0bdd279/packages/runtime-core/src/component.ts#L394
    const appWithInstance = app as Vue & {
      _instance?: {
        isMounted?: boolean;
      };
    };

    const isMounted =
      appWithInstance._instance && appWithInstance._instance.isMounted;
    if (isMounted === true) {
      // 如果应用已经挂载，会发出警告，提示用户应该在 Sentry.init() 之后调用 app.mount()
      consoleSandbox(() => {
        // eslint-disable-next-line no-console
        console.warn(
          '[@xigua-monitor/vue]: Misconfigured SDK. Vue app is already mounted. Make sure to call `app.mount()` after `XgMonitor.init()`.',
        );
      });
    }
  }

  // 将 Sentry 的错误处理程序附加到 Vue 应用中，这样 Vue 中的错误可以被 Sentry 捕获并报告。
  attachErrorHandler(app, options);

  // 如果启用了追踪功能
  if (hasTracingEnabled(options)) {
    // 会将一个追踪的 mixin 附加到 Vue 应用中，这样 Vue 应用的生命周期钩子可以被追踪并报告。
    app.mixin(
      createTracingMixins({
        ...options,
        ...options.tracingOptions,
      }),
    );
  }
};
