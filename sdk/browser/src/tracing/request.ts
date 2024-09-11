import {
  SENTRY_XHR_DATA_KEY,
  addPerformanceInstrumentationHandler,
  addXhrInstrumentationHandler,
} from '@xigua-monitor/browser-utils';
import {
  SEMANTIC_ATTRIBUTE_SENTRY_OP,
  SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN,
  SentryNonRecordingSpan,
  getActiveSpan,
  getClient,
  getCurrentScope,
  getDynamicSamplingContextFromClient,
  getDynamicSamplingContextFromSpan,
  getIsolationScope,
  hasTracingEnabled,
  instrumentFetchRequest,
  setHttpStatus,
  spanToJSON,
  spanToTraceHeader,
  startInactiveSpan,
} from '@xigua-monitor/core';
import type {
  Client,
  HandlerDataXhr,
  SentryWrappedXMLHttpRequest,
  Span,
} from '@xigua-monitor/types';
import {
  BAGGAGE_HEADER_NAME,
  addFetchEndInstrumentationHandler,
  addFetchInstrumentationHandler,
  browserPerformanceTimeOrigin,
  dynamicSamplingContextToSentryBaggageHeader,
  generateSentryTraceHeader,
  parseUrl,
  stringMatchesSomePattern,
} from '@xigua-monitor/utils';
import { WINDOW } from '../helpers';

/**
 * 用于配置请求相关追踪的接口,提供了多种选项来控制如何在 HTTP 请求中附加追踪头部和其他信息
 * 主要用于与 Sentry 的追踪机制集成，帮助开发者对发出的请求进行监控和性能跟踪
 */
export interface RequestInstrumentationOptions {
  /**
   * 这个选项用于定义哪些外发请求会附带 sentry-trace 和 baggage 头部
   *
   * 默认行为：如果没有设置该选项，追踪头部会附加到所有的外发请求
   * 如果在浏览器 SDK 中使用，默认情况下仅对同源请求附加追踪头部
   *
   * 跨域请求：在浏览器环境中，随意设置该选项可能导致 CORS（跨域资源共享）问题。
   * 建议仅在你可以控制请求的后端 CORS 头部的情况下，才对跨域请求附加这些头部。
   * 例如，后端需要返回 Access-Control-Allow-Headers: sentry-trace, baggage 头部，以确保请求不被阻止。
   *
   * 匹配逻辑：如果提供了 tracePropagationTargets 数组，它会匹配外发请求的整个 URL
   * 浏览器 SDK 中，它还会匹配请求的路径名。
   * 可以为相对路径设置匹配规则，例如 /^\/api/ 可以匹配同域的 /api 路由
   *
   * 部分匹配：数组中的字符串或正则表达式将部分匹配 URL 或路径名，只要匹配任意部分，就会附加追踪头部。
   *
   * @example
   *  - tracePropagationTargets: [/^\/api/] 且请求 URL 为 https://same-origin.com/api/posts：
   *  追踪头部会附加，因为请求是同源的，且正则匹配到路径名 /api/posts
   *
   *  - tracePropagationTargets: [/^\/api/] 且请求 URL 为 https://different-origin.com/api/posts：
   *  追踪头部不会附加，因为正则只会在同源请求时匹配路径名
   *
   *  - racePropagationTargets: [/^\/api/, 'https://external-api.com'] 且请求 URL 为 https://external-api.com/v1/data：
   *  追踪头部会附加，因为请求的 URL 匹配到了字符串 'https://external-api.com'
   */
  tracePropagationTargets?: Array<string | RegExp>;

  /**
   * 用于启用或禁用 fetch 请求的追踪补丁
   *
   * Default: true
   */
  traceFetch: boolean;

  /**
   * 用于启用或禁用 XMLHttpRequest (XHR) 请求的追踪补丁
   *
   * Default: true
   */
  traceXHR: boolean;

  /**
   * 启用此选项后，Sentry 会捕获 HTTP 请求的时间，并将其添加到相应的 HTTP span（追踪时间段）中
   *
   * Default: true
   */
  enableHTTPTimings: boolean;

  /**
   * 这是一个回调函数，在为某个请求的 URL 创建 span 之前调用。
   * 如果返回 false，则不会为该请求创建 span。
   *
   * 默认对所有请求创建 span
   * Default: (url: string) => true
   *
   * 如果你不想为某些特定的 URL 请求创建 span，可以自定义此函数。
   * 例如，对于不需要追踪的静态资源请求（如图像或样式表），可以返回 false 以跳过这些请求的追踪
   */
  shouldCreateSpanForRequest?(this: void, url: string): boolean;
}

