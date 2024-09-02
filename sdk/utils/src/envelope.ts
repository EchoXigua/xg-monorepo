import type {
  //   Attachment,
  //   AttachmentItem,
  //   BaseEnvelopeHeaders,
  //   BaseEnvelopeItemHeaders,
  //   DataCategory,
  //   DsnComponents,
  Envelope,
  //   EnvelopeItemType,
  Event,
  //   EventEnvelopeHeaders,
  SdkInfo,
  //   SdkMetadata,
  SpanItem,
  SpanJSON,
} from '@xigua-monitor/types';

/**
 * 这个函数用于创建一个通用的信封 (Envelope) 对象。
 *
 * 信封通常由头部 (headers) 和一系列项目 (items) 组成。头部包含一些元数据，而项目则是信封的主要内容。
 *
 * @param headers
 * @param items
 * @returns 返回一个信封，它是一个包含头部和项目的元组
 */
export function createEnvelope<E extends Envelope>(
  headers: E[0],
  items: E[1] = [],
): E {
  return [headers, items] as E;
}

/**
 * 该函数用于创建一个 Span 的信封项目 (Envelope Item)，即将一个 Span 的 JSON 数据封装成信封项目格式。
 */
export function createSpanEnvelopeItem(spanJson: Partial<SpanJSON>): SpanItem {
  const spanHeaders: SpanItem[0] = {
    type: 'span',
  };

  return [spanHeaders, spanJson];
}
