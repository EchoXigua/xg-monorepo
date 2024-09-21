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

/** 追踪的默认配置 */
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
   * 取消现有的空闲超时定时器
   */
  function _cancelIdleTimeout(): void {
    // 存在空闲定时器id,则清除这个定时器
    if (_idleTimeoutID) {
      clearTimeout(_idleTimeoutID);
      _idleTimeoutID = undefined;
    }
  }

  /**
   * 取消现有的子 span 超时定时器
   */
  function _cancelChildSpanTimeout(): void {
    // 存在子 span 定时器,则清除这个定时器
    if (_childSpanTimeoutID) {
      clearTimeout(_childSpanTimeoutID);
      _childSpanTimeoutID = undefined;
    }
  }

  /**
   * 重新启动空闲超时计时器。如果当前没有运行的空闲超时，则启动一个新的超时计时器。
   */
  function _restartIdleTimeout(endTimestamp?: number): void {
    // 取消当前的空闲超时计时器，确保没有重复的超时计时器运行
    _cancelIdleTimeout();

    // 创建一个新的超时计时器，指定在 idleTimeout 毫秒后执行的回调函数。
    _idleTimeoutID = setTimeout(() => {
      // 当前任务没有已经结束  当前没有任何活动在进行 允许自动结束
      if (!_finished && activities.size === 0 && _autoFinishAllowed) {
        // 设置结束原因
        _finishReason = FINISH_REASON_IDLE_TIMEOUT;
        // 结束当前的 span
        span.end(endTimestamp);
      }
    }, idleTimeout);
  }

  /**
   * 重新启动子 span 的超时计时器。如果当前没有运行的子 span 超时，则启动一个新的超时计时器
   */
  function _restartChildSpanTimeout(endTimestamp?: number): void {
    // 取消当前的子 span 超时计时器
    _cancelChildSpanTimeout();

    // 创建一个新的超时计时器
    // _childSpanTimeoutID = setTimeout(() => {
    _idleTimeoutID = setTimeout(() => {
      // 如果当前任务没有结束 且 允许自动结束
      if (!_finished && _autoFinishAllowed) {
        // 设置结束原因
        _finishReason = FINISH_REASON_HEARTBEAT_FAILED;
        // 自动结束当前的 span
        span.end(endTimestamp);
      }
    }, childSpanTimeout);
  }

  /**
   * 用于开始追踪某个特定的活动
   * @param spanId The span id that represents the activity
   */
  function _pushActivity(spanId: string): void {
    // 在追踪新的活动之前，取消当前的空闲超时操作
    // 当有新的活动开始时，系统不再处于空闲状态，因此需要停止原本可能设置的空闲计时器
    _cancelIdleTimeout();
    // 表示该 spanId 代表的活动正在进行
    activities.set(spanId, true);

    // 记录当前的时间戳,这个时间戳表示追踪活动的开始时间
    const endTimestamp = timestampInSeconds();
    // 重新启动子 span 的超时操作
    // 传入的时间戳是当前时间戳加上 childSpanTimeout 的持续时间，这意味着子 span 的追踪将在这个时间点之后超时。
    _restartChildSpanTimeout(endTimestamp + childSpanTimeout / 1000);
  }

  /**
   * 用于停止对某个特定活动的追踪
   * @param spanId The span id that represents the activity
   */
  function _popActivity(spanId: string): void {
    // 找到指定的id 并移除它
    if (activities.has(spanId)) {
      activities.delete(spanId);
    }

    // 检查当前是否没有活动在进行
    if (activities.size === 0) {
      // 获取当前时间戳，表示所有活动结束的时间。
      const endTimestamp = timestampInSeconds();

      // 重新启动空闲超时计时器，时间是当前时间加上 idleTimeout。
      // 如果所有活动都结束，系统重新进入空闲状态，等待下一个超时
      _restartIdleTimeout(endTimestamp + idleTimeout / 1000);

      // 取消子 span 的超时计时器，因为此时所有活动都已经结束，不再需要单独追踪子 span
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

  // 下面的代码主要用于处理 idle span（空闲的 span）的生命周期管理
  // 包括自动结束、监听 spanStart 和 spanEnd 事件，以及处理子 span 的超时等情况
  // 它通过挂载事件监听器和设置超时机制来控制 idle span 的结束条件

  _cleanupHooks.push(
    // 每当一个新的 span 开始时触发
    client.on('spanStart', (startedSpan) => {
      if (
        // 如果 idle span 已经结束
        _finished ||
        // 当前启动的 span 就是 idle span 本身
        startedSpan === span ||
        // 如果 span 已经有结束时间，说明它已经结束，不需要再处理
        !!spanToJSON(startedSpan).timestamp
      ) {
        // 跳过处理
        return;
      }

      // 获取span 的所有子 span
      const allSpans = getSpanDescendants(span);

      // 如果新启动的 span 是当前 idle span 的子级，应该跟踪它
      if (allSpans.includes(startedSpan)) {
        // 则将其加入活动列表中
        _pushActivity(startedSpan.spanContext().spanId);
      }
    }),
  );

  _cleanupHooks.push(
    // 在 span 结束时触发
    client.on('spanEnd', (endedSpan) => {
      // 跳过已经结束的
      if (_finished) {
        return;
      }

      // 传入结束的 span 的 spanId，从活动列表中移除它
      _popActivity(endedSpan.spanContext().spanId);
    }),
  );

  _cleanupHooks.push(
    // 在启用 idle span 的自动结束时触发
    client.on('idleSpanEnableAutoFinish', (spanToAllowAutoFinish) => {
      // 如果是当前span
      if (spanToAllowAutoFinish === span) {
        // 设置为  true，允许自动结束
        _autoFinishAllowed = true;
        // 重新开始 idle span 的超时计时
        _restartIdleTimeout();

        // 如果当前仍有活动的子 span（activities.size 大于 0）
        if (activities.size) {
          // 重新开始子 span 的超时计时
          _restartChildSpanTimeout();
        }
      }
    }),
  );

  // 如果未禁用自动结束，开始 idle span 的超时计时
  if (!options.disableAutoFinish) {
    _restartIdleTimeout();
  }

  // 设置一个定时器,用于确保 idle span 在超过该超时时间时强制结束
  setTimeout(() => {
    if (!_finished) {
      // 超时之前还没结束, 将 span 的状态设置为 SPAN_STATUS_ERROR,并标记错误原因
      span.setStatus({ code: SPAN_STATUS_ERROR, message: 'deadline_exceeded' });
      _finishReason = FINISH_REASON_FINAL_TIMEOUT;

      // 强制结束 span
      span.end();
    }
  }, finalTimeout);

  return span;
}

/**
 * 用于创建并启动一个处于“空闲状态”的 span，并将其与当前上下文关联
 * @param options
 * @returns
 */
function _startIdleSpan(options: StartSpanOptions): Span {
  // 创建一个未激活的 span,这意味着这个 span 在开始时并没有标记为活跃，通常用于需要手动管理的 span
  const span = startInactiveSpan(options);

  // 将创建的 span 设置到当前的作用域（scope）中
  _setSpanForScope(getCurrentScope(), span);

  // debug 下记录日志 告知开发者创建的 span 是一个“空闲 span”
  DEBUG_BUILD && logger.log('[Tracing] Started span is an idle span');

  // 这个 span 后续会在其他地方进行操作，比如手动启动、结束、计算时间等
  return span;
}
