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
 * 将一个字符串编码为 UTF-8 格式的 Uint8Array（二进制数组）
 */
function encodeUTF8(input: string): Uint8Array {
  // encodePolyfill 可能是为了兼容不支持原生 TextEncoder 的环境
  return GLOBAL_OBJ.__SENTRY__ && GLOBAL_OBJ.__SENTRY__.encodePolyfill
    ? GLOBAL_OBJ.__SENTRY__.encodePolyfill(input)
    : // 没有则使用原生的进行编码
      new TextEncoder().encode(input);
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
 * 函数用于序列化一个 Envelope 对象，将其转换为字符串或二进制数据
 * 目的是将 envelope 中的头信息和每个 item 的数据序列化，以便通过网络传输或存储
 */
export function serializeEnvelope(envelope: Envelope): string | Uint8Array {
  /**
   * Envelope 的结构可以理解为 [headers, items]
   * items 是多个 [itemHeaders, payload]的数组
   */
  const [envHeaders, items] = envelope;

  // 最初将头部信息序列化为字符串，在后续处理 item 时遇到 二进制数据，会将 parts 转为 二进制数组存储
  // Uint8Array 用于表示二进制数据的一种类型，是无符号的 8 位整型数组，也就是每个元素的取值范围为 0 到 255
  let parts: string | Uint8Array[] = JSON.stringify(envHeaders);

  /**
   * 函数负责将新的字符串或二进制数据（next）附加到 parts
   * @param next
   */
  function append(next: string | Uint8Array): void {
    if (typeof parts === 'string') {
      // parts 仍然为字符串
      parts =
        // 检查传入的是否为字符串，如果是直接拼接，否则为二进制数据，将parts 转为二进制，将在传入的添加进去
        typeof next === 'string' ? parts + next : [encodeUTF8(parts), next];
    } else {
      // parts 为二进制，传入的为字符串则转为二进制，否则直接加入到二进制数组尾部
      parts.push(typeof next === 'string' ? encodeUTF8(next) : next);
    }
  }

  // 遍历所有item
  for (const item of items) {
    const [itemHeaders, payload] = item;

    // 将item 的头部信息序列化后添加到 parts 中
    append(`\n${JSON.stringify(itemHeaders)}\n`);

    if (typeof payload === 'string' || payload instanceof Uint8Array) {
      // 如果直接是字符串或者二进制数据，直接将负载添加到 parts 中
      append(payload);
    } else {
      // 其他类型，比如对象
      let stringifiedPayload: string;
      try {
        // 尝试序列化为对象
        stringifiedPayload = JSON.stringify(payload);
      } catch (e) {
        /**
         * 1. 循环引用问题：当对象内部存在循环引用时，JSON.stringify() 无法正确处理，因为它无法终止对对象的递归遍历
         *
         * 2. 无限深度规范化：通过一种递归的方式解决这个问题，将对象中的循环引用移除或替换，以避免 JSON.stringify() 抛出错误。
         * 虽然这种方式解决了序列化问题，但会增加性能开销
         *
         * 3. 权衡：虽然这种解决方案会影响程序性能（特别是处理复杂对象时），但相比直接让程序抛出异常停止运行，
         * 这种方式让程序能够继续工作，哪怕有性能损失，也被认为是更好的选择
         */
        // 如果出错则先将负载标准化处理后在序列化
        stringifiedPayload = JSON.stringify(normalize(payload));
      }
      // 将处理好的负载添加到 parts 中
      append(stringifiedPayload);
    }
  }

  // 如果parts 仍然是字符串，直接返回，否则将数组中的二进制数据合并成一个完整的 Uint8Array 并返回
  return typeof parts === 'string' ? parts : concatBuffers(parts);
}

/**
 * 函数的作用是将多个 Uint8Array（即二进制数组）合并为一个新的 Uint8Array，并返回这个合并后的数组。
 * 这个函数特别适用于处理多个二进制数据块，将它们连接成一个完整的数组
 *
 * @param buffers
 * @returns
 */
function concatBuffers(buffers: Uint8Array[]): Uint8Array {
  // 计算所有 buffer 的总长度
  const totalLength = buffers.reduce((acc, buf) => acc + buf.length, 0);

  // 创建一个新的 Uint8Array，它的长度等于所有 Uint8Array 数组的长度之和，用来存放合并后的数据
  const merged = new Uint8Array(totalLength);

  // 用于记录当前写入的位置偏移量
  let offset = 0;

  // 遍历所有传入的 buffer，将它们依次复制到 merged 数组中
  for (const buffer of buffers) {
    // set 方法可以用来将一个 Uint8Array 的数据拷贝到另一个 Uint8Array 中
    merged.set(buffer, offset);
    offset += buffer.length;
  }

  return merged;
}
