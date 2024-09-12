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

/**
 * 这个函数的作用是检查一个 PerformanceEntry 对象是否是 PerformanceResourceTiming 类型
 * @param entry
 * @returns
 */
function isPerformanceResourceTiming(
  entry: PerformanceEntry,
): entry is PerformanceResourceTiming {
  return (
    // 类型为 resource
    entry.entryType === 'resource' &&
    // 存在这个属性，这是用于标识请求的发起方式
    'initiatorType' in entry &&
    // 检查这个类型为字符串
    typeof (entry as PerformanceResourceTiming).nextHopProtocol === 'string' &&
    // 检查请求的发起方式，必须是 fetch 或 xmlhttprequest。
    (entry.initiatorType === 'fetch' ||
      entry.initiatorType === 'xmlhttprequest')
  );
}

/**
 * 这个函数的主要功能是为 fetch 或 xhr 请求监听资源加载的性能数据，
 * 并在性能数据达到浏览器限制时自动清理观察器。
 * 核心机制依赖于浏览器的 PerformanceObserver，通过监听特定资源
 * （比如通过 fetch 请求的资源）的性能数据，收集这些信息后将其记录到传入的 span 对象中
 *
 * @param span 传入的 span 是一个尚未完成的跟踪跨度对象（通常用于记录请求或事务的生命周期）
 * span 必须包含与网络请求关联的 url 信息
 */
function addHTTPTimings(span: Span): void {
  // 将 span JSON化后,提取 url
  const { url } = spanToJSON(span).data || {};

  // url 不存在 或者 不是字符串,直接返回
  if (!url || typeof url !== 'string') {
    return;
  }

  // 为性能资源事件（'resource'）添加一个临时观察器。
  // 它会监听由浏览器性能 API 收集的资源加载数据，并执行回调函数
  // 观察器是临时的，当目标资源的性能数据记录完成后，
  // 通过 setTimeout 延迟调用清理函数来移除观察器，防止不必要的资源占用。
  const cleanup = addPerformanceInstrumentationHandler(
    'resource',
    ({ entries }) => {
      // entries: 性能条目的集合，代表浏览器记录的所有资源加载事件

      // 遍历每个条目
      entries.forEach((entry) => {
        // 检查当前条目是否为,且资源的名称（即其 URL）是否以目标 url 结尾
        if (isPerformanceResourceTiming(entry) && entry.name.endsWith(url)) {
          // 如果匹配，说明当前条目对应的资源就是我们要跟踪的请求

          //  将 entry 转换为适合 span 的数据
          const spanData = resourceTimingEntryToSpanData(entry);

          debugger;
          // 将这些性能数据附加到 span 对象上，逐个设置其属性。
          spanData.forEach((data) => span.setAttribute(...data));
          /**
           * 这里在下一次事件循环中,将该观察器清理掉.
           * 如果不等待到下一次事件循环就立即清理这个处理程序，那么可能会发生处理程序还没有完全处理完毕时，
           * 它就被提前清理掉了。这可能导致丢失部分性能数据，或者中断未完成的处理流程。
           *
           * 延迟执行清理函数。延迟的目的是为了确保观察器在处理完数据后再清理，而不是在处理过程中提前终止。
           */
          setTimeout(cleanup);
        }
      });
    },
  );
}

/**
 * 函数的主要作用是从 ALPN（Application-Layer Protocol Negotiation）协议 ID 中提取网络协议的名称和版本。
 * ALPN 是一种在 TLS 握手期间协商应用层协议的机制
 *
 * (https://www.iana.org/assignments/tls-extensiontype-values/tls-extensiontype-values.xhtml#alpn-protocol-ids)
 * @param nextHopProtocol 通常来自 PerformanceResourceTiming.nextHopProtocol 属性
 *
 * @example
 * 'http/1.1' ---------> { name: 'http', version: '1.1' }
 *
 * 'h2' ------->  { name: 'http', version: '2' }
 *
 * 'webrtc' -----------> { name: 'webrtc', version: 'unknown' }
 */
