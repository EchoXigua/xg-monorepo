/* eslint-disable max-lines */
import {
  addHistoryInstrumentationHandler,
  addPerformanceEntries,
  registerInpInteractionListener,
  startTrackingINP,
  startTrackingInteractions,
  startTrackingLongAnimationFrames,
  startTrackingLongTasks,
  startTrackingWebVitals,
} from '@xigua-monitor/browser-utils';
import {
  SEMANTIC_ATTRIBUTE_SENTRY_IDLE_SPAN_FINISH_REASON,
  SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN,
  SEMANTIC_ATTRIBUTE_SENTRY_SOURCE,
  TRACING_DEFAULTS,
  getActiveSpan,
  getClient,
  getCurrentScope,
  getDynamicSamplingContextFromSpan,
  getIsolationScope,
  getRootSpan,
  registerSpanErrorInstrumentation,
  spanIsSampled,
  spanToJSON,
  startIdleSpan,
} from '@xigua-monitor/core';
import type {
  Client,
  IntegrationFn,
  StartSpanOptions,
  TransactionSource,
  Span,
} from '@xigua-monitor/types';
import {
  GLOBAL_OBJ,
  browserPerformanceTimeOrigin,
  generatePropagationContext,
  getDomElement,
  logger,
  propagationContextFromHeaders,
} from '@xigua-monitor/utils';

import { DEBUG_BUILD } from '../debug-build';
import { WINDOW } from '../helpers';
import { registerBackgroundTabDetection } from './backgroundtab';
import {
  defaultRequestInstrumentationOptions,
  instrumentOutgoingRequests,
} from './request';

/**
 * 表示 Sentry 浏览器追踪集成的唯一标识符。这个标识符用于区分和标记与浏览器追踪相关的集成逻辑。
 * 通常会在 Sentry 的内部使用，用于对追踪事件、操作和选项进行归类。
 */
export const BROWSER_TRACING_INTEGRATION_ID = 'BrowserTracing';

/**
 * 定义了与路由相关的信息
 */
interface RouteInfo {
  // 表示路由的名称,在 Vue Router 等框架中，路由通常有一个唯一的 name，用于标识特定的路由。
  name: string | undefined;
  // 用于指定事务的来源,用于定义追踪的具体来源，例如页面加载或导航事件等。
  source: TransactionSource | undefined;
}

/**
 * 配置 Sentry 浏览器追踪集成时的各个选项
 * 允许你详细控制 Sentry 在浏览器环境中的性能追踪行为。
 * 你可以选择跟踪页面加载、路由导航、网络请求，以及监控长时间任务和后台页面等细节，从而帮助优化应用的性能。
 */
export interface BrowserTracingOptions {
  /**
   * idle span (空闲时间段)
   *
   * 在没有新的 span 创建的情况下，经过指定的时间（以毫秒为单位），这个空闲 span 将会结束。
   *
   * @default 1000 (ms)
   */
  idleTimeout: number;

  /**
   * 即使 idleTimeout 未超时，如果一个 span 的总时长超过了这个值，span 也会强制结束
   *
   * @default 3000 (ms)
   */
  finalTimeout: number;

  /**
   * 子 span 的最大持续时间，超过这个时间后，子 span 会自动结束
   * 它适用于子级操作的追踪，比如某个子页面或异步任务
   *
   * @default 15000 (ms)
   */
  childSpanTimeout: number;

  /**
   * 是否在页面加载时创建一个 span， 用于追踪页面的首次加载。
   * 如果将此设置为“false”，则此集成将不会启动默认的页面加载范围。
   * @default true
   */
  instrumentPageLoad: boolean;

  /**
   * 是否在页面导航（比如通过历史记录变化）时创建一个 span，用于跟踪用户在应用中的导航行为。
   * 如果这个设置为“false”，这个集成将不会启动默认的导航栏。
   * @default true
   */
  instrumentNavigation: boolean;

  /**
   * 用于标记在浏览器后台（tab 切换到后台）的 span
   * 在后台运行时，浏览器可能会降低性能，这会影响追踪的准确性。
   * 启用此选项可以为这些 span 添加“取消”的标记，防止它们影响整体性能统计。
   *
   * 这里是浏览器本身的节能策略，在这种情况下，计时器等会变的不精确
   *
   * @default true
   */
  markBackgroundSpan: boolean;

