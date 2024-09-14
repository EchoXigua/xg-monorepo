import type {
  Client,
  HandlerDataFetch,
  Scope,
  Span,
  SpanOrigin,
} from '@xigua-monitor/types';
import {
  BAGGAGE_HEADER_NAME,
  dynamicSamplingContextToSentryBaggageHeader,
  generateSentryTraceHeader,
  isInstanceOf,
  parseUrl,
} from '@xigua-monitor/utils';
import { getClient, getCurrentScope, getIsolationScope } from './currentScopes';
import {
  SEMANTIC_ATTRIBUTE_SENTRY_OP,
  SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN,
} from './semanticAttributes';
import {
  SPAN_STATUS_ERROR,
  getDynamicSamplingContextFromClient,
  getDynamicSamplingContextFromSpan,
  setHttpStatus,
  startInactiveSpan,
} from './tracing';
import { SentryNonRecordingSpan } from './tracing/sentryNonRecordingSpan';
import { hasTracingEnabled } from './utils/hasTracingEnabled';
import { getActiveSpan, spanToTraceHeader } from './utils/spanUtils';

type PolymorphicRequestHeaders =
  | Record<string, string | undefined>
  | Array<[string, string]>
  // the below is not preicsely the Header type used in Request, but it'll pass duck-typing
  | {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [key: string]: any;
      append: (key: string, value: string) => void;
      get: (key: string) => string | null | undefined;
    };

/**
 * 这个函数用于创建和追踪 fetch 请求中的 span，配合 addFetchInstrumentationHandler 进行使用
 * 来捕获和记录 fetch 请求的性能数据或错误信息。
 * 它的设计思路围绕是否需要创建 span、以及是否应该附加跟踪头部（tracing headers）来进行。
 *
 * @param handlerData 包含与 fetch 请求相关的所有信息
 * @param shouldCreateSpan 是否为该请求创建 span
 * @param shouldAttachHeaders 是否需要为请求附加跟踪头部
 * @param spans 当前已经创建的 span 列表
 * @param spanOrigin 用于标记 span 来源的字段，默认是 'auto.http.browser'
 * @returns Span if a span was created, otherwise void.
 */
