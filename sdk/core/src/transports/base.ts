import type {
  Envelope,
  EnvelopeItem,
  EnvelopeItemType,
  Event,
  EventDropReason,
  EventItem,
  InternalBaseTransportOptions,
  Transport,
  TransportMakeRequestResponse,
  TransportRequestExecutor,
} from '@xigua-monitor/types';
import type { PromiseBuffer, RateLimits } from '@xigua-monitor/utils';
import {
  SentryError,
  createEnvelope,
  envelopeItemTypeToDataCategory,
  forEachEnvelopeItem,
  isRateLimited,
  logger,
  makePromiseBuffer,
  resolvedSyncPromise,
  serializeEnvelope,
  updateRateLimits,
} from '@xigua-monitor/utils';

import { DEBUG_BUILD } from '../debug-build';

export const DEFAULT_TRANSPORT_BUFFER_SIZE = 64;

/**
 * 用于创建 Transport 实例，负责将事件（如错误、异常）从客户端发送到 Sentry 服务器
 * 这个函数的主要任务是处理事件并控制发送过程，包括过滤掉被限流的事件、将事件数据序列化、发送请求并处理响应等
 *
 * @param options 配置选项，控制 Transport 的行为，比如缓冲区大小、记录丢弃事件等
 * @param makeRequest 发送请求的执行函数
 * @param buffer Promise 缓冲区 用于限制并控制并发的请求数量，防止请求堆积过多导致内存问题
 * @returns
 */
export function createTransport(
  options: InternalBaseTransportOptions,
  makeRequest: TransportRequestExecutor,
  buffer: PromiseBuffer<TransportMakeRequestResponse> = makePromiseBuffer(
    options.bufferSize || DEFAULT_TRANSPORT_BUFFER_SIZE,
  ),
): Transport {
  // 用于跟踪当前的限流状态
  let rateLimits: RateLimits = {};
  const flush = (timeout?: number): PromiseLike<boolean> =>
    // 清空缓冲区中的任务
    buffer.drain(timeout);

  /**
   * 用于发送事件数据（以 envelope 形式），并处理限流、网络错误和其他异常
   * @param envelope
   * @returns
   */
  function send(envelope: Envelope): PromiseLike<TransportMakeRequestResponse> {
    const filteredEnvelopeItems: EnvelopeItem[] = [];

    // 遍历信封中的项目，过滤掉被限流的项目
    forEachEnvelopeItem(envelope, (item, type) => {
      const dataCategory = envelopeItemTypeToDataCategory(type);

      // 如果数据类别被限流，丢弃该项
      if (isRateLimited(rateLimits, dataCategory)) {
        const event: Event | undefined = getEventForEnvelopeItem(item, type);
        // 记录丢弃的事件
        options.recordDroppedEvent('ratelimit_backoff', dataCategory, event);
      } else {
        // 否则将项目加入过滤后的列表
        filteredEnvelopeItems.push(item);
      }
    });

    // 如果过滤后信封为空，返回一个已解决的空 Promise
    if (filteredEnvelopeItems.length === 0) {
      return resolvedSyncPromise({});
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // 创建过滤后的信封，只包含未被限流的项目
    const filteredEnvelope: Envelope = createEnvelope(
      envelope[0],
      filteredEnvelopeItems as any,
    );

    // 为信封中的每个项目创建丢失报告
    const recordEnvelopeLoss = (reason: EventDropReason): void => {
      forEachEnvelopeItem(filteredEnvelope, (item, type) => {
        const event: Event | undefined = getEventForEnvelopeItem(item, type);
        options.recordDroppedEvent(
          reason,
          envelopeItemTypeToDataCategory(type),
          event,
        );
      });
    };

    // 发送请求的核心函数
    const requestTask = (): PromiseLike<TransportMakeRequestResponse> =>
      // 将过滤后的信封序列化为 HTTP 请求的 body
      makeRequest({ body: serializeEnvelope(filteredEnvelope) }).then(
        (response) => {
          // 成功的回调

          // 处理 Sentry 服务器的响应
          // We don't want to throw on NOK responses, but we want to at least log them
          if (
            response.statusCode !== undefined &&
            (response.statusCode < 200 || response.statusCode >= 300)
          ) {
            DEBUG_BUILD &&
              logger.warn(
                `Sentry responded with status code ${response.statusCode} to sent event.`,
              );
          }

          // 根据响应更新限流状态
          rateLimits = updateRateLimits(rateLimits, response);
          return response;
        },
        (error) => {
          // 失败的回调

          // 网络错误，记录丢失的事件
          recordEnvelopeLoss('network_error');
          throw error;
        },
      );

    // 将任务添加到缓冲区
    return buffer.add(requestTask).then(
      (result) => result,
      (error) => {
        // 如果缓冲区满了，会抛出 SentryError
        if (error instanceof SentryError) {
          DEBUG_BUILD &&
            logger.error('Skipped sending event because buffer is full.');

          // 记录队列溢出丢失事件
          recordEnvelopeLoss('queue_overflow');
          return resolvedSyncPromise({});
        } else {
          throw error;
        }
      },
    );
  }

  return {
    send,
    flush,
  };
}

function getEventForEnvelopeItem(
  item: Envelope[1][number],
  type: EnvelopeItemType,
): Event | undefined {
  if (type !== 'event' && type !== 'transaction') {
    return undefined;
  }

  return Array.isArray(item) ? (item as EventItem)[1] : undefined;
}