export function extractNetworkProtocol(nextHopProtocol: string): {
  name: string;
  version: string;
} {
  let name = 'unknown';
  let version = 'unknown';
  // 用于存储当前字符构建的协议名称
  let _name = '';

  // 循环处理每个字符
  for (const char of nextHopProtocol) {
    // http/1.1 etc.

    // 当遇到 '/' 字符时，通过 / 将协议 ID 分割为名称和版本
    if (char === '/') {
      [name, version] = nextHopProtocol.split('/') as [string, string];
      break;
    }
    // h2, h3 etc.

    // 如果当前字符是数字，表示可能是 HTTP/2 或 HTTP/3 协议
    if (!isNaN(Number(char))) {
      // _name 的值是 'h'，则将 name 设置为 'http'，并提取版本号
      // 例如，处理 h2 时，将 name 设置为 http，并将 version 设置为 2
      name = _name === 'h' ? 'http' : _name;
      version = nextHopProtocol.split(_name)[1] as string;
      break;
    }

    // 将当前字符添加到 _name 中，构建协议名称
    _name += char;
  }

  // 如果两者相等，表示没有找到版本号，可能是一些其他协议（例如 webrtc 或 ftp）
  if (_name === nextHopProtocol) {
    // webrtc, ftp, etc.
    name = _name;
  }
  return { name, version };
}

/**
 * 这个函数将给定的时间（通常是一个相对于某个起点的时间戳）转换为一个绝对时间（以秒为单位），
 * 它通过将相对于性能时间起点的时间加上性能时间的起点来实现这一点。
 * @param time
 * @returns
 */
function getAbsoluteTime(time: number = 0): number {
  return (
    // 取浏览器性能时间的起点 + time
    ((browserPerformanceTimeOrigin || performance.timeOrigin) + time) / 1000
  );
}

/**
 * 用于将 PerformanceResourceTiming 对象转换为一组键值对（元组数组），这可以用于性能监控或日志记录。
 * @param resourceTiming
 * @returns
 */
