import { EventType } from '@xigua-monitor/rrweb';
import { getClient } from '@xigua-monitor/core';

import { DEBUG_BUILD } from '../debug-build';
import { EventBufferSizeExceededError } from '../eventBuffer/error';
import type {
  AddEventResult,
  RecordingEvent,
  ReplayContainer,
  ReplayFrameEvent,
  ReplayPluginOptions,
} from '../types';
import { logger } from './logger';
import { timestampToMs } from './timestamp';

function isCustomEvent(event: RecordingEvent): event is ReplayFrameEvent {
  return event.type === EventType.Custom;
}

/**
 * addEventSync 不返回 Promise，也不会等待事件添加操作的成功或失败。
 * 它是同步操作，立即返回布尔值，指示是否尝试添加了事件。相比之下，addEvent 是异步的，返回 Promise。
 *
 * `isCheckout` is true if this is either the very first event, or an event triggered by `checkoutEveryNms`.
 */
export function addEventSync(
  replay: ReplayContainer,
  event: RecordingEvent,
  isCheckout?: boolean,
): boolean {
  if (!shouldAddEvent(replay, event)) {
    return false;
  }

  // This should never reject
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  _addEvent(replay, event, isCheckout);

  return true;
}

/**
 *  函数的主要功能是根据判断条件决定是否将事件加入事件缓冲区
 *
 * `isCheckout` is true if this is either the very first event, or an event triggered by `checkoutEveryNms`.
 */
export function addEvent(
  replay: ReplayContainer,
  event: RecordingEvent,
  isCheckout?: boolean,
): Promise<AddEventResult | null> {
  // 判断该事件是否应该被添加
  if (!shouldAddEvent(replay, event)) {
    // 不符合直接返回 null
    return Promise.resolve(null);
  }

  // 将事件添加到缓冲区
  return _addEvent(replay, event, isCheckout);
}

/**
 * 实际将事件添加到缓冲区中的函数，主要处理事件缓冲区的清理、事件的回调以及异常处理
 *
 * @param replay
 * @param event
 * @param isCheckout
 * @returns
 */
async function _addEvent(
  replay: ReplayContainer,
  event: RecordingEvent,
  isCheckout?: boolean,
): Promise<AddEventResult | null> {
  // 如果缓冲区不存在，直接返回
  if (!replay.eventBuffer) {
    return null;
  }

  try {
    // isCheckout 表示当前事件是否是一个 "checkout" 事件（即初始事件或定期的 checkout）。

    // 如果当前录制模式为 buffer，且事件是 checkout 类型，缓冲区会被清空，确保缓冲区只保存最新的 60 秒数据
    if (isCheckout && replay.recordingMode === 'buffer') {
      replay.eventBuffer.clear();
    }

    // 标记 eventBuffer 中是否已有 checkout 事件
    if (isCheckout) {
      replay.eventBuffer.hasCheckout = true;
    }

    const replayOptions = replay.getOptions();

    const eventAfterPossibleCallback = maybeApplyCallback(
      event,
      replayOptions.beforeAddRecordingEvent,
    );

    // 这里返回null（报错了） 直接返回，不会将事件添加到缓冲区
    if (!eventAfterPossibleCallback) {
      return;
    }

    return await replay.eventBuffer.addEvent(eventAfterPossibleCallback);
  } catch (error) {
    // 如果在添加事件时发生了错误（如事件大小超出了缓冲区限制），将捕获异常并处理
    const reason =
      error && error instanceof EventBufferSizeExceededError
        ? 'addEventSizeExceeded'
        : 'addEvent';
    replay.handleException(error);

    // 如果发生错误，Replay 功能会停止，并传递错误原因
    await replay.stop({ reason });

    const client = getClient();

    // 客户端存在，则记录事件丢失信息，这对于后续的调试或数据分析很有帮助
    if (client) {
      client.recordDroppedEvent('internal_sdk_error', 'replay');
    }
  }
}

/** Exported only for tests. */
export function shouldAddEvent(
  replay: ReplayContainer,
  event: RecordingEvent,
): boolean {
  // 不存在缓冲区或者回放暂停、未启用，直接返回false
  if (!replay.eventBuffer || replay.isPaused() || !replay.isEnabled()) {
    return false;
  }

  // 将事件的时间戳转换为毫秒单位
  const timestampInMs = timestampToMs(event.timestamp);

  // performance.timeOrigin，这是页面第一次打开的时间
  /**
   * 防止添加那些发生在页面长时间闲置后的过时事件。通过比较事件的时间戳和当前时间，
   * 如果事件超过了 sessionIdlePause 设定的5分钟（通过 SESSION_IDLE_PAUSE_DURATION 控制），
   * 那么这个事件将被丢弃
   */
  if (timestampInMs + replay.timeouts.sessionIdlePause < Date.now()) {
    return false;
  }

  // 丢弃那些发生在初始时间戳60分钟之后的事件。
  // 这是为了控制重播的最大时长 (maxReplayDuration)，避免录制时间过长而浪费资源
  if (
    timestampInMs >
    replay.getContext().initialTimestamp + replay.getOptions().maxReplayDuration
  ) {
    DEBUG_BUILD &&
      logger.infoTick(
        `Skipping event with timestamp ${timestampInMs} because it is after maxReplayDuration`,
      );
    return false;
  }

  // 通过所有检查后表示这个事件是有效的，应该添加到 eventBuffer 中
  return true;
}

/**
 * 是检查是否应该应用一个用户定义的回调函数，并处理可能的异常情况
 * @param event
 * @param callback
 * @returns
 */
function maybeApplyCallback(
  event: RecordingEvent,
  callback: ReplayPluginOptions['beforeAddRecordingEvent'],
): RecordingEvent | null | undefined {
  try {
    // 让用户在事件进入缓冲区之前，可以通过回调函数对事件进行修改、过滤或者其他操作
    if (typeof callback === 'function' && isCustomEvent(event)) {
      return callback(event);
    }
  } catch (error) {
    DEBUG_BUILD &&
      logger.exception(
        error,
        'An error occured in the `beforeAddRecordingEvent` callback, skipping the event...',
      );
    return null;
  }

  // 如果没有定义回调函数，或者事件不符合自定义事件的条件，代码将直接返回原始事件，继续正常流程
  return event;
}
