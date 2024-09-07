import type {
  Event,
  Exception,
  IntegrationFn,
  StackFrame,
} from '@xigua-monitor/types';
import { getFramesFromEvent, logger } from '@xigua-monitor/utils';

import { defineIntegration } from '../integration';
import { DEBUG_BUILD } from '../debug-build';

const INTEGRATION_NAME = 'Dedupe';

const _dedupeIntegration = (() => {
  // 该集成使用一个内部变量 previousEvent 来存储上一个捕获的事件
  let previousEvent: Event | undefined;

  return {
    name: INTEGRATION_NAME,
    processEvent(currentEvent) {
      // We want to ignore any non-error type events, e.g. transactions or replays
      // These should never be deduped, and also not be compared against as _previousEvent.
      // 首先检查它的类型。如果事件是非错误类型（如事务或重放），则直接返回该事件，而不进行去重
      if (currentEvent.type) {
        return currentEvent;
      }

      // Juuust in case something goes wrong
      try {
        // 判断当前事件是否与先前的事件相同
        if (_shouldDropEvent(currentEvent, previousEvent)) {
          DEBUG_BUILD &&
            logger.warn(
              'Event dropped due to being a duplicate of previously captured event.',
            );
          // 如果是重复事件，则返回 null，表示不再捕获这个事件，并且会在开发环境下记录一条警告日志
          return null;
        }
      } catch (_oO) {} // eslint-disable-line no-empty

      // 如果当前事件不是重复的，则将其保存为 previousEvent，以便将来比较
      return (previousEvent = currentEvent);
    },
  };
}) satisfies IntegrationFn;

/**
 * 用于事件去重的集成，它的目的是确保在捕获错误事件时，避免重复捕获相同的错误。
 * 事件去重的好处:
 * - 减少噪音: 去重可以减少重复事件对日志的干扰，使得错误监控更加清晰有效
 * - 提高性能: 避免捕获重复事件可以减轻后端存储的负担，节省带宽和存储成本
 * - 更好的用户体验: 用户只会收到新的错误通知，而不会被重复的错误信息所困扰
 */
export const dedupeIntegration = defineIntegration(_dedupeIntegration);

/**
 * 检查当前事件是否应该被丢弃
 */
export function _shouldDropEvent(
  currentEvent: Event,
  previousEvent?: Event,
): boolean {
  // 如果没有 previousEvent，则返回 false，表示当前事件不应被丢弃
  // 这说明是第一个事件
  if (!previousEvent) {
    return false;
  }

  // _isSameMessageEvent 和 _isSameExceptionEvent 来检查两个事件是否是相同的

  if (_isSameMessageEvent(currentEvent, previousEvent)) {
    return true;
  }

  if (_isSameExceptionEvent(currentEvent, previousEvent)) {
    return true;
  }

  return false;
}

/**
 * 比较两个事件的消息属性
 * @param currentEvent
 * @param previousEvent
 * @returns
 */
function _isSameMessageEvent(
  currentEvent: Event,
  previousEvent: Event,
): boolean {
  const currentMessage = currentEvent.message;
  const previousMessage = previousEvent.message;

  // 检查当前和之前的事件是否都有消息，如果两个事件都没有消息，则返回 false
  if (!currentMessage && !previousMessage) {
    return false;
  }

  // 如果有一个消息不存在，返回false
  if (
    (currentMessage && !previousMessage) ||
    (!currentMessage && previousMessage)
  ) {
    return false;
  }

  // 检查消息是否相同，若不相同则返回 false
  if (currentMessage !== previousMessage) {
    return false;
  }

  // 检查两个事件的指纹和栈跟踪是否相同，如果任何一个不相同，则返回 false
  if (!_isSameFingerprint(currentEvent, previousEvent)) {
    return false;
  }

  if (!_isSameStacktrace(currentEvent, previousEvent)) {
    return false;
  }

  return true;
}

/**
 * 比较两个事件的异常信息
 * @param currentEvent
 * @param previousEvent
 * @returns
 */
function _isSameExceptionEvent(
  currentEvent: Event,
  previousEvent: Event,
): boolean {
  // 提取当前和之前事件的异常信息
  const previousException = _getExceptionFromEvent(previousEvent);
  const currentException = _getExceptionFromEvent(currentEvent);

  // 如果任何一个没有异常，则返回 false
  if (!previousException || !currentException) {
    return false;
  }

  // 检查异常的类型和值是否相同，若不相同则返回 false
  if (
    previousException.type !== currentException.type ||
    previousException.value !== currentException.value
  ) {
    return false;
  }

  // 同样地，检查指纹和栈跟踪
  if (!_isSameFingerprint(currentEvent, previousEvent)) {
    return false;
  }

  if (!_isSameStacktrace(currentEvent, previousEvent)) {
    return false;
  }

  return true;
}

/**
 * 比较两个事件的栈跟踪信息
 * @param currentEvent
 * @param previousEvent
 * @returns
 */
function _isSameStacktrace(currentEvent: Event, previousEvent: Event): boolean {
  // 提取当前和之前事件的栈帧
  let currentFrames = getFramesFromEvent(currentEvent);
  let previousFrames = getFramesFromEvent(previousEvent);

  // 如果两个都没有，返回 true
  if (!currentFrames && !previousFrames) {
    return true;
  }

  // 如果只有一个有栈帧，返回 false
  if (
    (currentFrames && !previousFrames) ||
    (!currentFrames && previousFrames)
  ) {
    return false;
  }

  currentFrames = currentFrames as StackFrame[];
  previousFrames = previousFrames as StackFrame[];

  // 如果栈帧的数量不同，返回 false
  if (previousFrames.length !== currentFrames.length) {
    return false;
  }

  // 逐帧比较每个栈帧的文件名、行号、列号和函数名，如果任何一个不相同，则返回 false。
  for (let i = 0; i < previousFrames.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const frameA = previousFrames[i]!;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const frameB = currentFrames[i]!;

    if (
      frameA.filename !== frameB.filename ||
      frameA.lineno !== frameB.lineno ||
      frameA.colno !== frameB.colno ||
      frameA.function !== frameB.function
    ) {
      return false;
    }
  }

  return true;
}

/**
 * 比较两个事件的指纹
 * @param currentEvent
 * @param previousEvent
 * @returns
 */
function _isSameFingerprint(
  currentEvent: Event,
  previousEvent: Event,
): boolean {
  let currentFingerprint = currentEvent.fingerprint;
  let previousFingerprint = previousEvent.fingerprint;

  // 检查指纹是否都存在，如果都不存在，返回 true。
  if (!currentFingerprint && !previousFingerprint) {
    return true;
  }

  // 检查是否只有一个事件有指纹，如果是，返回 false。
  if (
    (currentFingerprint && !previousFingerprint) ||
    (!currentFingerprint && previousFingerprint)
  ) {
    return false;
  }

  currentFingerprint = currentFingerprint as string[];
  previousFingerprint = previousFingerprint as string[];

  // 将指纹数组转换为字符串并比较，如果相同返回 true，否则返回 false
  try {
    return !!(currentFingerprint.join('') === previousFingerprint.join(''));
  } catch (_oO) {
    return false;
  }
}

/**
 * 从事件中提取异常信息
 * @param event
 * @returns
 */
function _getExceptionFromEvent(event: Event): Exception | undefined {
  // 检查事件是否有异常信息，如果有，则返回第一个异常值
  return event.exception && event.exception.values && event.exception.values[0];
}
