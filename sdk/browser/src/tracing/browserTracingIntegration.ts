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
 * The Browser Tracing integration automatically instruments browser pageload/navigation
 * actions as transactions, and captures requests, metrics and errors as spans.
 *
 * The integration can be configured with a variety of options, and can be extended to use
 * any routing library.
 *
 * We explicitly export the proper type here, as this has to be extended in some cases.
 */
export const browserTracingIntegration = ((
  _options: Partial<BrowserTracingOptions> = {},
) => {
  registerSpanErrorInstrumentation();

  const {
    enableInp,
    enableLongTask,
    enableLongAnimationFrame,
    _experiments: { enableInteractions, enableStandaloneClsSpans },
    beforeStartSpan,
    idleTimeout,
    finalTimeout,
    childSpanTimeout,
    markBackgroundSpan,
    traceFetch,
    traceXHR,
    shouldCreateSpanForRequest,
    enableHTTPTimings,
    instrumentPageLoad,
    instrumentNavigation,
  } = {
    ...DEFAULT_BROWSER_TRACING_OPTIONS,
    ..._options,
  };

  const _collectWebVitals = startTrackingWebVitals({
    recordClsStandaloneSpans: enableStandaloneClsSpans || false,
  });

  if (enableInp) {
    startTrackingINP();
  }

  if (
    enableLongAnimationFrame &&
    GLOBAL_OBJ.PerformanceObserver &&
    PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')
  ) {
    startTrackingLongAnimationFrames();
  } else if (enableLongTask) {
    startTrackingLongTasks();
  }

  if (enableInteractions) {
    startTrackingInteractions();
  }

  const latestRoute: RouteInfo = {
    name: undefined,
    source: undefined,
  };

  /** Create routing idle transaction. */
  function _createRouteSpan(
    client: Client,
    startSpanOptions: StartSpanOptions,
  ): Span {
    const isPageloadTransaction = startSpanOptions.op === 'pageload';

    const finalStartSpanOptions: StartSpanOptions = beforeStartSpan
      ? beforeStartSpan(startSpanOptions)
      : startSpanOptions;

    const attributes = finalStartSpanOptions.attributes || {};

    // If `finalStartSpanOptions.name` is different than `startSpanOptions.name`
    // it is because `beforeStartSpan` set a custom name. Therefore we set the source to 'custom'.
    if (startSpanOptions.name !== finalStartSpanOptions.name) {
      attributes[SEMANTIC_ATTRIBUTE_SENTRY_SOURCE] = 'custom';
      finalStartSpanOptions.attributes = attributes;
    }

    latestRoute.name = finalStartSpanOptions.name;
    latestRoute.source = attributes[SEMANTIC_ATTRIBUTE_SENTRY_SOURCE];

    const idleSpan = startIdleSpan(finalStartSpanOptions, {
      idleTimeout,
      finalTimeout,
      childSpanTimeout,
      // should wait for finish signal if it's a pageload transaction
      disableAutoFinish: isPageloadTransaction,
      beforeSpanEnd: (span) => {
        _collectWebVitals();
        addPerformanceEntries(span, {
          recordClsOnPageloadSpan: !enableStandaloneClsSpans,
        });
      },
    });

    function emitFinish(): void {
      if (['interactive', 'complete'].includes(WINDOW.document.readyState)) {
        client.emit('idleSpanEnableAutoFinish', idleSpan);
      }
    }

    if (isPageloadTransaction && WINDOW.document) {
      WINDOW.document.addEventListener('readystatechange', () => {
        emitFinish();
      });

      emitFinish();
    }

    return idleSpan;
  }

  return {
    name: BROWSER_TRACING_INTEGRATION_ID,
    afterAllSetup(client) {
      let activeSpan: Span | undefined;
      let startingUrl: string | undefined =
        WINDOW.location && WINDOW.location.href;

      client.on('startNavigationSpan', (startSpanOptions) => {
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

        activeSpan = _createRouteSpan(client, {
          op: 'navigation',
          ...startSpanOptions,
        });
      });

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

        const sentryTrace =
          traceOptions.sentryTrace || getMetaContent('sentry-trace');
        const baggage = traceOptions.baggage || getMetaContent('baggage');

        const propagationContext = propagationContextFromHeaders(
          sentryTrace,
          baggage,
        );
        getCurrentScope().setPropagationContext(propagationContext);

        activeSpan = _createRouteSpan(client, {
          op: 'pageload',
          ...startSpanOptions,
        });
      });

      // A trace should to stay the consistent over the entire time span of one route.
      // Therefore, when the initial pageload or navigation root span ends, we update the
      // scope's propagation context to keep span-specific attributes like the `sampled` decision and
      // the dynamic sampling context valid, even after the root span has ended.
      // This ensures that the trace data is consistent for the entire duration of the route.
      client.on('spanEnd', (span) => {
        const op = spanToJSON(span).op;
        if (
          span !== getRootSpan(span) ||
          (op !== 'navigation' && op !== 'pageload')
        ) {
          return;
        }

        const scope = getCurrentScope();
        const oldPropagationContext = scope.getPropagationContext();

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

      if (WINDOW.location) {
        if (instrumentPageLoad) {
          startBrowserTracingPageLoadSpan(client, {
            name: WINDOW.location.pathname,
            // pageload should always start at timeOrigin (and needs to be in s, not ms)
            startTime: browserPerformanceTimeOrigin
              ? browserPerformanceTimeOrigin / 1000
              : undefined,
            attributes: {
              [SEMANTIC_ATTRIBUTE_SENTRY_SOURCE]: 'url',
              [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.pageload.browser',
            },
          });
        }

        if (instrumentNavigation) {
          addHistoryInstrumentationHandler(({ to, from }) => {
            /**
             * This early return is there to account for some cases where a navigation transaction starts right after
             * long-running pageload. We make sure that if `from` is undefined and a valid `startingURL` exists, we don't
             * create an uneccessary navigation transaction.
             *
             * This was hard to duplicate, but this behavior stopped as soon as this fix was applied. This issue might also
             * only be caused in certain development environments where the usage of a hot module reloader is causing
             * errors.
             */
            if (
              from === undefined &&
              startingUrl &&
              startingUrl.indexOf(to) !== -1
            ) {
              startingUrl = undefined;
              return;
            }

            if (from !== to) {
              startingUrl = undefined;
              startBrowserTracingNavigationSpan(client, {
                name: WINDOW.location.pathname,
                attributes: {
                  [SEMANTIC_ATTRIBUTE_SENTRY_SOURCE]: 'url',
                  [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.navigation.browser',
                },
              });
            }
          });
        }
      }

      if (markBackgroundSpan) {
        registerBackgroundTabDetection();
      }

      if (enableInteractions) {
        registerInteractionListener(
          idleTimeout,
          finalTimeout,
          childSpanTimeout,
          latestRoute,
        );
      }

      if (enableInp) {
        registerInpInteractionListener();
      }

      instrumentOutgoingRequests(client, {
        traceFetch,
        traceXHR,
        tracePropagationTargets: client.getOptions().tracePropagationTargets,
        shouldCreateSpanForRequest,
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