export function instrumentFetchRequest(
  handlerData: HandlerDataFetch,
  shouldCreateSpan: (url: string) => boolean,
  shouldAttachHeaders: (url: string) => boolean,
  spans: Record<string, Span>,
  spanOrigin: SpanOrigin = 'auto.http.browser',
): Span | undefined {
  // 如果没有 fetch 相关的数据 直接返回
  if (!handlerData.fetchData) {
    return undefined;
  }

  // 是否需要创建 span
  const shouldCreateSpanResult =
    hasTracingEnabled() && shouldCreateSpan(handlerData.fetchData.url);

  // 如果已有 endTimestamp，表明 fetch 请求已经结束，且 需要创建span
  if (handlerData.endTimestamp && shouldCreateSpanResult) {
    // 获取spanId
    const spanId = handlerData.fetchData.__span;
    if (!spanId) return;

    // 检查该请求是否有对应的 span，
    const span = spans[spanId];
    if (span) {
      // 如果有则结束这个span，并从spans 列表中移除它
      endSpan(span, handlerData);

      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete spans[spanId];
    }
    return undefined;
  }

  // 接下来要开始创建 span  这里和 xhr 的逻辑很类似

  // 获取当前作用域
  const scope = getCurrentScope();
  // 获取客户端实例
  const client = getClient();

  // 提取请求方法和请求url
  const { method, url } = handlerData.fetchData;

  // 获取完整的url
  const fullUrl = getFullURL(url);
  // 从完整的url去解析 主机名
  const host = fullUrl ? parseUrl(fullUrl).host : undefined;

  // 获取当前的 span
  const hasParent = !!getActiveSpan();

  const span =
    shouldCreateSpanResult && hasParent
      ? // 创建一个 不活跃的 span
        startInactiveSpan({
          name: `${method} ${url}`,
          attributes: {
            url,
            type: 'fetch',
            'http.method': method,
            'http.url': fullUrl,
            'server.address': host,
            [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: spanOrigin,
            [SEMANTIC_ATTRIBUTE_SENTRY_OP]: 'http.client',
          },
        })
      : new SentryNonRecordingSpan(); // 否则创建一个空的span，它不会不记录任何数据

  // 下面的代码是为 fetch 请求附加链路追踪的 span 信息，并在请求头中加入跟踪信息，以便在 Sentry 中记录请求的相关数据

  // 将 spanId 保存到 fetchData 对象中，这样 fetchData 可以与这个 span 关联起来
  handlerData.fetchData.__span = span.spanContext().spanId;
  // 将当前的 span 以 spanId 为键存储在 spans 对象中，为了在后续需要结束或处理这个 span 时可以快速通过 spanId 访问它
  spans[span.spanContext().spanId] = span;

  // 判断是否需要为请求添加跟踪头部
  if (shouldAttachHeaders(handlerData.fetchData.url) && client) {
    // fetch 请求的第一个参数，通常是 url 或者一个包含请求信息的 Request 对象
    const request: string | Request = handlerData.args[0];

    // fetch 请求的第二个参数是请求的选项，包含诸如请求方法、头部、请求体等信息，如果没有默认 {}
    // 这是为了确保后续能为 headers 添加追踪信息
    handlerData.args[1] = handlerData.args[1] || {};

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // etch 请求的配置对象
    const options: { [key: string]: any } = handlerData.args[1];

    // 将链路追踪的头部信息添加到请求的 headers 中
    options.headers = addTracingHeadersToFetchRequest(
      request,
      client,
      scope,
      options,
      /**
       * 这个注释解释了为什么在某些情况下会传入 undefined 而不是 span
       *
       * - 如果禁用了性能跟踪，则不需要使用 span 来生成追踪头部。
       * - 根 span 是一个大的追踪链中的顶层 span，
       * 通常用于页面加载、导航或交互。如果没有活动的根 span，意味着当前没有合适的父级 span 可以关联
       * - 如果没有父级 span，则追踪头部将基于作用域中的信息生成，而采样决策会在稍后做出
       */
      hasTracingEnabled() && hasParent ? span : undefined,
    );
  }

  return span;
}

/**
 * 这段代码的功能是为 fetch 请求添加 Sentry 的链路追踪头部信息（sentry-trace 和 baggage）
 * 并支持不同的请求头结构
 *
 * @param request fetch 请求的第一个参数，通常是一个 string 或 Request 对象
 * @param client Sentry 客户端实例，用于生成 trace 信息
 * @param scope Sentry 的当前作用域对象，包含了与当前请求相关的上下文信息（例如，traceId 和 spanId
 * @param options 请求的头部信息
 * @param span 当前 span 对象,如果传递了 span，头部会基于该 span 添加；否则会根据 traceId 和其他上下文信息生成
 * @returns
 */
export function addTracingHeadersToFetchRequest(
  // 因为 Request 类型属于 DOM 的类型，Sentry 的库可能不能直接导出这种类型，所以使用了 unknown 替代类型声明。
  request: string | unknown,
  client: Client,
  scope: Scope,
  options: {
    headers?:
      | {
          [key: string]: string[] | string | undefined;
        }
      | PolymorphicRequestHeaders;
  },
  span?: Span,
): PolymorphicRequestHeaders | undefined {
  // 获取隔离作用域
  const isolationScope = getIsolationScope();

  // 从传播上下文信息中提取信息
  /**
   * traceId：唯一标识整个追踪链的 ID
   * spanId：唯一标识该追踪链中的单个 span 的 ID
   * sampled：表示该请求是否被采样（用于性能跟踪）
   * dsc：动态采样上下文，用于在追踪链中传递采样决策信息
   */
  const { traceId, spanId, sampled, dsc } = {
    // 隔离作用域的 传播上下文
    ...isolationScope.getPropagationContext(),
    // 当前作用域的 传播上下文
    ...scope.getPropagationContext(),
  };

  // 生成 Sentry 链路追踪头部
  const sentryTraceHeader = span
    ? // 从这个 span 生成 sentry-trace 头部
      spanToTraceHeader(span)
    : generateSentryTraceHeader(traceId, spanId, sampled);

  // 生成 Sentry baggage 头
  const sentryBaggageHeader = dynamicSamplingContextToSentryBaggageHeader(
    // 如果有 dsc ,则将动态采样上下文（dsc）转换为 baggage 头部
    dsc ||
      (span
        ? // 如果当前有 span，则从 span 中获取动态采样上下文
          getDynamicSamplingContextFromSpan(span)
        : // 从 client 中获取默认的动态采样上下文
          getDynamicSamplingContextFromClient(traceId, client)),
  );

  // 获取头部信息
  const headers =
    options.headers ||
    (typeof Request !== 'undefined' && isInstanceOf(request, Request)
      ? (request as Request).headers
      : undefined);

  if (!headers) {
    return { 'sentry-trace': sentryTraceHeader, baggage: sentryBaggageHeader };
  } else if (typeof Headers !== 'undefined' && isInstanceOf(headers, Headers)) {
    // Headers 对象 是浏览器原生支持的请求头格式
    const newHeaders = new Headers(headers as Headers);
    // 将 sentry-trace 和 baggage 头部添加到请求中

    newHeaders.append('sentry-trace', sentryTraceHeader);

    if (sentryBaggageHeader) {
      // 多次添加,会合并为一个请求头
      newHeaders.append(BAGGAGE_HEADER_NAME, sentryBaggageHeader);
    }

    return newHeaders as PolymorphicRequestHeaders;
  } else if (Array.isArray(headers)) {
    // 某些情况下，头部可能是一个数组，每个数组元素都是键值对
    const newHeaders = [...headers, ['sentry-trace', sentryTraceHeader]];

    if (sentryBaggageHeader) {
      // 如果有多个 baggage 头部，浏览器会合并它们
      // 如果有多个具有相同键的条目，浏览器会将这些值合并到一个请求头中
      newHeaders.push([BAGGAGE_HEADER_NAME, sentryBaggageHeader]);
    }

    return newHeaders as PolymorphicRequestHeaders;
  } else {
    // 普通对象格式的头部

    // 会处理现有的 baggage 头部
    const existingBaggageHeader =
      'baggage' in headers ? headers.baggage : undefined;
    const newBaggageHeaders: string[] = [];

    // 如果 baggage 头部已经存在（无论是字符串还是数组），新头部会与现有的 baggage 信息合并
    if (Array.isArray(existingBaggageHeader)) {
      newBaggageHeaders.push(...existingBaggageHeader);
    } else if (existingBaggageHeader) {
      newBaggageHeaders.push(existingBaggageHeader);
    }

    // 如果 sentryBaggageHeader 存在，它会被加入到 newBaggageHeaders 数组中, 最终将其拼接为一个字符串并返回
    if (sentryBaggageHeader) {
      newBaggageHeaders.push(sentryBaggageHeader);
    }

    return {
      ...(headers as Exclude<typeof headers, Headers>),
      'sentry-trace': sentryTraceHeader,
      baggage:
        newBaggageHeaders.length > 0 ? newBaggageHeaders.join(',') : undefined,
    };
  }
}

function getFullURL(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.href;
  } catch {
    return undefined;
  }
}