// 下面这两个都是管理追踪的 span（时间段）的状态
/**
 * 追踪每个 HTTP 请求和响应时，你可以通过 responseToSpanId 找到与某个响应相关联的追踪 ID，
 * 进而查找更多与该请求相关的追踪信息。 weakMap 可以被垃圾回收掉
 */
const responseToSpanId = new WeakMap<object, string>();
/**
 * 用来记录和查找某个追踪段的结束时间，帮助在请求结束时分析性能数据
 */
const spanIdToEndTimestamp = new Map<string, number>();

/**
 * 默认的请求追踪配置，追踪 fetch 请求、追踪 XHR 请求、启用 HTTP 请求的时间捕获（如请求的开始时间、结束时间等）
 */
export const defaultRequestInstrumentationOptions: RequestInstrumentationOptions =
  {
    traceFetch: true,
    traceXHR: true,
    enableHTTPTimings: true,
  };

/**
 * 这个函数主要为 fetch 和 XHR 请求注册 span 创建器
 * 即当发出 HTTP 请求时，会自动生成和追踪相应的时间段（span），用于性能监控和追踪系统。
 * 通过拦截和处理所有的 fetch 和 XHR 请求来实现的
 *
 * @param client Sentry 客户端实例
 * @param _options 配置对象，自定义 HTTP 请求的追踪方式
 */
export function instrumentOutgoingRequests(
  client: Client,
  _options?: Partial<RequestInstrumentationOptions>,
): void {
  const {
    traceFetch, // 是否追踪 fetch 请求，默认为 true
    traceXHR, // 是否追踪 XHR 请求，默认为 true
    shouldCreateSpanForRequest, // 用于决定是否为给定的请求创建 span。如果没有提供，默认会为所有请求创建 span
    enableHTTPTimings, // 是否启用 HTTP 请求的时间捕获，默认启用
    tracePropagationTargets, // 用于决定是否为特定请求附加追踪头的目标。是一个包含 URL 或正则表达式的数组
  } = {
    traceFetch: defaultRequestInstrumentationOptions.traceFetch,
    traceXHR: defaultRequestInstrumentationOptions.traceXHR,
    ..._options,
  };

  /**
   * 如果提供了则使用提供的，否则默认所有的请求都创建 span
   */
  const shouldCreateSpan =
    typeof shouldCreateSpanForRequest === 'function'
      ? shouldCreateSpanForRequest
      : (_: string) => true;

  /**
   * 用于判断是否应该为某个请求附加追踪头
   * @param url
   * @returns
   */
  const shouldAttachHeadersWithTargets = (url: string): boolean =>
    shouldAttachHeaders(url, tracePropagationTargets);

  /** 用于存储所有当前活动的请求 span */
  const spans: Record<string, Span> = {};

  // 启用了 fetch 追踪
  if (traceFetch) {
    // Keeping track of http requests, whose body payloads resolved later than the intial resolved request
    // e.g. streaming using server sent events (SSE)
    /**
     * 添加一个事件处理器
     */
    client.addEventProcessor((event) => {
      // 如果当前是事务且存在子 span
      if (event.type === 'transaction' && event.spans) {
        // 遍历所有的子 span
        event.spans.forEach((span) => {
          // 检查操作类型是否为 'http.client'
          if (span.op === 'http.client') {
            // 如果该 span 的 span_id 在 spanIdToEndTimestamp 映射表中有记录，则更新该 span 的结束时间戳,并将记录删除
            // 这个过程的意义在于处理一些特殊情况，例如流式请求（如 SSE），其响应时间与请求初始时间不同步。
            const updatedTimestamp = spanIdToEndTimestamp.get(span.span_id);
            if (updatedTimestamp) {
              span.timestamp = updatedTimestamp / 1000;
              spanIdToEndTimestamp.delete(span.span_id);
            }
          }
        });
      }
      return event;
    });

    // 该函数会处理 fetch 请求的结束
    addFetchEndInstrumentationHandler((handlerData) => {
      if (handlerData.response) {
        // 如果存在响应,从映射中获取与该响应对应的 span_id
        const span = responseToSpanId.get(handlerData.response);

        // 如果存在span 且 相应结束时间也存在，
        if (span && handlerData.endTimestamp) {
          // 则更新该 span 的结束时间戳
          // 这样可以确保在 fetch 请求完成时，追踪记录到请求的实际结束时间
          spanIdToEndTimestamp.set(span, handlerData.endTimestamp);
        }
      }
    });

    // 该函数会拦截 fetch 请求，在每次请求发出时创建一个 span 以追踪该请求
    addFetchInstrumentationHandler((handlerData) => {
      // 该函数主要负责根据传入的 handlerData 生成一个追踪 span，
      // 并决定是否应该为该请求附加 sentry-trace 和 baggage 头
      const createdSpan = instrumentFetchRequest(
        handlerData,
        shouldCreateSpan,
        shouldAttachHeadersWithTargets,
        spans,
      );

      // 如果请求的 response 对象存在，且 handlerData.fetchData.__span 存在（__span 为 span_id）
      if (handlerData.response && handlerData.fetchData.__span) {
        // 将该响应和对应的 span_id 关联存储到 responseToSpanId 映射中
        responseToSpanId.set(
          handlerData.response,
          handlerData.fetchData.__span,
        );
      }

      /**
       * 在 fetch 追踪的过程中，无法直接使用 window.location，但为了获取可靠的 server.address 属性，开发者通过其他方式扩展了这一功能
       * 并非所有请求都可以直接依赖 window.location 来确定请求的目标服务器地址
       * 这是因为 fetch 请求的 URL 可以是绝对路径，也可以是相对路径，尤其是在跨域请求中，
       * window.location 仅反映当前页面的地址，并不总是与请求的目标地址一致。
       */
      if (createdSpan) {
        // 使用 getFullURL 解析完整的 URL
        const fullUrl = getFullURL(handlerData.fetchData.url);
        // 通过 parseUrl 提取主机名，将其添加到 span 的属性中
        const host = fullUrl ? parseUrl(fullUrl).host : undefined;
        createdSpan.setAttributes({
          'http.url': fullUrl,
          'server.address': host,
        });
      }

      // 如果启用了捕获http 请求时间， span 添加 HTTP 请求的性能时间数据，进一步帮助分析请求的耗时。
      if (enableHTTPTimings && createdSpan) {
        addHTTPTimings(createdSpan);
      }
    });
  }

  // 启用了 xhr 追踪
  if (traceXHR) {
    // 为每次 XHR 请求生成一个追踪 span
    addXhrInstrumentationHandler((handlerData) => {
      // 创建一个追踪 span，该函数根据 handlerData 中的请求信息，决定是否应该为当前请求生成追踪记录
      const createdSpan = xhrCallback(
        handlerData,
        shouldCreateSpan,
        shouldAttachHeadersWithTargets,
        spans,
      );

      // 如果启用了 enableHTTPTimings，则会为该 span 添加 HTTP 请求的时间追踪信息
      if (enableHTTPTimings && createdSpan) {
        addHTTPTimings(createdSpan);
      }
    });
  }
}

