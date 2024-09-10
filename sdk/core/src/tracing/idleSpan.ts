import type {
  Span,
  SpanAttributes,
  StartSpanOptions,
} from '@xigua-monitor/types';
import { logger, timestampInSeconds } from '@xigua-monitor/utils';
import { getClient, getCurrentScope } from '../currentScopes';

import { DEBUG_BUILD } from '../debug-build';
import { SEMANTIC_ATTRIBUTE_SENTRY_IDLE_SPAN_FINISH_REASON } from '../semanticAttributes';
import { hasTracingEnabled } from '../utils/hasTracingEnabled';
import { _setSpanForScope } from '../utils/spanOnScope';
import {
  getActiveSpan,
  getSpanDescendants,
  removeChildSpanFromSpan,
  spanTimeInputToSeconds,
  spanToJSON,
} from '../utils/spanUtils';
import { SentryNonRecordingSpan } from './sentryNonRecordingSpan';
import { SPAN_STATUS_ERROR } from './spanstatus';
import { startInactiveSpan } from './trace';

export const TRACING_DEFAULTS = {
  /** 当追踪的 span 空闲事件超过设定时间时（以毫秒为单位），就会自动结束 */
  idleTimeout: 1_000,
  /** span 的最大持续时间（以毫秒为单位），无论是否有新事件发生，超过这个时间后 span 都会结束 */
  finalTimeout: 30_000,
  /** 子 span 的最大持续时间（以毫秒为单位），超过这个时间后，子 span 会结束。 */
  childSpanTimeout: 15_000,
};

/**
 *  代表心跳检测失败。这通常意味着在规定的时间内未收到响应或未完成某个操作
 */
const FINISH_REASON_HEARTBEAT_FAILED = 'heartbeatFailed';
/**
 * 代表由于用户空闲超时而结束的操作。这意味着在规定的时间内没有任何用户交互。
 */
const FINISH_REASON_IDLE_TIMEOUT = 'idleTimeout';
/**
 * 代表最终超时。即使在操作中，某个特定的时间限制被触发，操作也会被强制结束。
 */
const FINISH_REASON_FINAL_TIMEOUT = 'finalTimeout';
/**
 * 代表外部条件导致操作结束。可能是来自外部事件的请求，例如用户导航到其他页面。
 */
const FINISH_REASON_EXTERNAL_FINISH = 'externalFinish';
/**
 * 代表操作被取消，可能是由于用户主动中断
 */
const FINISH_REASON_CANCELLED = 'cancelled';

/**
 * 表示文档隐藏，例如用户切换到另一个标签页或最小化浏览器窗口。
 * 这个常量在这段代码中未被使用，但在其他地方（如 BrowserTracing）可能会被引用。
 */
const FINISH_REASON_DOCUMENT_HIDDEN = 'documentHidden';

/**
 * 表示操作由于交互被中断，比如用户在操作期间进行了其他的点击或输入。
 * 这同样在当前文件中未被使用，但在与浏览器追踪相关的上下文中可能会使用。
 */
const FINISH_REASON_INTERRUPTED = 'interactionInterrupted';

type IdleSpanFinishReason =
  | typeof FINISH_REASON_CANCELLED
  | typeof FINISH_REASON_DOCUMENT_HIDDEN
  | typeof FINISH_REASON_EXTERNAL_FINISH
  | typeof FINISH_REASON_FINAL_TIMEOUT
  | typeof FINISH_REASON_HEARTBEAT_FAILED
  | typeof FINISH_REASON_IDLE_TIMEOUT
  | typeof FINISH_REASON_INTERRUPTED;

/**
 * 这个接口用于配置与“空闲跨度”（Idle Span）相关的选项
 */