/**
 * 用于在 fetch 请求结束时关闭一个 Span,并根据 handlerData 中的响应数据或者错误信息更新 span 的状态
 *
 * @param span 需要结束的追踪 Span,代表这次 fetch 请求的追踪信息
 * @param handlerData 包含了与 fetch 请求相关的上下文数据，包括响应（response）和错误（error）信息。
 */
function endSpan(span: Span, handlerData: HandlerDataFetch): void {
  // 如果存在 response 说明请求已经成功得到了响应
  if (handlerData.response) {
    // 将响应的 HTTP 状态码设置到 span 中（如 200、404 等）设置为 span 的一个属性，用于标记该请求的结果状态
    setHttpStatus(span, handlerData.response.status);

    // 检查响应头部中的 content-length，它表示响应的内容长度
    // 这个长度值通常用于追踪数据传输的大小，帮助了解数据流量
    const contentLength =
      handlerData.response &&
      handlerData.response.headers &&
      handlerData.response.headers.get('content-length');

    // 头部存在且有效，则将其转换为数字头部存在且有效，则将其转换为数字
    if (contentLength) {
      const contentLengthNum = parseInt(contentLength);
      if (contentLengthNum > 0) {
        // 用于监控 HTTP 响应的大小
        span.setAttribute('http.response_content_length', contentLengthNum);
      }
    }
  } else if (handlerData.error) {
    // response 不存在而 error 存在，则说明请求过程中发生了错误
    // 将 span 的状态设置为错误状态并附带错误信息 internal_error，表示内部错误
    span.setStatus({ code: SPAN_STATUS_ERROR, message: 'internal_error' });
  }

  // 无论是成功处理响应还是发生错误，最后都会调用 span.end() 来结束这个 Span
  span.end();
}
