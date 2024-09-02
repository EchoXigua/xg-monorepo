import type { Event, IntegrationFn, StackFrame } from '@xigua-monitor/types';
import {
  getEventDescription,
  logger,
  stringMatchesSomePattern,
} from '@xigua-monitor/utils';

import { DEBUG_BUILD } from '../debug-build';
import { defineIntegration } from '../integration';

/**
 * 包含常见错误模式的数组，通常用于过滤掉不必要或无意义的错误报告
 * 这些错误通常是由浏览器、第三方脚本或其他不可控的外部因素引起的，对用户体验或应用程序的实际运行没有影响，因此可以安全地忽略。
 */
const DEFAULT_IGNORE_ERRORS = [
  // 当浏览器从不同源加载的脚本发生错误且没有正确配置 CORS 时，
  // 浏览器会返回 "Script error."。这是一个常见的、不可操作的错误。
  /^Script error\.?$/,
  // 浏览器在无法读取外部脚本错误时返回的错误消息
  /^Javascript error: Script error\.? on line 0$/,
  // 在处理回调时花费的时间稍长时，浏览器会记录这个错误。通常它并不影响用户体验，是个无关紧要的警告。
  /^ResizeObserver loop completed with undelivered notifications.$/,

  // 这个错误通常在使用 Google Tag Manager 并且与广告拦截器结合时发生。这个错误在大多数情况下不会影响应用程序的正常运行。
  /^Cannot redefine property: googletag$/,
  // 这是一个随机发生的错误，通常是由不相关的脚本或扩展引起的，对最终用户没有可见的影响
  "undefined is not an object (evaluating 'a.L')",
  // 这个错误很可能是由于浏览器扩展或定制浏览器（例如 Brave）导致的，对应用程序的核心功能无影响
  'can\'t redefine non-configurable property "solana"',
  // 由 Google Tag Manager 抛出的错误，似乎对终端用户无影响，通常可以忽略。
  "vv().getRestrictions is not a function. (In 'vv().getRestrictions(1,a)', 'vv().getRestrictions' is undefined)",
  // 这是在 Instagram webview 中的一个无法操作的错误，通常不需要关注。
  "Can't find variable: _AutofillCallbackHandler", // Unactionable error in instagram webview https://developers.facebook.com/community/threads/320013549791141/
];

/** Options for the InboundFilters integration */
export interface InboundFiltersOptions {
  allowUrls: Array<string | RegExp>;
  denyUrls: Array<string | RegExp>;
  ignoreErrors: Array<string | RegExp>;
  ignoreTransactions: Array<string | RegExp>;
  ignoreInternal: boolean;
  disableErrorDefaults: boolean;
}

const INTEGRATION_NAME = 'InboundFilters';
const _inboundFiltersIntegration = ((
  options: Partial<InboundFiltersOptions> = {},
) => {
  return {
    name: INTEGRATION_NAME,
    /**
     * 这是一个处理事件的函数
     *
     * @param event 表示当前正在处理的事件
     * @param _hint  用于提供额外信息的提示
     * @param client 当前 SDK 客户端的实例
     * @returns
     */
    processEvent(event, _hint, client) {
      const clientOptions = client.getOptions();
      // 将传入的 options 和客户端的选项进行合并，得到最终的配置。
      const mergedOptions = _mergeOptions(options, clientOptions);
      // 判断是否应该丢弃这个事件
      return _shouldDropEvent(event, mergedOptions) ? null : event;
    },
  };
}) satisfies IntegrationFn;

/**
 * 用于处理事件过滤逻辑。其主要作用是在事件处理流程中，根据某些条件决定是否丢弃事件
 */
export const inboundFiltersIntegration = defineIntegration(
  _inboundFiltersIntegration,
);

/**
 * 函数的作用是将内部选项（internalOptions）和客户端选项（clientOptions）合并为一个单一的配置对象
 * @param internalOptions
 * @param clientOptions
 * @returns
 */