  /**
   * 捕获那些运行时间较长的任务（超过 50 毫秒），并将其添加到相应的事务中，以便分析卡顿现象。
   *
   * @default true
   */
  enableLongTask: boolean;

  /**
   * 它会捕获动画帧超过预期时间的任务。可以启用这个选项来追踪动画性能。
   * 如果为true, Sentry将捕获长动画帧并将其添加到相应的事务中。
   *
   * @default false
   */
  enableLongAnimationFrame: boolean;

  /**
   * 是否捕获 "First Input Delay" (FID)，
   * FID 是衡量用户与页面交互响应速度的指标，较大的值表明用户可能遇到较长的响应延迟。
   * 如果为true, Sentry将捕获第一个输入延迟并将其添加到相应的事务中。
   *
   * @default true
   */
  enableInp: boolean;

  /**
   * 启用对 fetch 请求的追踪。
   *
   * @default true
   */
  traceFetch: boolean;

  /**
   * 启用对 XMLHttpRequest 请求的追踪。
   *
   * @default true
   */
  traceXHR: boolean;

  /**
   * 用于捕获 HTTP 请求的时序信息。
   * 它会将 HTTP 请求的时间、状态等信息关联到相关的追踪数据中，帮助你分析应用的网络延迟。
   * 如果为true, Sentry将捕获http计时并将其添加到相应的http span
   *
   * @default true
   */
  enableHTTPTimings: boolean;

  /**
   * 允许用户传递实验性配置，控制集成的工作方式
   *
   * @default undefined
   */
  _experiments: Partial<{
    /** 如果设置为 true，它可能会启用对用户交互的追踪（例如点击和输入等）。 */
    enableInteractions: boolean;
    /** 启用后可能会对 CLS（Cumulative Layout Shift，累积布局偏移）事件创建独立的 span。 */
    enableStandaloneClsSpans: boolean;
  }>;

  /**
   * 用于在创建 span 之前修改相关选项
   * 接收 startSpan 的选项并返回修改后的选项。这允许用户根据特定需求自定义 span 的行为。
   */
  beforeStartSpan?: (options: StartSpanOptions) => StartSpanOptions;

  /**
   * 允许用户决定是否为特定的请求 URL 创建 span。
   * 默认情况下，所有请求都会创建 span，但通过这个选项，
   * 用户可以基于请求的 URL 返回 false，以跳过特定请求的追踪
   *
   * @default (url: string)=> true
   */
  shouldCreateSpanForRequest?(this: void, url: string): boolean;
}

/**
 * 包含了浏览器追踪集成的默认配置选项
 */
const DEFAULT_BROWSER_TRACING_OPTIONS: BrowserTracingOptions = {
  ...TRACING_DEFAULTS,
  instrumentNavigation: true, // 追踪用户的导航操作（页面跳转）
  instrumentPageLoad: true, // 追踪页面的加载过程，这通常是第一次打开页面时触发的追踪。
  markBackgroundSpan: true, // 启用对后台标签页操作的标记（当页面转入后台时，会对 span 添加一个标记，避免后台行为干扰性能追踪数据）
  enableLongTask: true, // 追踪长时间任务（通常超过 50ms 的任务）。这些长任务可能会导致卡顿。
  enableLongAnimationFrame: true, // 启用对长动画帧的追踪，帮助分析界面渲染性能（通常针对复杂的动画效果）。
  enableInp: true, // 启用对 First Input Delay (FID) 的追踪，FID 衡量用户首次交互（如点击、输入）的响应时间。
  _experiments: {}, // 通常用于配置实验性选项，默认是空对象，表明没有激活任何实验功能。
  ...defaultRequestInstrumentationOptions,
};

/**
 * 这个函数提供一个浏览器的追踪集成，用于自动捕获浏览器中的页面加载和导航行为，并将其作为 Sentry 的 transaction（事务）进行追踪，
 * 此外还会捕获相关的请求、性能指标（如 Web Vitals）以及错误，并将它们作为 Sentry 的 spans（跨度）记录
 *
 * 这个集成通过接受配置参数来灵活控制追踪行为，比如是否启用交互追踪、长任务监控等。
 * 这使得开发者可以根据自己的需求定制追踪的粒度和内容
 * 虽然它主要负责监控浏览器的页面加载和导航，但也可以通过扩展的方式与其他路由库
 * （例如 React Router、Vue Router 等）配合使用，以便更好地捕捉客户端的路由变化。
 *
 */