function isPerformanceResourceTiming(
  entry: PerformanceEntry,
): entry is PerformanceResourceTiming {
  return (
    entry.entryType === 'resource' &&
    'initiatorType' in entry &&
    typeof (entry as PerformanceResourceTiming).nextHopProtocol === 'string' &&
    (entry.initiatorType === 'fetch' ||
      entry.initiatorType === 'xmlhttprequest')
  );
}

/**
 * Creates a temporary observer to listen to the next fetch/xhr resourcing timings,
 * so that when timings hit their per-browser limit they don't need to be removed.
 *
 * @param span A span that has yet to be finished, must contain `url` on data.
 */
function addHTTPTimings(span: Span): void {
  const { url } = spanToJSON(span).data || {};

  if (!url || typeof url !== 'string') {
    return;
  }

  const cleanup = addPerformanceInstrumentationHandler(
    'resource',
    ({ entries }) => {
      entries.forEach((entry) => {
        if (isPerformanceResourceTiming(entry) && entry.name.endsWith(url)) {
          const spanData = resourceTimingEntryToSpanData(entry);
          spanData.forEach((data) => span.setAttribute(...data));
          // In the next tick, clean this handler up
          // We have to wait here because otherwise this cleans itself up before it is fully done
          setTimeout(cleanup);
        }
      });
    },
  );
}

/**
 * Converts ALPN protocol ids to name and version.
 *
 * (https://www.iana.org/assignments/tls-extensiontype-values/tls-extensiontype-values.xhtml#alpn-protocol-ids)
 * @param nextHopProtocol PerformanceResourceTiming.nextHopProtocol
 */
export function extractNetworkProtocol(nextHopProtocol: string): {
  name: string;
  version: string;
} {
  let name = 'unknown';
  let version = 'unknown';
  let _name = '';
  for (const char of nextHopProtocol) {
    // http/1.1 etc.
    if (char === '/') {
      [name, version] = nextHopProtocol.split('/') as [string, string];
      break;
    }
    // h2, h3 etc.
    if (!isNaN(Number(char))) {
      name = _name === 'h' ? 'http' : _name;
      version = nextHopProtocol.split(_name)[1] as string;
      break;
    }
    _name += char;
  }
  if (_name === nextHopProtocol) {
    // webrtc, ftp, etc.
    name = _name;
  }
  return { name, version };
}