function _mergeOptions(
  internalOptions: Partial<InboundFiltersOptions> = {},
  clientOptions: Partial<InboundFiltersOptions> = {},
): Partial<InboundFiltersOptions> {
  return {
    // 用于指定哪些 URL 的事件应被处理
    allowUrls: [
      ...(internalOptions.allowUrls || []),
      ...(clientOptions.allowUrls || []),
    ],
    // 用于指定哪些 URL 的事件应被忽略
    denyUrls: [
      ...(internalOptions.denyUrls || []),
      ...(clientOptions.denyUrls || []),
    ],
    // 用于定义哪些错误信息应被忽略，不予上报
    ignoreErrors: [
      ...(internalOptions.ignoreErrors || []),
      ...(clientOptions.ignoreErrors || []),
      ...(internalOptions.disableErrorDefaults ? [] : DEFAULT_IGNORE_ERRORS),
    ],
    // 用于指定哪些事务应被忽略
    ignoreTransactions: [
      ...(internalOptions.ignoreTransactions || []),
      ...(clientOptions.ignoreTransactions || []),
    ],
    // 常用于忽略 SDK 内部生成的错误或事件
    // 确保 SDK 不会上报自身的错误或其他内部生成的事件，这对于保持报告的纯净性非常重要。
    ignoreInternal:
      internalOptions.ignoreInternal !== undefined
        ? internalOptions.ignoreInternal
        : true,
  };
}

/**
 * 用于根据传入的 options（过滤选项）判断是否应该丢弃某个 event（事件）
 * 它通过一系列检查，确定该事件是否符合过滤条件，从而决定是否丢弃。
 *
 * @param event
 * @param options
 * @returns
 */
function _shouldDropEvent(
  event: Event,
  options: Partial<InboundFiltersOptions>,
): boolean {
  // 事件是否是 Sentry 内部错误
  if (options.ignoreInternal && _isSentryError(event)) {
    DEBUG_BUILD &&
      logger.warn(
        `Event dropped due to being internal Sentry Error.\nEvent: ${getEventDescription(event)}`,
      );
    return true;
  }

  if (_isIgnoredError(event, options.ignoreErrors)) {
    DEBUG_BUILD &&
      logger.warn(
        `Event dropped due to being matched by \`ignoreErrors\` option.\nEvent: ${getEventDescription(event)}`,
      );
    return true;
  }

  // 检查事件是否是无用的错误，例如没有错误信息、类型或堆栈跟踪,如果事件无效，则丢弃事件
  if (_isUselessError(event)) {
    DEBUG_BUILD &&
      logger.warn(
        `Event dropped due to not having an error message, error type or stacktrace.\nEvent: ${getEventDescription(
          event,
        )}`,
      );
    return true;
  }
  if (_isIgnoredTransaction(event, options.ignoreTransactions)) {
    DEBUG_BUILD &&
      logger.warn(
        `Event dropped due to being matched by \`ignoreTransactions\` option.\nEvent: ${getEventDescription(event)}`,
      );
    return true;
  }
  if (_isDeniedUrl(event, options.denyUrls)) {
    DEBUG_BUILD &&
      logger.warn(
        `Event dropped due to being matched by \`denyUrls\` option.\nEvent: ${getEventDescription(
          event,
        )}.\nUrl: ${_getEventFilterUrl(event)}`,
      );
    return true;
  }
  if (!_isAllowedUrl(event, options.allowUrls)) {
    DEBUG_BUILD &&
      logger.warn(
        `Event dropped due to not being matched by \`allowUrls\` option.\nEvent: ${getEventDescription(
          event,
        )}.\nUrl: ${_getEventFilterUrl(event)}`,
      );
    return true;
  }
  return false;
}

/**
 * 检查事件的错误信息是否应被忽略
 *
 * @param event
 * @param ignoreErrors
 * @returns
 */
function _isIgnoredError(
  event: Event,
  ignoreErrors?: Array<string | RegExp>,
): boolean {
  // 如果事件有 type，则不是一个错误事件，直接返回 false
  if (event.type || !ignoreErrors || !ignoreErrors.length) {
    return false;
  }

  // _getPossibleEventMessages 获取事件的所有可能的错误信息
  // 逐一与 ignoreErrors 列表中的模式进行匹配。如果匹配成功，返回 true，否则返回 false
  return _getPossibleEventMessages(event).some((message) =>
    stringMatchesSomePattern(message, ignoreErrors),
  );
}

/**
 * 检查事件是否是需要忽略的事务
 *
 * @param event
 * @param ignoreTransactions
 * @returns
 */
function _isIgnoredTransaction(
  event: Event,
  ignoreTransactions?: Array<string | RegExp>,
): boolean {
  if (
    // 如果事件不是事务类型或者 ignoreTransactions 未定义或为空，则返回 false
    event.type !== 'transaction' ||
    !ignoreTransactions ||
    !ignoreTransactions.length
  ) {
    return false;
  }

  //   检查事件的 transaction 名称是否匹配 ignoreTransactions 列表中的任何模式
  const name = event.transaction;
  return name ? stringMatchesSomePattern(name, ignoreTransactions) : false;
}