interface IdleSpanOptions {
  /**
   * 在没有创建任何跨度的情况下必须经过的时间（以毫秒为单位）。
   * 如果超过这个时间，则空闲跨度将被结束。
   *
   * 用于检测用户是否处于活动状态。当用户在指定的时间段内没有任何交互时，这个选项将触发跨度的结束。
   */
  idleTimeout: number;
  /**
   * 空闲跨度可以运行的最大时间（以毫秒为单位）。
   * 如果超过这个时间，无论如何空闲跨度都会结束。
   *
   * 提供了一个强制的结束机制，以防止跨度在无活动情况下无限制地运行，确保资源的合理使用。
   */
  finalTimeout: number;
  /**
   * 子跨度可以运行的最大时间（以毫秒为单位）。
   * 如果自最后一个跨度开始以来经过的时间超过这个时间，则空闲跨度将结束。
   *
   * 允许开发者配置子跨度的最大运行时间，以便在特定时间内结束未完成的子跨度，进一步控制资源的使用。
   */
  childSpanTimeout?: number;
  /**
   * 设置为 true 时，将禁用空闲超时和子超时，直到为空闲跨度发出 idleSpanEnableAutoFinish 钩子。
   * 最终超时机制不受此选项的影响，这意味着在达到最终超时后，空闲跨度一定会结束，无论此选项的配置如何。
   *
   * 此选项用于在某些情况下（例如需要保持跨度活跃的操作）临时禁用空闲和子超时，提供了灵活的控制选项。
   * @default false
   */
  disableAutoFinish?: boolean;
  /**
   * 允许配置一个钩子，当空闲跨度结束时被调用，在处理之前执行。
   *
   * 可以用来进行一些清理或处理逻辑，比如记录、调整状态等，确保在跨度被正式结束前有机会进行必要的操作。
   */
  beforeSpanEnd?: (span: Span) => void;
}

/**
 * 这段代码实现了一个 Idle Span 的管理逻辑，提供了监控空闲时间段内活动的功能。
 * 在此实现中，Idle Span 是一种特殊的跨度，用于追踪用户的活动并在没有活动时自动结束。
 *
 * 函数的主要功能是启动一个空闲跨度，配置其属性，并根据用户的活动情况决定何时结束这个跨度
 *
 * @param startSpanOptions 启动跨度所需的配置选项
 * @param options 空闲跨度的配置选项
 * @returns
 */