function resourceTimingEntryToSpanData(
  resourceTiming: PerformanceResourceTiming,
): [string, string | number][] {
  // 提取协议的名称和版本
  const { name, version } = extractNetworkProtocol(
    resourceTiming.nextHopProtocol,
  );

  // 用于存储所有的时间戳和对应的描述
  const timingSpanData: [string, string | number][] = [];

  timingSpanData.push(
    ['network.protocol.version', version], // 添加网络协议版本
    ['network.protocol.name', name], // 添加网络协议名称
  );

  if (!browserPerformanceTimeOrigin) {
    // 如果没有时间起点，直接返回
    return timingSpanData;
  }

  return [
    ...timingSpanData,
    [
      'http.request.redirect_start',
      getAbsoluteTime(resourceTiming.redirectStart), // 获取重定向开始时间
    ],
    ['http.request.fetch_start', getAbsoluteTime(resourceTiming.fetchStart)], // 获取请求开始时间
    [
      'http.request.domain_lookup_start',
      getAbsoluteTime(resourceTiming.domainLookupStart), // 获取域名查找开始时间
    ],
    [
      'http.request.domain_lookup_end',
      getAbsoluteTime(resourceTiming.domainLookupEnd), // 获取域名查找结束时间
    ],
    [
      'http.request.connect_start',
      getAbsoluteTime(resourceTiming.connectStart), // 获取连接开始时间
    ],
    [
      'http.request.secure_connection_start',
      getAbsoluteTime(resourceTiming.secureConnectionStart), // 获取安全连接开始时间
    ],
    ['http.request.connection_end', getAbsoluteTime(resourceTiming.connectEnd)], // 获取连接结束时间
    [
      'http.request.request_start',
      getAbsoluteTime(resourceTiming.requestStart), // 获取请求发送开始时间
    ],
    [
      'http.request.response_start',
      getAbsoluteTime(resourceTiming.responseStart), // 获取响应开始时间
    ],
    ['http.request.response_end', getAbsoluteTime(resourceTiming.responseEnd)], // 获取响应结束时间
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
 * 函数主要用于创建和跟踪 XMLHttpRequest（XHR）请求的跨度（Span），
 * 以便在性能监控和错误追踪中提供更详细的上下文信息
 *
 * @param handlerData 包含关于 XHR 请求的数据，包括请求的 xhr 对象
 * @param shouldCreateSpan 是否应该创建跨度
 * @param shouldAttachHeaders 是否应该附加跟踪头
 * @param spans 一个记录，存储所有创建的跨度
 * @returns 如果创建了Span，则为Span，否则为空
 */
export function xhrCallback(
  handlerData: HandlerDataXhr,
  shouldCreateSpan: (url: string) => boolean,
  shouldAttachHeaders: (url: string) => boolean,
  spans: Record<string, Span>,
): Span | undefined {
  // 获取 xhr 对象
  const xhr = handlerData.xhr;

  // 检查 xhr 是否存在、是否为 Sentry 自有请求
  const sentryXhrData = xhr && xhr[SENTRY_XHR_DATA_KEY];

  // 如果xhr 不存在 或者 是sentry 自有请求 或者 没有Sentry XHR 数据 直接返回 undefined
  if (!xhr || xhr.__sentry_own_request__ || !sentryXhrData) {
    return undefined;
  }

  // 检查是否启用了跟踪 且 是否可以创建跨度
  const shouldCreateSpanResult =
    hasTracingEnabled() && shouldCreateSpan(sentryXhrData.url);

  // 如果请求已完成并且可以创建跨度
  if (handlerData.endTimestamp && shouldCreateSpanResult) {
    // 查找与当前请求相关的跨度 ID，并结束它
    const spanId = xhr.__sentry_xhr_span_id__;
    if (!spanId) return;

    const span = spans[spanId];
    if (span && sentryXhrData.status_code !== undefined) {
      // 更新 HTTP 状态码，然后从 spans 记录中删除该跨度
      setHttpStatus(span, sentryXhrData.status_code);
      span.end();

      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete spans[spanId];
    }
    return undefined;
  }

  // 接下来要创建 span

  // 获取请求的完整 URL
  const fullUrl = getFullURL(sentryXhrData.url);
  // 获取主机名
  const host = fullUrl ? parseUrl(fullUrl).host : undefined;

  // 检查是否有活跃的 span
  const hasParent = !!getActiveSpan();

  // 如果可以创建span且存在父span，则创建新的span，并设置相应的属性。
  const span =
    shouldCreateSpanResult && hasParent
      ? // 创建一个不活跃的 span
        startInactiveSpan({
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
      : new SentryNonRecordingSpan(); // 否则创建一个不追踪的span

  xhr.__sentry_xhr_span_id__ = span.spanContext().spanId;
  spans[xhr.__sentry_xhr_span_id__] = span;

  const client = getClient();

  // 如果 setRequestHeader 可用，且应该添加头信息  且 存在 客户端实例
  if (
    xhr.setRequestHeader &&
    shouldAttachHeaders(sentryXhrData.url) &&
    client
  ) {
    // 将跟踪头附加到 XHR 请求中
    addTracingHeadersToXhrRequest(
      xhr,
      client,
      /**
       * - 性能禁用：如果性能监测被禁用（例如，在某些配置中可能会关闭性能追踪功能），或者当前没有活动的根跨度
       * （比如页面加载、导航或用户交互等事件），那么就不应该将当前的跨度作为生成跟踪头的基础。
       *
       * - 跟踪头的生成：在这种情况下，跟踪头将不基于当前的跨度生成，而是从当前的作用域中生成。
       * 这意味着跟踪头的生成将不会依赖于当前的请求上下文，而是使用默认的上下文来决定如何生成头信息。
       *
       * - 采样决策延迟：在这种情况下，采样决策将被推迟。
       * 这意味着，可能会在后续的请求中再进行采样，而不是立刻基于当前的状态进行决定。
       */
      hasTracingEnabled() && hasParent ? span : undefined,
    );
  }

  return span;
}

/**
 * 函数的主要作用是为 XMLHttpRequest（XHR）请求添加 Sentry 跟踪头和动态采样上下文头，
 * 以便在进行跨服务的请求追踪时，能够准确地记录和管理请求的上下文信息
 *
 * @param xhr 被 Sentry 包装的 XMLHttpRequest 对象，用于发送 HTTP 请求
 * @param client Sentry 客户端实例，用于获取动态采样上下文
 * @param span 当前的跨度（可选），如果提供则用于生成跟踪头
 */
function addTracingHeadersToXhrRequest(
  xhr: SentryWrappedXMLHttpRequest,
  client: Client,
  span?: Span,
): void {
  // 获取当前作用域
  const scope = getCurrentScope();
  // 获取隔离作用域
  const isolationScope = getIsolationScope();

  // 提取信息，用于确定当前请求的跟踪状态
  const { traceId, spanId, sampled, dsc } = {
    // 从当前作用域和隔离作用域提取传播上下文
    ...isolationScope.getPropagationContext(),
    ...scope.getPropagationContext(),
  };

  // 生成 Sentry 跟踪头
  const sentryTraceHeader =
    span && hasTracingEnabled()
      ? spanToTraceHeader(span)
      : generateSentryTraceHeader(traceId, spanId, sampled);

  // 生成 Sentry 背景头
  // 根据当前的动态采样上下文生成 Sentry 背景头。这里的背景头包含了与采样相关的附加信息
  const sentryBaggageHeader = dynamicSamplingContextToSentryBaggageHeader(
    dsc ||
      (span
        ? getDynamicSamplingContextFromSpan(span)
        : getDynamicSamplingContextFromClient(traceId, client)),
  );

  // 将生成的 Sentry 跟踪头和背景头设置到 XHR 请求中
  setHeaderOnXhr(xhr, sentryTraceHeader, sentryBaggageHeader);
}

/**
 * 函数的主要目的是将 Sentry 跟踪头和背景头设置到 XHR 请求中
 * @param xhr
 * @param sentryTraceHeader Sentry 跟踪头的值，包含了请求的追踪信息
 * @param sentryBaggageHeader Sentry 背景头的值，可以是 undefined
 */
function setHeaderOnXhr(
  xhr: SentryWrappedXMLHttpRequest,
  sentryTraceHeader: string,
  sentryBaggageHeader: string | undefined,
): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    // 设置 Sentry 的跟踪头（sentry-trace）
    xhr.setRequestHeader!('sentry-trace', sentryTraceHeader);
    if (sentryBaggageHeader) {
      // setRequestHeader 方法允许多次调用相同的头部，如果多次设置相同的头，值会合并成一个请求头
      // 因此，我们可以简单地设置一个北京头，而不需要检查之前的内容
      // https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/setRequestHeader
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      // 设置背景头（通常用于动态采样上下文）
      xhr.setRequestHeader!(BAGGAGE_HEADER_NAME, sentryBaggageHeader);
    }
  } catch (_) {
    // Error: InvalidStateError: Failed to execute 'setRequestHeader' on 'XMLHttpRequest': The object's state must be OPENED.
  }
}

/**
 * 获取给定 URL 的完整形式
 * @param url  需要解析的 URL，可以是相对 URL 或绝对 URL
 * @returns
 */
function getFullURL(url: string): string | undefined {
  try {
    // 这允许相对 URL 也能被正确解析为绝对 URL
    // 如果 url 是一个完整的 URL，则基础 URL 会被忽略
    const parsed = new URL(url, WINDOW.location.origin);
    return parsed.href;
  } catch {
    return undefined;
  }
}
