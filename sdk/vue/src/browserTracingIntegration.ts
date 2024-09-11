import {
  browserTracingIntegration as originalBrowserTracingIntegration,
  startBrowserTracingNavigationSpan,
} from '@xigua-monitor/browser';
import type { Integration, StartSpanOptions } from '@xigua-monitor/types';
import { instrumentVueRouter } from './router';

/**
 * Route 类型是与 VueRouter v2、v3 和 v4 版本兼容的路由对象，包含了不同 VueRouter 版本中的路由相关属性
 * 虽然这不好，但是在处理不同版本时非常有用。
 */
export type Route = {
  /**
   * 不带参数的 URL 路径
   * @example
   * /home  /about
   */
  path: string;
  /**
   * URL 中的查询参数
   *
   * @example
   * ?foo=bar&baz=qux
   * 对于单独的查询参数（例如 ?foo），值会映射为 null
   * 对于重复的查询参数（例如 ?foo&foo=bar），会映射为数组，即 foo: [null, "bar"]
   */
  query: Record<string, string | null | (string | null)[]>;
  /**
   * 路由名称,VueRouter 提供命名路由功能，这样可以使用路由名称来导航。
   */
  name?: string | symbol | null | undefined;
  /**
   * 路由中的动态参数
   *
   * @example
   * /user/:id
   */
  params: Record<string, string | string[]>;
  /**
   * 当前路径匹配的所有路由对象，包含每个路由对象的路径。
   * 这对嵌套路由特别有用，表示匹配链条中的所有路由。
   */
  matched: { path: string }[];
};

interface VueRouter {
  /** 用于捕获路由导航时的错误 */
  onError: (fn: (err: Error) => void) => void;
  /** 在每次路由导航前调用的钩子函数 */
  beforeEach: (fn: (to: Route, from: Route, next?: () => void) => void) => void;
}

/**
 * 用于处理 Sentry 的浏览器跟踪集成
 */
type VueBrowserTracingIntegrationOptions = Parameters<
  typeof originalBrowserTracingIntegration
>[0] & {
  /**
   * 表示如果传入 VueRouter 实例，Sentry 将根据路由导航自动创建跟踪信息。
   * 例如，可以通过这个选项在 Sentry 中跟踪用户的页面导航行为
   */
  router?: VueRouter;

  /**
   * 这个选项指定了 Sentry 在记录路由导航时，用于标记路由的方式
   * 默认情况下使用路由的 name（如果设置了），否则使用 path 作为标记
   *
   * @default 'name'
   */
  routeLabel?: 'name' | 'path';
};

/**
 * 这个函数实现了一个自定义的浏览器追踪（tracing）集成，用于跟踪 Vue 应用的页面导航行为，
 * 并将其集成到 Sentry 中进行监控。主要是基于在 VueRouter 中通过拦截导航行为创建和管理 span。
 */
export function browserTracingIntegration(
  options: VueBrowserTracingIntegrationOptions = {},
): Integration {
  // 如果没有传入 router 实例，这意味着我们不想追踪 VueRouter 的导航行为，
  // 这里就会使用默认的浏览器追踪功能
  if (!options.router) {
    return originalBrowserTracingIntegration(options);
  }

  // 自己控制 VueRouter 导航的追踪逻辑，而不是让默认的导航跟踪生效
  const integration = originalBrowserTracingIntegration({
    ...options,
    instrumentNavigation: false,
  });

  const {
    router,
    /**
     * 是否开启路由导航跟踪，默认 true，表示我们想要跟踪 Vue 应用中的每次路由跳转。
     * 如果设为 false，则不会跟踪路由导航行为。
     */
    instrumentNavigation = true,
    /**
     * 是否开启页面加载追踪，默认 true，表示在用户初次加载页面时记录加载性能。
     */
    instrumentPageLoad = true,
    /**
     * 用来标识路由的属性，它控制我们在 Sentry 中记录路由信息时，
     * 使用 name 还是 path 作为路由的标识。默认值是 'name'，也就是优先使用路由名称来标识。
     */
    routeLabel = 'name',
  } = options;

  // 返回集成对象
  return {
    ...integration,
    // 当所有的 Sentry 集成（包括浏览器追踪集成）都已完成初始化时，这个方法被调用。
    afterAllSetup(client) {
      // 确保原始的浏览器追踪集成完成它的设置
      integration.afterAllSetup(client);

      /**
       * 这个函数用于在导航事件开始时创建一个 span
       * 每次导航开始时创建一个新的 span，以追踪页面跳转的性能。
       * @param options
       */
      const startNavigationSpan = (options: StartSpanOptions): void => {
        startBrowserTracingNavigationSpan(client, options);
      };

      // 将自定义追踪功能绑定到 VueRouter 实例中。
      // 它负责拦截 VueRouter 的导航事件，并在合适的时机启动 span 来跟踪页面导航
      instrumentVueRouter(
        router,
        { routeLabel, instrumentNavigation, instrumentPageLoad },
        startNavigationSpan,
      );
    },
  };
}