function getAbsoluteTime(time: number = 0): number {
  return (
    ((browserPerformanceTimeOrigin || performance.timeOrigin) + time) / 1000
  );
}

function resourceTimingEntryToSpanData(
  resourceTiming: PerformanceResourceTiming,
): [string, string | number][] {
  const { name, version } = extractNetworkProtocol(
    resourceTiming.nextHopProtocol,
  );

  const timingSpanData: [string, string | number][] = [];

  timingSpanData.push(
    ['network.protocol.version', version],
    ['network.protocol.name', name],
  );

  if (!browserPerformanceTimeOrigin) {
    return timingSpanData;
  }
  return [
    ...timingSpanData,
    [
      'http.request.redirect_start',
      getAbsoluteTime(resourceTiming.redirectStart),
    ],
    ['http.request.fetch_start', getAbsoluteTime(resourceTiming.fetchStart)],
    [
      'http.request.domain_lookup_start',
      getAbsoluteTime(resourceTiming.domainLookupStart),
    ],
    [
      'http.request.domain_lookup_end',
      getAbsoluteTime(resourceTiming.domainLookupEnd),
    ],
    [
      'http.request.connect_start',
      getAbsoluteTime(resourceTiming.connectStart),
    ],
    [
      'http.request.secure_connection_start',
      getAbsoluteTime(resourceTiming.secureConnectionStart),
    ],
    ['http.request.connection_end', getAbsoluteTime(resourceTiming.connectEnd)],
    [
      'http.request.request_start',
      getAbsoluteTime(resourceTiming.requestStart),
    ],
    [
      'http.request.response_start',
      getAbsoluteTime(resourceTiming.responseStart),
    ],
    ['http.request.response_end', getAbsoluteTime(resourceTiming.responseEnd)],
  ];
}

/**
 * 这个函数用于判断是否应该在请求中附加跟踪头部（tracing headers）
 * 此函数只在测试时导出，主要目的是为了控制请求的跟踪行为。
 *
 * @param targetUrl 请求目标 URL
 * @param tracePropagationTargets 一个字符串或正则表达式数组，用于指定哪些 URL 应该附加跟踪头。
 * 如果未定义，函数会根据其他条件决定是否附加头部
 * @returns 是否应该附加跟踪头
 */
export function shouldAttachHeaders(
  targetUrl: string,
  tracePropagationTargets: (string | RegExp)[] | undefined,
): boolean {
  // 当前窗口的 URL
  // 如果在某些环境中（例如浏览器扩展、Web Workers），window.location 可能未定义，因此需要进行检查
  const href: string | undefined = WINDOW.location && WINDOW.location.href;

  if (!href) {
    // 如果不存在，函数将默认只对以 / 开头的相对请求附加跟踪头
    // 注意，双斜杠（如 //example.com/api）表示相同协议的简写，可能是跨域请求，因此要排除这种情况

    // 检查 targetUrl 是否是相对请求，排除了双斜杠的情况
    const isRelativeSameOriginRequest = !!targetUrl.match(/^\/(?!\/)/);
    if (!tracePropagationTargets) {
      // 果没有提供 tracePropagationTargets，仅对相对请求附加跟踪头
      return isRelativeSameOriginRequest;
    } else {
      // 检查 targetUrl 是否与提供的模式匹配。
      return stringMatchesSomePattern(targetUrl, tracePropagationTargets);
    }
  } else {
    // href 存在

    let resolvedUrl;
    let currentOrigin;

    // 尝试将 targetUrl 解析为绝对 URL。如果解析失败，将捕获异常并返回 false，表示不附加跟踪头
    try {
      resolvedUrl = new URL(targetUrl, href);
      currentOrigin = new URL(href).origin;
    } catch (e) {
      return false;
    }

    // 判断请求是否为同源请求
    const isSameOriginRequest = resolvedUrl.origin === currentOrigin;
    if (!tracePropagationTargets) {
      // 没有提供 tracePropagationTargets， 即仅对同源请求附加跟踪头。
      return isSameOriginRequest;
    } else {
      // 首先检查整个 URL 是否与模式匹配
      return (
        stringMatchesSomePattern(
          resolvedUrl.toString(),
          tracePropagationTargets,
        ) ||
        // 如果是同源请求，再检查路径 (resolvedUrl.pathname) 是否与模式匹配
        (isSameOriginRequest &&
          stringMatchesSomePattern(
            resolvedUrl.pathname,
            tracePropagationTargets,
          ))
      );
    }
  }
}

