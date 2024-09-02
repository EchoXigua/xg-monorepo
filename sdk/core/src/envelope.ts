import type {
  Client,
  DsnComponents,
  DynamicSamplingContext,
  Event,
  //   EventEnvelope,
  //   EventItem,
  //   SdkInfo,
  //   SdkMetadata,
  //   Session,
  //   SessionAggregates,
  //   SessionEnvelope,
  //   SessionItem,
  SpanEnvelope,
  SpanItem,
  SpanJSON,
} from '@xigua-monitor/types';

import {
  createEnvelope,
  // createEventEnvelopeHeaders,
  createSpanEnvelopeItem,
  dsnToString,
  // getSdkMetadataForEnvelopeHeader,
} from '@xigua-monitor/utils';
import type { SentrySpan } from './tracing/sentrySpan';
import { getDynamicSamplingContextFromSpan } from './tracing/dynamicSamplingContext';
import { spanToJSON } from './utils/spanUtils';

/**
 * 这个函数，用于从 Span 对象数组中创建一个 Envelope（信封），用于封装和发送 Span 数据。
 * 这是 Sentry 用于打包事件和追踪数据的一种结构化数据格式。
 *
 * 在生成信封的过程中，函数会对 Span 进行处理，
 * 比如获取动态采样上下文（DSC）和运行客户端配置的 beforeSendSpan 钩子函数（如果存在）
 *
 * @param spans 一个包含至少一个 Span 对象的数组
 * @param client 客户端对象，用于访问配置信息和钩子函数
 * @returns
 */
export function createSpanEnvelope(
  spans: [SentrySpan, ...SentrySpan[]],
  client?: Client,
): SpanEnvelope {
  // 这是一个类型守卫函数，用于检查动态采样上下文 dsc 是否包含必要的属性 trace_id 和 public_key
  function dscHasRequiredProps(
    dsc: Partial<DynamicSamplingContext>,
  ): dsc is DynamicSamplingContext {
    return !!dsc.trace_id && !!dsc.public_key;
  }

  // For the moment we'll obtain the DSC from the first span in the array
  // This might need to be changed if we permit sending multiple spans from
  // different segments in one envelope
  // 从第一个 Span 中提取动态采样上下文 dsc。
  // 这里假设所有 Span 都属于同一条追踪链，因此使用第一个 Span 的上下文即可。
  const dsc = getDynamicSamplingContextFromSpan(spans[0]);

  // 从客户端中获取 DSN（Data Source Name）和 Tunnel（隧道）配置。这些信息可能会用于信封的头部。
  const dsn = client && client.getDsn();
  const tunnel = client && client.getOptions().tunnel;

  // 构建信封头部
  const headers: SpanEnvelope[0] = {
    // 时间戳
    sent_at: new Date().toISOString(),
    // dsc 包含必要的属性,则会多一个 trace 属性
    ...(dscHasRequiredProps(dsc) && { trace: dsc }),
    // 存在 dsn 且启用了隧道,则多一个 dsn 属性
    ...(!!tunnel && dsn && { dsn: dsnToString(dsn) }),
  };

  // 检查客户端是否配置了 beforeSendSpan 钩子函数
  const beforeSendSpan = client && client.getOptions().beforeSendSpan;

  // 配置了将 Span 转换为 JSON 时会调用该函数进行预处理。否则，直接将 Span 转换为 JSON
  const convertToSpanJSON = beforeSendSpan
    ? (span: SentrySpan) => beforeSendSpan(spanToJSON(span) as SpanJSON)
    : (span: SentrySpan) => spanToJSON(span);

  const items: SpanItem[] = [];
  // 遍历 spans 数组，将每个 Span 对象转换为 JSON，
  for (const span of spans) {
    const spanJson = convertToSpanJSON(span);
    if (spanJson) {
      // 将其封装为信封项目 SpanItem。这些项目最终会被添加到 items 数组中。
      items.push(createSpanEnvelopeItem(spanJson));
    }
  }

  // 用头部 headers 和项目数组 items 创建并返回最终的 SpanEnvelope
  return createEnvelope<SpanEnvelope>(headers, items);

  // 这个函数主要用于打包和发送 Span 数据。
  // 在此过程中，它会处理 Span 对象的转换、钩子函数的调用以及信封的构建。
  // 信封 SpanEnvelope 包含了 Span 数据的 JSON 表现形式，可以用于进一步的传输或存储。
}
