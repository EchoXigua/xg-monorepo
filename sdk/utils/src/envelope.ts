import type {
  Attachment,
  AttachmentItem,
  //   BaseEnvelopeHeaders,
  // BaseEnvelopeItemHeaders,
  DataCategory,
  DsnComponents,
  Envelope,
  EnvelopeItemType,
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
import { normalize } from './normalize';

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
 * 函数主要用于遍历 Envelope 对象中的项目及其类型，并对每个项目执行回调操作
 * 如果回调返回 true，则遍历过程会提前停止
 *
 */
export function forEachEnvelopeItem<E extends Envelope>(
  envelope: Envelope,
  callback: (
    envelopeItem: E[1][number],
    envelopeItemType: E[1][number][0]['type'],
  ) => boolean | void,
): boolean {
  const envelopeItems = envelope[1];

  for (const envelopeItem of envelopeItems) {
    const envelopeItemType = envelopeItem[0].type;
    const result = callback(envelopeItem, envelopeItemType);

    // 如果回调函数返回了 true，表示需要提前终止遍历
    if (result) {
      return true;
    }
  }

  return false;
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

const ITEM_TYPE_TO_DATA_CATEGORY_MAP: Record<EnvelopeItemType, DataCategory> = {
  session: 'session',
  sessions: 'session',
  attachment: 'attachment',
  transaction: 'transaction',
  event: 'error',
  client_report: 'internal',
  user_report: 'default',
  profile: 'profile',
  profile_chunk: 'profile',
  replay_event: 'replay',
  replay_recording: 'replay',
  check_in: 'monitor',
  feedback: 'feedback',
  span: 'span',
  statsd: 'metric_bucket',
};

/**
 * 函数的作用是将 EnvelopeItemType（信封项的类型）映射为 DataCategory（数据类别）
 * 这通常用于对不同类型的数据进行分类处理
 */
export function envelopeItemTypeToDataCategory(
  type: EnvelopeItemType,
): DataCategory {
  return ITEM_TYPE_TO_DATA_CATEGORY_MAP[type];
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

/**
 * Serializes an envelope.
 */
export function serializeEnvelope(envelope: Envelope): string | Uint8Array {
  const [envHeaders, items] = envelope;

  // Initially we construct our envelope as a string and only convert to binary chunks if we encounter binary data
  let parts: string | Uint8Array[] = JSON.stringify(envHeaders);

  function append(next: string | Uint8Array): void {
    if (typeof parts === 'string') {
      parts =
        typeof next === 'string' ? parts + next : [encodeUTF8(parts), next];
    } else {
      parts.push(typeof next === 'string' ? encodeUTF8(next) : next);
    }
  }

  for (const item of items) {
    const [itemHeaders, payload] = item;

    append(`\n${JSON.stringify(itemHeaders)}\n`);

    if (typeof payload === 'string' || payload instanceof Uint8Array) {
      append(payload);
    } else {
      let stringifiedPayload: string;
      try {
        stringifiedPayload = JSON.stringify(payload);
      } catch (e) {
        // In case, despite all our efforts to keep `payload` circular-dependency-free, `JSON.strinify()` still
        // fails, we try again after normalizing it again with infinite normalization depth. This of course has a
        // performance impact but in this case a performance hit is better than throwing.
        stringifiedPayload = JSON.stringify(normalize(payload));
      }
      append(stringifiedPayload);
    }
  }

  return typeof parts === 'string' ? parts : concatBuffers(parts);
}

function concatBuffers(buffers: Uint8Array[]): Uint8Array {
  const totalLength = buffers.reduce((acc, buf) => acc + buf.length, 0);

  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const buffer of buffers) {
    merged.set(buffer, offset);
    offset += buffer.length;
  }

  return merged;
}