/**
 * Create and track xhr request spans
 *
 * @returns Span if a span was created, otherwise void.
 */
export function xhrCallback(
  handlerData: HandlerDataXhr,
  shouldCreateSpan: (url: string) => boolean,
  shouldAttachHeaders: (url: string) => boolean,
  spans: Record<string, Span>,
): Span | undefined {
  const xhr = handlerData.xhr;
  const sentryXhrData = xhr && xhr[SENTRY_XHR_DATA_KEY];

  if (!xhr || xhr.__sentry_own_request__ || !sentryXhrData) {
    return undefined;
  }

  const shouldCreateSpanResult =
    hasTracingEnabled() && shouldCreateSpan(sentryXhrData.url);

  // check first if the request has finished and is tracked by an existing span which should now end
  if (handlerData.endTimestamp && shouldCreateSpanResult) {
    const spanId = xhr.__sentry_xhr_span_id__;
    if (!spanId) return;

    const span = spans[spanId];
    if (span && sentryXhrData.status_code !== undefined) {
      setHttpStatus(span, sentryXhrData.status_code);
      span.end();

      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete spans[spanId];
    }
    return undefined;
  }

  const fullUrl = getFullURL(sentryXhrData.url);
  const host = fullUrl ? parseUrl(fullUrl).host : undefined;

  const hasParent = !!getActiveSpan();

  const span =
    shouldCreateSpanResult && hasParent
      ? startInactiveSpan({
          name: `${sentryXhrData.method} ${sentryXhrData.url}`,
          attributes: {
            type: 'xhr',
            'http.method': sentryXhrData.method,
            'http.url': fullUrl,
            url: sentryXhrData.url,
            'server.address': host,
            [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.http.browser',
            [SEMANTIC_ATTRIBUTE_SENTRY_OP]: 'http.client',
          },
        })
      : new SentryNonRecordingSpan();

  xhr.__sentry_xhr_span_id__ = span.spanContext().spanId;
  spans[xhr.__sentry_xhr_span_id__] = span;

  const client = getClient();

  if (
    xhr.setRequestHeader &&
    shouldAttachHeaders(sentryXhrData.url) &&
    client
  ) {
    addTracingHeadersToXhrRequest(
      xhr,
      client,
      // If performance is disabled (TWP) or there's no active root span (pageload/navigation/interaction),
      // we do not want to use the span as base for the trace headers,
      // which means that the headers will be generated from the scope and the sampling decision is deferred
      hasTracingEnabled() && hasParent ? span : undefined,
    );
  }

  return span;
}

function addTracingHeadersToXhrRequest(
  xhr: SentryWrappedXMLHttpRequest,
  client: Client,
  span?: Span,
): void {
  const scope = getCurrentScope();
  const isolationScope = getIsolationScope();
  const { traceId, spanId, sampled, dsc } = {
    ...isolationScope.getPropagationContext(),
    ...scope.getPropagationContext(),
  };

  const sentryTraceHeader =
    span && hasTracingEnabled()
      ? spanToTraceHeader(span)
      : generateSentryTraceHeader(traceId, spanId, sampled);

  const sentryBaggageHeader = dynamicSamplingContextToSentryBaggageHeader(
    dsc ||
      (span
        ? getDynamicSamplingContextFromSpan(span)
        : getDynamicSamplingContextFromClient(traceId, client)),
  );

  setHeaderOnXhr(xhr, sentryTraceHeader, sentryBaggageHeader);
}

function setHeaderOnXhr(
  xhr: SentryWrappedXMLHttpRequest,
  sentryTraceHeader: string,
  sentryBaggageHeader: string | undefined,
): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    xhr.setRequestHeader!('sentry-trace', sentryTraceHeader);
    if (sentryBaggageHeader) {
      // From MDN: "If this method is called several times with the same header, the values are merged into one single request header."
      // We can therefore simply set a baggage header without checking what was there before
      // https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/setRequestHeader
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      xhr.setRequestHeader!(BAGGAGE_HEADER_NAME, sentryBaggageHeader);
    }
  } catch (_) {
    // Error: InvalidStateError: Failed to execute 'setRequestHeader' on 'XMLHttpRequest': The object's state must be OPENED.
  }
}

function getFullURL(url: string): string | undefined {
  try {
    // By adding a base URL to new URL(), this will also work for relative urls
    // If `url` is a full URL, the base URL is ignored anyhow
    const parsed = new URL(url, WINDOW.location.origin);
    return parsed.href;
  } catch {
    return undefined;
  }
}
