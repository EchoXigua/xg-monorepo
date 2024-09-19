import { captureException } from '@xigua-monitor/browser';
import {
  SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN,
  SEMANTIC_ATTRIBUTE_SENTRY_SOURCE,
  getActiveSpan,
  getCurrentScope,
  getRootSpan,
  spanToJSON,
} from '@xigua-monitor/core';
import type {
  Span,
  SpanAttributes,
  StartSpanOptions,
  TransactionSource,
} from '@xigua-monitor/types';

/**
 * 这个类型会兼容 VueRouter 的多个版本 (v2、v3 和 v4)，
 * 并且通过合并这些版本的 Route 类型，确保在使用时能够适配所有版本。
 */
export type Route = {
  /**
   * 路由的未参数化 URL（不包含动态参数）
   * 对于 /user/:id，path 可能是 /user/123
   */
  path: string;
  /**
   * URL 中的查询参数
   *  - 单个参数无值（例如，?foo），则 foo 的值为 null
   *  - 单个参数有值（例如，?foo=bar），则 foo 的值为 bar。
   *  - 多个参数有相同的键（例如，?foo&foo=bar），则 foo 的值为数组。
   */
  query: Record<string, string | null | (string | null)[]>;
  /**
   * 路由的名称
   * VueRouter 允许为每个路由分配一个独特的名字，用于导航时的识别。
   */
  name?: string | symbol | null | undefined;
  /**
   * 动态路由参数
   */
  params: Record<string, string | string[]>;
  /**
   * 所有匹配的路由对象，主要用于嵌套路由
   * 当有多个嵌套路由时，它们都会出现在 matched 数组中，每个对象包含 path 属性
   */
  matched: { path: string }[];
};

interface VueRouter {
  // 用于注册全局错误处理函数，处理路由器的运行时错误
  onError: (fn: (err: Error) => void) => void;
  // 注册全局前置守卫，允许在每次导航之前执行回调函数
  beforeEach: (fn: (to: Route, from: Route, next?: () => void) => void) => void;
}

/**
 * 这个函数的作用是监控 vue router 导航操作创建导航span
 * 通过与 Sentry 集成，对页面加载和导航事件进行性能监控和错误捕获
 *
 * @param router VueRouter 实例，用于监控其导航行为
 * @param options 配置选项，定义如何标记路由及是否追踪页面加载和导航事件
 * @param startNavigationSpanFn 启动导航跨度的回调函数，用于在发生导航时记录性能数据
 */