export const browserTracingIntegration = ((
  _options: Partial<BrowserTracingOptions> = {},
) => {
  // 为 span（时间段）记录错误信息。这个函数会为追踪过程中可能产生的错误事件进行自动记录
  registerSpanErrorInstrumentation();

  // 默认配置 DEFAULT_BROWSER_TRACING_OPTIONS 和传入的 _options 结合，生成配置项
  // 然后再从配置中提取信息

  const {
    enableInp, // 是否启用 INP 指标（交互延迟）
    enableLongTask, // 是否追踪长任务（任务执行超过一定时间）
    enableLongAnimationFrame, // 是否追踪长动画帧
    _experiments: { enableInteractions, enableStandaloneClsSpans }, //  用于实验性功能的配置项
    beforeStartSpan, // 自定义 span 启动前的操作
    idleTimeout, // 空闲超时时间
    finalTimeout, // 结束超时时间
    childSpanTimeout, // 子 span 的超时时间
    markBackgroundSpan, // 是否标记后台 span
    traceFetch, // 是否追踪 fetch 请求
    traceXHR, // 是否追踪 xhr 请求
    shouldCreateSpanForRequest, // 是否为请求创建 span 的回调函数
    enableHTTPTimings, //  是否启用 HTTP 时间测量
    instrumentPageLoad, //  是否启用页面加载的自动检测
    instrumentNavigation, // 是否启用导航的自动检测
  } = {
    ...DEFAULT_BROWSER_TRACING_OPTIONS,
    ..._options,
  };

  // 这个函数开始收集 Web Vitals 指标，这些指标是用来衡量页面性能的关键指标，比如 CLS（布局偏移）
  const _collectWebVitals = startTrackingWebVitals({
    recordClsStandaloneSpans: enableStandaloneClsSpans || false,
  });

  // 如果启用了 INP（交互延迟指标），则调用 startTrackingINP() 开始追踪 INP
  if (enableInp) {
    startTrackingINP();
  }

  // 如果追踪长动画帧 且 全局对象中存在性能api 且 当前性能api 中包含 长动画帧
  if (
    enableLongAnimationFrame &&
    GLOBAL_OBJ.PerformanceObserver &&
    PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')
  ) {
    // 则启动长动画帧的追踪
    startTrackingLongAnimationFrames();
  } else if (enableLongTask) {
    // 如果不支持长动画帧但启用了 enableLongTask，则追踪长任务
    startTrackingLongTasks();
  }

  // 如果启用了交互追踪，则启动交互事件的追踪
  if (enableInteractions) {
    startTrackingInteractions();
  }

  // 存储最新的路由信息，其中 name 和 source 初始化为 undefined，用于追踪当前路由
  const latestRoute: RouteInfo = {
    name: undefined,
    source: undefined,
  };

  /**
   * 用于创建新的路由 span， 这个 span 用于记录页面路由变化等信息
   */
  function _createRouteSpan(
    client: Client,
    startSpanOptions: StartSpanOptions,
  ): Span {
    // 检查当前操作是否为'pageload'，用于判断是否是页面加载的 span
    const isPageloadTransaction = startSpanOptions.op === 'pageload';

    // 用户提供了路由创建前的回调，则调用它，否则直接使用原始的配置
    const finalStartSpanOptions: StartSpanOptions = beforeStartSpan
      ? beforeStartSpan(startSpanOptions)
      : startSpanOptions;

    // 获取配置中的attributes ，没有定义则使用空对象
    const attributes = finalStartSpanOptions.attributes || {};

    // 如果开始前配置的name 和 结束后配置的name 不一致,则说明 用户提供的 beforeStartSpan 设置了一个自定义名称
    if (startSpanOptions.name !== finalStartSpanOptions.name) {
      // 所以将 attributes 的来源设置为 custom
      attributes[SEMANTIC_ATTRIBUTE_SENTRY_SOURCE] = 'custom';
      finalStartSpanOptions.attributes = attributes;
    }

    // 更新 latestRoute 的 name 和 source，用于记录当前路由的名称和来源
    latestRoute.name = finalStartSpanOptions.name;
    latestRoute.source = attributes[SEMANTIC_ATTRIBUTE_SENTRY_SOURCE];

    // 创建一个新的空闲 span
    const idleSpan = startIdleSpan(finalStartSpanOptions, {
      idleTimeout,
      finalTimeout,
      childSpanTimeout,
      // 如果是页面加载事务，应该等待完成信号，则禁止自动结束
      disableAutoFinish: isPageloadTransaction,
      //  在 span 结束之前执行的操作，收集 Web Vitals 指标并添加性能条目
      beforeSpanEnd: (span) => {
        _collectWebVitals();
        addPerformanceEntries(span, {
          recordClsOnPageloadSpan: !enableStandaloneClsSpans,
        });
      },
    });

    // 在文档状态为 interactive 或 complete 时触发 空闲Span 的自动结束信号
    function emitFinish(): void {
      if (['interactive', 'complete'].includes(WINDOW.document.readyState)) {
        client.emit('idleSpanEnableAutoFinish', idleSpan);
      }
    }

    // 如果是页面加载事务 且是浏览器环境
    if (isPageloadTransaction && WINDOW.document) {
      // 监听文档的 readystatechange 事件
      // 以触发 emitFinish，确保页面加载的 span 在文档状态变更时自动完成。
      WINDOW.document.addEventListener('readystatechange', () => {
        emitFinish();
      });

      /**
       * 这里会主动触发一次,原因如下:
       *
       * 1. 防止错过 readystatechange 事件
       *  - 假设文档的 readyState 已经达到了我们感兴趣的状态（例如 interactive 或 complete）
       *  而此时才开始监听 readystatechange 事件。这种情况下，事件已经触发过，新的监听器将不会收到这个已经发生的事件
       *
       * 2. 优化性能，减少不必要的等待
       *  - 手动调用时，会立即检查文档的当前状态,是否已经是 interactive 或 complete，这表示页面已经加载完成了
       *  如果文档已经完成加载，那就无需等到下一次状态变更事件再触发 emitFinish()，可以提前执行相关的完成操作
       *
       * 3. 保证页面加载时的事务正确结束
       *  - emitFinish() 的作用是结束页面加载相关的事务（span）,
       *  页面加载的 span 只有在文档的 readyState 变为 interactive 或 complete 时才应该结束
       *  页面可能在我们设置监听器之前就已经进入了这些状态。因此，通过手动调用 emitFinish()，可以保证即使页面已经加载，span 仍然会正确地结束
       */
      emitFinish();
    }

    // 返回空闲的 span
    return idleSpan;
  }

  // 这里很类似插件的做法
  return {
    name: BROWSER_TRACING_INTEGRATION_ID,
    // 这个函数主要负责处理页面加载、导航、交互以及外部请求的跟踪
    afterAllSetup(client) {
      /** 当前激活的 span，用于追踪事务（如页面加载或导航） */
      let activeSpan: Span | undefined;
      /** 保存当前页面的 URL，初始化为 WINDOW.location.href */
      let startingUrl: string | undefined =
        WINDOW.location && WINDOW.location.href;

      // 监听导航开始事件
      client.on('startNavigationSpan', (startSpanOptions) => {
        // 检查当前的 client 是否是调用者自身，防止跨 client 的事件干扰
        if (getClient() !== client) {
          return;
        }

        // 如果有一个已经存在但尚未完成的 span，先结束它，避免重复
        if (activeSpan && !spanToJSON(activeSpan).timestamp) {
          DEBUG_BUILD &&
            logger.log(
              `[Tracing] Finishing current root span with op: ${spanToJSON(activeSpan).op}`,
            );
          // If there's an open transaction on the scope, we need to finish it before creating an new one.
          activeSpan.end();
        }

        // 为导航创建一个新的 span（导航事务）,将其设为当前 activeSpan
        activeSpan = _createRouteSpan(client, {
          op: 'navigation',
          ...startSpanOptions,
        });
      });

      // 监听页面加载开始事件
      client.on('startPageLoadSpan', (startSpanOptions, traceOptions = {}) => {
        if (getClient() !== client) {
          return;
        }

        if (activeSpan && !spanToJSON(activeSpan).timestamp) {
          DEBUG_BUILD &&
            logger.log(
              `[Tracing] Finishing current root span with op: ${spanToJSON(activeSpan).op}`,
            );
          // If there's an open transaction on the scope, we need to finish it before creating an new one.
          activeSpan.end();
        }

        // 从元数据或请求头中获取跟踪信息，以便跨请求传播
        const sentryTrace =
          traceOptions.sentryTrace || getMetaContent('sentry-trace');
        const baggage = traceOptions.baggage || getMetaContent('baggage');

        // 从这些头信息创建传播上下文，并设置到当前范围中
        const propagationContext = propagationContextFromHeaders(
          sentryTrace,
          baggage,
        );
        getCurrentScope().setPropagationContext(propagationContext);

        // 为页面加载创建一个新的 span,将其设为当前 activeSpan
        activeSpan = _createRouteSpan(client, {
          op: 'pageload',
          ...startSpanOptions,
        });
      });

      /**
       * 这段注释解释了在浏览器跟踪中如何保持一次路由导航或页面加载的整个追踪（trace）的一致性，
       * 即使在根 span（事务的起始部分）结束后，仍然确保相关的追踪信息继续有效
       *
       * 在单页应用程序（SPA）中，路由可以表示不同的页面或视图。当用户在应用中导航时，可能会触发多个事务（例如，页面加载或导航）
       * 为了确保对这些事务的追踪是连续的，我们需要保持整个路由生命周期内的数据一致性。
       *
       * 因此，当初始的页面加载或导航根 span 结束时，我们更新作用域的传播上下文，
       * 以保持 span 特定的属性（例如 sampled 决策和动态采样上下文）的有效性，即使根 span 已经结束
       * 更新这些属性能够确保，即使一个事务已经结束，这些属性在后续的事务中仍然保持一致和有效
       *
       * 更新后的传播上下文能够保持事务之间的属性一致，尤其是在根事务（如页面加载或导航事务）结束之后。
       * 因此，这可以确保在整个路由周期中，所有的事务追踪数据是一致的。这样能够避免在某些事务结束后出现不一致的追踪数据，确保跟踪数据的完整性和可靠性
       *
       */

      // 监听 span 结束事件
      client.on('spanEnd', (span) => {
        const op = spanToJSON(span).op;
        if (
          span !== getRootSpan(span) ||
          (op !== 'navigation' && op !== 'pageload')
        ) {
          // 如果当前 span  不是根 span 或者操作不是 navigation 和 pageload 跳过处理
          return;
        }

        // 获取当前作用域
        const scope = getCurrentScope();
        // 获取传播上下文
        const oldPropagationContext = scope.getPropagationContext();

        // 更新当前作用域的传播上下文，确保 span 的跟踪信息一致，尤其是 sampled 标志和动态采样上下文
        scope.setPropagationContext({
          ...oldPropagationContext,
          sampled:
            oldPropagationContext.sampled !== undefined
              ? oldPropagationContext.sampled
              : spanIsSampled(span),
          dsc:
            oldPropagationContext.dsc ||
            getDynamicSamplingContextFromSpan(span),
        });
      });

      // 全局对象中存在 location 的话
      if (WINDOW.location) {
        // 如果启用了页面加载跟踪，则启动一个用于跟踪页面加载的 span
        if (instrumentPageLoad) {
          startBrowserTracingPageLoadSpan(client, {
            // 当前页面的路径名
            name: WINDOW.location.pathname,
            // pageload should always start at timeOrigin (and needs to be in s, not ms)
            // 页面加载应该始终从 timeOrigin 开始，转化为秒
            startTime: browserPerformanceTimeOrigin
              ? browserPerformanceTimeOrigin / 1000
              : undefined,
            // 为 span 添加一些自定义属性
            attributes: {
              [SEMANTIC_ATTRIBUTE_SENTRY_SOURCE]: 'url', // 跟踪的来源是 URL
              [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.pageload.browser', // 一个自动的页面加载事务，源于浏览器
            },
          });
        }

        // 如果启用了导航追踪，监听浏览器导航事件
        if (instrumentNavigation) {
          addHistoryInstrumentationHandler(({ to, from }) => {
            /**
             * 这段代码的目的是处理一种特定的边缘情况：在页面长时间加载后，可能会紧接着触发一次导航事件
             * 在这种情况下，导航可能是无效的（例如，导航到相同的 URL），
             * 因此我们需要避免为这个无效的导航创建不必要的 navigation span（导航事务）
             *
             * 如果 from 是 undefined 且 startingUrl 存在，我们就不会为此次导航创建一个新的事务。这是为了确保避免重复跟踪无效的导航操作。
             * 这保证了我们只为真正的导航操作创建事务，避免因浏览器状态或开发环境特殊情况（如开发工具或热模块重载器）造成的重复事务创建。
             *
             * 这个问题难以在所有环境下复现，但在某些情况下（特别是在开发过程中），此类冗余导航的现象确实存在。通过这段代码修复后，这种问题不再发生。
             *
             * 热模块重载器会动态替换模块，而无需刷新整个页面，这可能会导致导航状态变得混乱，从而触发重复的导航事件。
             */
            if (
              // 如果 from 是 undefined，意味着浏览器在处理导航时并没有明确的来源 URL
              // 这种情况可能发生在页面第一次加载后紧接着的导航操作，因为在这种情况下浏览器并没有一个上一个页面的明确 URL
              // 在 SPA（单页面应用）中，当用户第一次加载应用时，from 可能没有值
              from === undefined &&
              startingUrl &&
              // 如果 startingUrl 中包含 to，则说明这是一个重复的导航，避免不必要的事务跟踪
              startingUrl.indexOf(to) !== -1
            ) {
              // 重置 startingUrl 为了防止后续的导航事件再次遇到同样的问题，
              // 每次只要检测到这种无效导航，就会清空 startingUrl，确保后续的导航操作能够被正确跟踪
              startingUrl = undefined;
              return;
            }

            // 检查导航是否真正发生了，即 from 和 to 是否不同
            if (from !== to) {
              startingUrl = undefined;
              // 为这次导航创建一个新的 span
              startBrowserTracingNavigationSpan(client, {
                // 将当前页面路径作为导航 span 的名称
                name: WINDOW.location.pathname,
                attributes: {
                  [SEMANTIC_ATTRIBUTE_SENTRY_SOURCE]: 'url', // 跟踪的来源是 URL
                  [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.navigation.browser', // 一个自动的导航事务，源于浏览器
                },
              });
            }
          });
        }
      }

      // 如果启用了后台标签页的追踪功能，是注册一个监听器以便检测用户在浏览器中切换到后台标签页时的行为
      if (markBackgroundSpan) {
        // 检测当前标签页是否处于后台状态（例如，用户切换到其他标签页或最小化浏览器）
        // 在标签页进入后台时，可能需要暂停某些操作（如定时器、动画等），而在返回到该标签页时再恢复这些操作
        // 监控在后台标签页中执行的操作的性能，包括网络请求的响应时间、CPU 和内存的使用情况等
        registerBackgroundTabDetection();
      }

      // 如果启用了用户交互追踪功能，将会注册一个监听器来监控用户的交互事件
      // 用户交互（interactions）是应用性能监控中的关键因素，
      // 通过追踪用户点击、滚动、键盘输入等操作，可以分析应用对这些交互的响应情况
      if (enableInteractions) {
        registerInteractionListener(
          idleTimeout,
          finalTimeout,
          childSpanTimeout,
          latestRoute,
        );
      }

      // 启用了 INP（Interaction to Next Paint）追踪功能，会注册一个监听器用于 INP 数据收集
      // INP（Interaction to Next Paint）是一个用户交互性能指标，
      // 衡量从用户交互到下一个页面渲染的时间。启用这个功能有助于了解应用在响应用户操作时的速度和性能
      if (enableInp) {
        // 这个监听器会负责记录每次用户交互事件（如点击、输入）之后，页面渲染的响应时间。
        // 这对于优化用户体验至关重要，因为它反映了应用在用户操作之后的响应速度。
        registerInpInteractionListener();
      }

      // 对外部请求进行追踪（如 fetch 和 XHR 请求），并传入一系列配置选项
      instrumentOutgoingRequests(client, {
        traceFetch,
        traceXHR,
        // 设置哪些目标（URL）应该启用追踪传播
        tracePropagationTargets: client.getOptions().tracePropagationTargets,
        // 是否应该为某个请求创建一个 span，这是一个用于追踪该请求生命周期的逻辑判断
        shouldCreateSpanForRequest,
        // 是否启用 HTTP 请求的时序数据追踪，能够监控从发起请求到响应完成的时间
        enableHTTPTimings,
      });
    },
  };
}) satisfies IntegrationFn;

/**
 * Manually start a page load span.
 * This will only do something if a browser tracing integration integration has been setup.
 *
 * If you provide a custom `traceOptions` object, it will be used to continue the trace
 * instead of the default behavior, which is to look it up on the <meta> tags.
 */
export function startBrowserTracingPageLoadSpan(
  client: Client,
  spanOptions: StartSpanOptions,
  traceOptions?: {
    sentryTrace?: string | undefined;
    baggage?: string | undefined;
  },
): Span | undefined {
  client.emit('startPageLoadSpan', spanOptions, traceOptions);

  getCurrentScope().setTransactionName(spanOptions.name);

  const span = getActiveSpan();
  const op = span && spanToJSON(span).op;
  return op === 'pageload' ? span : undefined;
}

/**
 * Manually start a navigation span.
 * This will only do something if a browser tracing integration has been setup.
 */
export function startBrowserTracingNavigationSpan(
  client: Client,
  spanOptions: StartSpanOptions,
): Span | undefined {
  getIsolationScope().setPropagationContext(generatePropagationContext());
  getCurrentScope().setPropagationContext(generatePropagationContext());

  client.emit('startNavigationSpan', spanOptions);

  getCurrentScope().setTransactionName(spanOptions.name);

  const span = getActiveSpan();
  const op = span && spanToJSON(span).op;
  return op === 'navigation' ? span : undefined;
}

/** Returns the value of a meta tag */
export function getMetaContent(metaName: string): string | undefined {
  // Can't specify generic to `getDomElement` because tracing can be used
  // in a variety of environments, have to disable `no-unsafe-member-access`
  // as a result.
  const metaTag = getDomElement(`meta[name=${metaName}]`);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return metaTag ? metaTag.getAttribute('content') : undefined;
}

/** Start listener for interaction transactions */
function registerInteractionListener(
  idleTimeout: BrowserTracingOptions['idleTimeout'],
  finalTimeout: BrowserTracingOptions['finalTimeout'],
  childSpanTimeout: BrowserTracingOptions['childSpanTimeout'],
  latestRoute: RouteInfo,
): void {
  let inflightInteractionSpan: Span | undefined;
  const registerInteractionTransaction = (): void => {
    const op = 'ui.action.click';

    const activeSpan = getActiveSpan();
    const rootSpan = activeSpan && getRootSpan(activeSpan);
    if (rootSpan) {
      const currentRootSpanOp = spanToJSON(rootSpan).op;
      if (['navigation', 'pageload'].includes(currentRootSpanOp as string)) {
        DEBUG_BUILD &&
          logger.warn(
            `[Tracing] Did not create ${op} span because a pageload or navigation span is in progress.`,
          );
        return undefined;
      }
    }

    if (inflightInteractionSpan) {
      inflightInteractionSpan.setAttribute(
        SEMANTIC_ATTRIBUTE_SENTRY_IDLE_SPAN_FINISH_REASON,
        'interactionInterrupted',
      );
      inflightInteractionSpan.end();
      inflightInteractionSpan = undefined;
    }

    if (!latestRoute.name) {
      DEBUG_BUILD &&
        logger.warn(
          `[Tracing] Did not create ${op} transaction because _latestRouteName is missing.`,
        );
      return undefined;
    }

    inflightInteractionSpan = startIdleSpan(
      {
        name: latestRoute.name,
        op,
        attributes: {
          [SEMANTIC_ATTRIBUTE_SENTRY_SOURCE]: latestRoute.source || 'url',
        },
      },
      {
        idleTimeout,
        finalTimeout,
        childSpanTimeout,
      },
    );
  };

  if (WINDOW.document) {
    addEventListener('click', registerInteractionTransaction, {
      once: false,
      capture: true,
    });
  }
}