/**
 * 检查事件的 URL 是否在拒绝列表 (denyUrls) 中。如果事件的 URL 被拒绝，则返回 true，表示事件应被忽略。
 *
 * @param event
 * @param denyUrls
 * @returns
 */
function _isDeniedUrl(
  event: Event,
  denyUrls?: Array<string | RegExp>,
): boolean {
  // TODO: Use Glob instead?
  if (!denyUrls || !denyUrls.length) {
    return false;
  }
  // 获取事件的 URL
  const url = _getEventFilterUrl(event);
  return !url ? false : stringMatchesSomePattern(url, denyUrls);
}

/**
 * 检查事件的 URL 是否在允许列表 (allowUrls) 中。
 * 如果事件的 URL 被允许，则返回 true，表示事件不应被忽略。
 *
 * @param event
 * @param allowUrls
 * @returns
 */
function _isAllowedUrl(
  event: Event,
  allowUrls?: Array<string | RegExp>,
): boolean {
  // TODO: Use Glob instead?
  if (!allowUrls || !allowUrls.length) {
    return true;
  }
  const url = _getEventFilterUrl(event);
  return !url ? true : stringMatchesSomePattern(url, allowUrls);
}

/**
 * 获取事件的所有可能的错误消息。它返回一个字符串数组，每个字符串表示一个可能的错误描述。
 *
 * @param event
 * @returns
 */
function _getPossibleEventMessages(event: Event): string[] {
  const possibleMessages: string[] = [];

  if (event.message) {
    possibleMessages.push(event.message);
  }

  let lastException;
  // 尝试获取事件的最后一个异常值，如果存在，将其 value 和 type 组合添加到 possibleMessages 中。
  try {
    // @ts-expect-error Try catching to save bundle size
    lastException = event.exception.values[event.exception.values.length - 1];
  } catch (e) {
    // try catching to save bundle size checking existence of variables
  }

  if (lastException) {
    if (lastException.value) {
      possibleMessages.push(lastException.value);
      if (lastException.type) {
        possibleMessages.push(`${lastException.type}: ${lastException.value}`);
      }
    }
  }

  return possibleMessages;
}

/**
 * 检查事件是否是 Sentry 内部错误
 *
 * @param event
 * @returns
 */
function _isSentryError(event: Event): boolean {
  try {
    // @ts-expect-error can't be a sentry error if undefined
    return event.exception.values[0].type === 'SentryError';
  } catch (e) {
    // ignore
  }
  return false;
}

/**
 * 从堆栈帧中获取最后一个有效的 URL
 *
 * @param frames
 * @returns
 */
function _getLastValidUrl(frames: StackFrame[] = []): string | null {
  for (let i = frames.length - 1; i >= 0; i--) {
    const frame = frames[i];

    // 遍历堆栈帧，找到第一个有效的文件名（既不是匿名的，也不是原生代码），并返回该文件名。
    if (
      frame &&
      frame.filename !== '<anonymous>' &&
      frame.filename !== '[native code]'
    ) {
      return frame.filename || null;
    }
  }

  return null;
}

/**
 * 获取事件的过滤 URL，用于与 allowUrls 和 denyUrls 进行匹配
 *
 * @param event
 * @returns
 */
function _getEventFilterUrl(event: Event): string | null {
  try {
    let frames;
    try {
      // @ts-expect-error we only care about frames if the whole thing here is defined
      frames = event.exception.values[0].stacktrace.frames;
    } catch (e) {
      // ignore
    }
    return frames ? _getLastValidUrl(frames) : null;
  } catch (oO) {
    DEBUG_BUILD &&
      logger.error(
        `Cannot extract url for event ${getEventDescription(event)}`,
      );
    return null;
  }
}

/**
 * 检查事件是否为无用的错误，即没有有效的错误消息、类型或堆栈跟踪
 *
 * @param event
 * @returns
 */
function _isUselessError(event: Event): boolean {
  if (event.type) {
    // event is not an error
    return false;
  }

  // 我们只考虑实际记录了异常值的事件
  if (
    !event.exception ||
    !event.exception.values ||
    event.exception.values.length === 0
  ) {
    return false;
  }

  return (
    // No top-level message
    !event.message &&
    // There are no exception values that have a stacktrace, a non-generic-Error type or value
    !event.exception.values.some(
      (value) =>
        value.stacktrace ||
        (value.type && value.type !== 'Error') ||
        value.value,
    )
  );
}