export function startIdleSpan(
  startSpanOptions: StartSpanOptions,
  options: Partial<IdleSpanOptions> = {},
): Span {
  /** 用于存储当前活动的子跨度，跟踪哪些子跨度正在运行 */
  const activities = new Map<string, boolean>();

  /** 指示空闲跨度是否已经结束 */
  let _finished = false;

  /** 用于跟踪空闲超时 */
  let _idleTimeoutID: ReturnType<typeof setTimeout> | undefined;

  /** 用于跟踪子 span超时 */
  let _childSpanTimeoutID: ReturnType<typeof setTimeout> | undefined;

  /** 用于记录跨度结束的原因 */
  let _finishReason: IdleSpanFinishReason = FINISH_REASON_EXTERNAL_FINISH;

  /** 控制是否允许自动结束空闲跨度 */
  let _autoFinishAllowed: boolean = !options.disableAutoFinish;

  const _cleanupHooks: (() => void)[] = [];

  // 从配置中提取数据
  const {
    idleTimeout = TRACING_DEFAULTS.idleTimeout,
    finalTimeout = TRACING_DEFAULTS.finalTimeout,
    childSpanTimeout = TRACING_DEFAULTS.childSpanTimeout,
    beforeSpanEnd,
  } = options;

  // 获取客户端实例
  const client = getClient();

  // 如果没有客户端或者没有启用跟踪，则返回一个非记录跨度
  if (!client || !hasTracingEnabled()) {
    return new SentryNonRecordingSpan();
  }

  // 获取当前作用域
  const scope = getCurrentScope();
  // 获取当前活跃的span
  const previousActiveSpan = getActiveSpan();

  // 启动一个新的空闲 span
  const span = _startIdleSpan(startSpanOptions);

  /**
   * 重写end 方法，通过 proxy 以便在结束跨度前执行额外的逻辑
   *
   * Proxy 对象用于定义基本操作（例如属性查找、赋值、枚举、函数调用等）的自定义行为
   * apply 是 Proxy 对象的一个陷阱，用于定义当代理对象作为函数被调用时的行为
   *
   * 这里使用 proxy 主要是用于在执行span.end 方法之前 执行一个额外的逻辑
   */
  // eslint-disable-next-line @typescript-eslint/unbound-method
  span.end = new Proxy(span.end, {
    apply(target, thisArg, args: Parameters<Span['end']>) {
      // 如果存在前置钩子函数，则执行它
      if (beforeSpanEnd) {
        beforeSpanEnd(span);
      }

      // 获取传递给 span 的时间戳
      const [definedEndTimestamp, ...rest] = args;
      // 没有显式传递结束时间戳，它会使用当前的时间
      const timestamp = definedEndTimestamp || timestampInSeconds();
      // 转化为秒格式
      const spanEndTimestamp = spanTimeInputToSeconds(timestamp);

      // 检查是否有子 span
      const spans = getSpanDescendants(span).filter((child) => child !== span);

      // 如果没有子 span 那就可以结束了
      if (!spans.length) {
        onIdleSpanEnded(spanEndTimestamp);
        // 调用原始的 span.end 方法
        return Reflect.apply(target, thisArg, [spanEndTimestamp, ...rest]);
      }

      // 走到这里说明存在子 span

      // 计算所有子 span 的结束时间（将子span JSON化获取，获取结束时间，且过滤掉结束时间不存在的）
      const childEndTimestamps = spans
        .map((span) => spanToJSON(span).timestamp)
        .filter((timestamp) => !!timestamp) as number[];

      // 找到子span 中最晚结束时间，如果没有有效的子 span 结束时间，则设为 undefined
      const latestSpanEndTimestamp = childEndTimestamps.length
        ? Math.max(...childEndTimestamps)
        : undefined;

      // 获取当前span的开始时间
      const spanStartTimestamp = spanToJSON(span).start_timestamp;

      /**
       * 使用 Math.min 来确保 span 的结束时间不会超过 finalTimeout 限制，同时又不会早于 span 的开始时间。
       * 计算 span 的结束时间时，考虑到它的开始时间、子 span 的结束时间、以及允许的最大超时，
       * 确保 endTimestamp 合理且不违背这些约束。
       */
      const endTimestamp = Math.min(
        // 有开始时间，计算出 span 的最大允许结束时间
        spanStartTimestamp
          ? spanStartTimestamp + finalTimeout / 1000
          : Infinity,
        Math.max(
          spanStartTimestamp || -Infinity,
          // 找到当前 span 的结束时间和所有子 span 中最晚的结束时间中最小
          Math.min(spanEndTimestamp, latestSpanEndTimestamp || Infinity),
        ),
      );

      // 标记 span 的结束
      onIdleSpanEnded(endTimestamp);
      // 调用原始end方法
      return Reflect.apply(target, thisArg, [endTimestamp, ...rest]);
    },
  });

  /**
   * Cancels the existing idle timeout, if there is one.
   */
  function _cancelIdleTimeout(): void {
    if (_idleTimeoutID) {
      clearTimeout(_idleTimeoutID);
      _idleTimeoutID = undefined;
    }
  }

  /**
   * Cancels the existing child span timeout, if there is one.
   */
  function _cancelChildSpanTimeout(): void {
    if (_childSpanTimeoutID) {
      clearTimeout(_childSpanTimeoutID);
      _childSpanTimeoutID = undefined;
    }
  }

  /**
   * Restarts idle timeout, if there is no running idle timeout it will start one.
   */
  function _restartIdleTimeout(endTimestamp?: number): void {
    _cancelIdleTimeout();
    _idleTimeoutID = setTimeout(() => {
      if (!_finished && activities.size === 0 && _autoFinishAllowed) {
        _finishReason = FINISH_REASON_IDLE_TIMEOUT;
        span.end(endTimestamp);
      }
    }, idleTimeout);
  }

  /**
   * Restarts child span timeout, if there is none running it will start one.
   */
  function _restartChildSpanTimeout(endTimestamp?: number): void {
    _cancelChildSpanTimeout();
    _idleTimeoutID = setTimeout(() => {
      if (!_finished && _autoFinishAllowed) {
        _finishReason = FINISH_REASON_HEARTBEAT_FAILED;
        span.end(endTimestamp);
      }
    }, childSpanTimeout);
  }

  /**
   * Start tracking a specific activity.
   * @param spanId The span id that represents the activity
   */
  function _pushActivity(spanId: string): void {
    _cancelIdleTimeout();
    activities.set(spanId, true);

    const endTimestamp = timestampInSeconds();
    // We need to add the timeout here to have the real endtimestamp of the idle span
    // Remember timestampInSeconds is in seconds, timeout is in ms
    _restartChildSpanTimeout(endTimestamp + childSpanTimeout / 1000);
  }

  /**
   * Remove an activity from usage
   * @param spanId The span id that represents the activity
   */
  function _popActivity(spanId: string): void {
    if (activities.has(spanId)) {
      activities.delete(spanId);
    }

    if (activities.size === 0) {
      const endTimestamp = timestampInSeconds();
      // We need to add the timeout here to have the real endtimestamp of the idle span
      // Remember timestampInSeconds is in seconds, timeout is in ms
      _restartIdleTimeout(endTimestamp + idleTimeout / 1000);
      _cancelChildSpanTimeout();
    }
  }

  /**
   * 该函数在 "idle span"（空闲状态的 span）结束时被调用
   * 它执行了一些清理操作、处理子 span，并确保在 span 结束时有必要的状态更新和日志记录。
   * @param endTimestamp
   * @returns
   */
  function onIdleSpanEnded(endTimestamp: number): void {
    // 设置为true 表示当前 span 已经结束
    _finished = true;
    // 清空与 span 相关的活动
    activities.clear();

    // 遍历并执行所有注册的清理钩子
    // 可能是一些需要在 span 结束时执行的操作，比如解除事件监听、释放资源等
    _cleanupHooks.forEach((cleanup) => cleanup());

    // 将活动范围内的 span 恢复为之前的活动 span（previousActiveSpan）
    // 这是为了在当前 span 结束后，能够正确地恢复上下文，继续处理上一个活动的 span。
    _setSpanForScope(scope, previousActiveSpan);

    // 将当前span转换为 JSON
    const spanJSON = spanToJSON(span);

    // 获取 span 的开始时间戳
    const { start_timestamp: startTimestamp } = spanJSON;
    // This should never happen, but to make TS happy...
    // 如果不存在，代码会直接返回，表示此时无法继续操作。
    if (!startTimestamp) {
      return;
    }

    const attributes: SpanAttributes = spanJSON.data || {};
    // 检查 spanJSON.data 是否包含这个属性
    if (!attributes[SEMANTIC_ATTRIBUTE_SENTRY_IDLE_SPAN_FINISH_REASON]) {
      // 如果没有，则为当前 span 设置该属性，值为 _finishReason，用于标识此次 span 结束的原因。
      span.setAttribute(
        SEMANTIC_ATTRIBUTE_SENTRY_IDLE_SPAN_FINISH_REASON,
        _finishReason,
      );
    }

    // 记录日志，说明空闲的 span 已经结束
    logger.log(`[Tracing] Idle span "${spanJSON.op}" finished`);

    // 获取当前 span 的所有子 span，过滤掉与当前 span 相同的条目（即它不会自己包含自己作为子 span）
    const childSpans = getSpanDescendants(span).filter(
      (child) => child !== span,
    );

    /** 用于统计被丢弃的子 span 数量 */
    let discardedSpans = 0;
    /**
     * 遍历所有子 span，根据它们的状态和时间戳，
     * 决定是否结束并丢弃某些未完成或不合格的 span，并标记哪些子 span 被丢弃。
     * 确保了一个空闲的 span（idle span）可以在适当的时间内结束，防止某些子 span 长时间运行或在错误的时间段内结束。
     */
    childSpans.forEach((childSpan) => {
      //  isRecording 返回true 代码该span还在记录
      if (childSpan.isRecording()) {
        // 其状态标记为 "cancelled"
        childSpan.setStatus({ code: SPAN_STATUS_ERROR, message: 'cancelled' });
        // 提前结束它
        childSpan.end(endTimestamp);
        // debug 模式下 记录日志
        DEBUG_BUILD &&
          logger.log(
            '[Tracing] Cancelling span since span ended early',
            JSON.stringify(childSpan, undefined, 2),
          );
      }

      // 将当前子span JSON化
      const childSpanJSON = spanToJSON(childSpan);

      // 提取子 span 的开始和结束时间
      const {
        timestamp: childEndTimestamp = 0,
        start_timestamp: childStartTimestamp = 0,
      } = childSpanJSON;

      // 检查子 span 是在 idle span 结束之前启动的
      const spanStartedBeforeIdleSpanEnd = childStartTimestamp <= endTimestamp;

      // 计算 最大运行时间和空闲时间的总和，用来判断子 span 是否在合理的时间范围内结束
      const timeoutWithMarginOfError = (finalTimeout + idleTimeout) / 1000;
      const spanEndedBeforeFinalTimeout =
        childEndTimestamp - childStartTimestamp <= timeoutWithMarginOfError;

      // debug 模式下，输出相应的日志来解释为什么丢弃某个 span
      if (DEBUG_BUILD) {
        const stringifiedSpan = JSON.stringify(childSpan, undefined, 2);
        if (!spanStartedBeforeIdleSpanEnd) {
          logger.log(
            '[Tracing] Discarding span since it happened after idle span was finished',
            stringifiedSpan,
          );
        } else if (!spanEndedBeforeFinalTimeout) {
          logger.log(
            '[Tracing] Discarding span since it finished after idle span final timeout',
            stringifiedSpan,
          );
        }
      }

      // 如果子 span 未在空闲 span 结束前启动
      // 或者其结束时间超出了 finalTimeout 和 idleTimeout 的范围，
      if (!spanEndedBeforeFinalTimeout || !spanStartedBeforeIdleSpanEnd) {
        // 将子 span 从父 span 中移除，并将 discardedSpans 计数器加 1。
        removeChildSpanFromSpan(span, childSpan);
        discardedSpans++;
      }
    });

    // 如果有子 span 被丢弃
    if (discardedSpans > 0) {
      // 则在 span 上添加一个 sentry.idle_span_discarded_spans 属性，记录丢弃的 span 数量。
      span.setAttribute('sentry.idle_span_discarded_spans', discardedSpans);
    }
  }

  _cleanupHooks.push(
    client.on('spanStart', (startedSpan) => {
      // If we already finished the idle span,
      // or if this is the idle span itself being started,
      // or if the started span has already been closed,
      // we don't care about it for activity
      if (
        _finished ||
        startedSpan === span ||
        !!spanToJSON(startedSpan).timestamp
      ) {
        return;
      }

      const allSpans = getSpanDescendants(span);

      // If the span that was just started is a child of the idle span, we should track it
      if (allSpans.includes(startedSpan)) {
        _pushActivity(startedSpan.spanContext().spanId);
      }
    }),
  );

  _cleanupHooks.push(
    client.on('spanEnd', (endedSpan) => {
      if (_finished) {
        return;
      }

      _popActivity(endedSpan.spanContext().spanId);
    }),
  );

  _cleanupHooks.push(
    client.on('idleSpanEnableAutoFinish', (spanToAllowAutoFinish) => {
      if (spanToAllowAutoFinish === span) {
        _autoFinishAllowed = true;
        _restartIdleTimeout();

        if (activities.size) {
          _restartChildSpanTimeout();
        }
      }
    }),
  );

  // We only start the initial idle timeout if we are not delaying the auto finish
  if (!options.disableAutoFinish) {
    _restartIdleTimeout();
  }

  setTimeout(() => {
    if (!_finished) {
      span.setStatus({ code: SPAN_STATUS_ERROR, message: 'deadline_exceeded' });
      _finishReason = FINISH_REASON_FINAL_TIMEOUT;
      span.end();
    }
  }, finalTimeout);

  return span;
}

function _startIdleSpan(options: StartSpanOptions): Span {
  const span = startInactiveSpan(options);

  _setSpanForScope(getCurrentScope(), span);

  DEBUG_BUILD && logger.log('[Tracing] Started span is an idle span');

  return span;
}
