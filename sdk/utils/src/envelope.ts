import type {
  Attachment,
  AttachmentItem,
  //   BaseEnvelopeHeaders,
  // BaseEnvelopeItemHeaders,
  //   DataCategory,
  DsnComponents,
  Envelope,
  //   EnvelopeItemType,
  Event,
  EventEnvelopeHeaders,
  SdkInfo,
  SdkMetadata,
  SpanItem,
  SpanJSON,
} from '@xigua-monitor/types';
import { dropUndefinedKeys } from './object';
import { GLOBAL_OBJ } from './worldwide';
import { dsnToString } from './dsn';

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
 * 向信封中添加一个项目
 * 确保始终显式地为该函数提供泛型，以便正确解析信封类型
 */
export function addItemToEnvelope<E extends Envelope>(
  envelope: E,
  newItem: E[1][number],
): E {
  const [headers, items] = envelope;
  return [headers, [...items, newItem]] as unknown as E;
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

/**
 * Creates attachment envelope items
 */
export function createAttachmentEnvelopeItem(
  attachment: Attachment,
): AttachmentItem {
  const buffer =
    typeof attachment.data === 'string'
      ? encodeUTF8(attachment.data)
      : attachment.data;

  return [
    dropUndefinedKeys({
      type: 'attachment',
      length: buffer.length,
      filename: attachment.filename,
      content_type: attachment.contentType,
      attachment_type: attachment.attachmentType,
    }),
    buffer,
  ];
}

/**
 * Encode a string to UTF8 array.
 */
function encodeUTF8(input: string): Uint8Array {
  return GLOBAL_OBJ.__SENTRY__ && GLOBAL_OBJ.__SENTRY__.encodePolyfill
    ? GLOBAL_OBJ.__SENTRY__.encodePolyfill(input)
    : new TextEncoder().encode(input);
}

/**
 * Creates event envelope headers, based on event, sdk info and tunnel
 * Note: This function was extracted from the core package to make it available in Replay
 */
export function createEventEnvelopeHeaders(
  event: Event,
  sdkInfo: SdkInfo | undefined,
  tunnel: string | undefined,
  dsn?: DsnComponents,
): EventEnvelopeHeaders {
  const dynamicSamplingContext =
    event.sdkProcessingMetadata &&
    event.sdkProcessingMetadata.dynamicSamplingContext;
  return {
    event_id: event.event_id as string,
    sent_at: new Date().toISOString(),
    ...(sdkInfo && { sdk: sdkInfo }),
    ...(!!tunnel && dsn && { dsn: dsnToString(dsn) }),
    ...(dynamicSamplingContext && {
      trace: dropUndefinedKeys({ ...dynamicSamplingContext }),
    }),
  };
}

/** Extracts the minimal SDK info from the metadata or an events */
export function getSdkMetadataForEnvelopeHeader(
  metadataOrEvent?: SdkMetadata | Event,
): SdkInfo | undefined {
  if (!metadataOrEvent || !metadataOrEvent.sdk) {
    return;
  }
  const { name, version } = metadataOrEvent.sdk;
  return { name, version };
}