export function instrumentVueRouter(
  router: VueRouter,
  options: {
    /**
     * 指定用于标记路由的方式，默认情况下使用 route.name
     *
     * Default: 'name'
     */
    routeLabel: 'name' | 'path';
    instrumentPageLoad: boolean; // 是否监控页面加载事件
    instrumentNavigation: boolean; // 是否监控页面内部的导航事件
  },
  startNavigationSpanFn: (context: StartSpanOptions) => void,
): void {
  let isFirstPageLoad = true;

  // 当路由导航过程中出现错误时，VueRouter 会触发 onError 钩子
  // 在这个钩子中去捕获错误信息报告给 Sentry
  router.onError((error) =>
    // 将捕获的错误作为一个异常事件发送给 Sentry，并标记为未处理（handled: false）
    captureException(error, { mechanism: { handled: false } }),
  );

  // 路由导航前置守卫
  router.beforeEach((to, from, next) => {
    /**
     * 这里解释了在 Vue 及其相关框架（如 Nuxt）中判断首次页面加载导航时，遇到的问题以及解决方法
     *
     * 1. from === VueRouter.START_LOCATION
     *  - 根据 Vue Router 的文档，理论上可以通过 from === VueRouter.START_LOCATION 来判断是否是从初始加载位置导航的
     *  这是 Vue Router 提供的一个静态属性，用于标识页面首次加载时的导航起点。
     *  - 但发现这种方法在 Vue 2 中无法工作。因此，尽管文档中推荐了这种方式，作者放弃了这种方法，原因是它在实际操作中没有成功。
     *
     * https://router.vuejs.org/api/#router-start-location
     * https://next.router.vuejs.org/api/#start-location
     *
     * 2. from.matched.length === 0 在 Nuxt 中的问题
     *  - 在 Vue 的路由逻辑中，from.matched.length === 0 可以用来判断是否是从初始页面位置开始导航。
     *  然而在 Nuxt 中，from.matched.length 永远不会等于 0，因此这个判断在 Nuxt 环境下不可用。
     *  - Nuxt 使用了更复杂的路由处理机制，可能会预先填充匹配的路由，导致 matched 始终有内容。
     *
     * 3. 解决方法：isFirstPageLoad 标志
     *  - 因为在 Vue 2、Vue 3 和 Nuxt 中都无法通过现有的方法精确判断首次加载导航，
     *  所以引入了一个布尔变量 isFirstPageLoad 来跟踪页面是否是首次加载。
     *  - 如果 isFirstPageLoad 为 true，那么意味着这是首次页面加载。
     *  之后，作者将这个标志设置为 false，以确保后续的导航不再被认为是首次页面加载。
     *
     * 4. from.name 的处理
     *  - 在 Vue 2 ，from.name 中为 null。
     *  - 在 Vue 3 和 Nuxt 中，from.name 为 undefined
     *  - 由于 null == undefined 为 true，因此使用 ==（而不是严格的 ===）来同时处理这两种情况，
     *  以确保在 Vue 2 和 Vue 3 中都能正确判断导航起点。
     */

    // 判断当前的导航是否是首次页面加载
    const isPageLoadNavigation =
      // 用于vue2
      (from.name == null && from.matched.length === 0) ||
      // 用于vue3
      (from.name === undefined && isFirstPageLoad);

    if (isFirstPageLoad) {
      // 一旦识别到首次页面加载，代码会将 isFirstPageLoad 设置为 false，
      // 确保后续导航不再被错误地认为是首次加载。
      isFirstPageLoad = false;
    }

    // 构建 span 属性
    const attributes: SpanAttributes = {
      [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.navigation.vue',
    };

    // 处理动态参数
    for (const key of Object.keys(to.params)) {
      attributes[`params.${key}`] = to.params[key];
    }
    // 处理查询字符串参数
    // 用于在 Sentry 的监控数据中精确追踪不同导航请求的上下文
    for (const key of Object.keys(to.query)) {
      const value = to.query[key];
      if (value) {
        attributes[`query.${key}`] = value;
      }
    }

    // 确定路由事务的名称 和 名称的来源
    let spanName: string = to.path;
    let transactionSource: TransactionSource = 'url';

    if (to.name && options.routeLabel !== 'path') {
      // 种情况通常用于开发者定义了具有可读性的路由名称（例如 'HomePage'、'UserProfile'），而不是直接使用路径
      spanName = to.name.toString();
      transactionSource = 'custom';
    } else if (to.matched.length > 0) {
      const lastIndex = to.matched.length - 1;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      // 取最后一个匹配项的路径作为 spanName
      spanName = to.matched[lastIndex]!.path;
      // 表示该跨度基于路由规则匹配的路径
      transactionSource = 'route';
    }

    // 设置当前事务的名称
    getCurrentScope().setTransactionName(spanName);

    // 下面的代码是处理页面加载的性能监控
    // 判断是否启用了页面加载的监控 以及当前导航是否是页面的首次加载
    // 会更新现有的根span，它代表页面加载的事务。
    if (options.instrumentPageLoad && isPageLoadNavigation) {
      const activeRootSpan = getActiveRootSpan();
      if (activeRootSpan) {
        // 获取当前活跃的 根span JSON化后的数据属性
        const existingAttributes = spanToJSON(activeRootSpan).data || {};

        // 检查根 span 的来源，如果不是 custom 则更新它的名称和来源
        if (existingAttributes[SEMANTIC_ATTRIBUTE_SENTRY_SOURCE] !== 'custom') {
          activeRootSpan.updateName(spanName);
          activeRootSpan.setAttribute(
            SEMANTIC_ATTRIBUTE_SENTRY_SOURCE,
            transactionSource,
          );
        }

        // 将当前导航的属性（如路由参数、查询参数等）设置到 根span 中
        // 代码会覆盖原有的 origin 信息，并为事务附加新的路由相关属性（params 和 query），让 Sentry 更清楚地记录用户导航行为。
        activeRootSpan.setAttributes({
          ...attributes,
          // 表示这个事务与 Vue 应用的页面加载相关联
          [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.pageload.vue',
        });
      }
    }

    // 处理内部导航的事务

    // 启用了监听且不是首次加载 （单页应用内的路由切换），此时会为这次导航生成一个新的导航跨度
    if (options.instrumentNavigation && !isPageLoadNavigation) {
      // 更新 属性对象
      attributes[SEMANTIC_ATTRIBUTE_SENTRY_SOURCE] = transactionSource;
      // 表示这个事务来源于 Vue 应用的内部导航
      attributes[SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN] = 'auto.navigation.vue';

      // 创建新的导航跨度，这个新创建的跨度代表一次完整的内部导航
      startNavigationSpanFn({
        name: spanName,
        op: 'navigation',
        attributes,
      });
    }

    /**
     * 在 Vue Router 2 和 Vue Router 3 中，next 函数用于控制导航的流程，
     * 在 beforeEach 钩子中，必须调用 next() 来继续导航，否则导航会被挂起。
     * - next()：继续导航
     * - next(false)：中断当前导航
     * - next('/path')：跳转到指定路径
     *
     * 在 Vue Router 4 中，next 函数不再传递给导航守卫钩子，
     * 因为新版本的路由器使用的是 Promise 风格的 API，导航的流程控制通过返回 Promise 来进行
     *
     * 所以这里兼容了旧版本 Vue Router 中需要调用 next 的机制，
     * 同时也避免了在 Vue Router 4 中因 next 函数不存在而产生错误。
     */
    if (next) {
      next();
    }
  });
}

/**
 * 获取当前活跃的根 span（跟踪事务的根节点）
 * 并确保该 span 是与页面加载（pageload）或导航（navigation）相关的
 * @returns
 */
function getActiveRootSpan(): Span | undefined {
  // 根据当前活跃的 span 来找根 span
  const span = getActiveSpan();
  const rootSpan = span && getRootSpan(span);

  if (!rootSpan) {
    return undefined;
  }

  // 将根 span JSON化，获取操作类型
  const op = spanToJSON(rootSpan).op;

  // 只有当它是一个页面加载或导航span时才使用这个根span
  return op === 'navigation' || op === 'pageload' ? rootSpan : undefined;
}
