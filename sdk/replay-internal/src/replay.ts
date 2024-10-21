/* eslint-disable max-lines */ // TODO: We might want to split this file up
import { EventType, record } from '@xigua-monitor/rrweb';
import {
  SEMANTIC_ATTRIBUTE_SENTRY_SOURCE,
  getActiveSpan,
  getClient,
  getRootSpan,
  spanToJSON,
} from '@xigua-monitor/core';
import type { ReplayRecordingMode, Span } from '@xigua-monitor/types';
import { logger } from './util/logger';

import {
  BUFFER_CHECKOUT_TIME,
  SESSION_IDLE_EXPIRE_DURATION,
  SESSION_IDLE_PAUSE_DURATION,
  SLOW_CLICK_SCROLL_TIMEOUT,
  SLOW_CLICK_THRESHOLD,
  WINDOW,
} from './constants';
import { ClickDetector } from './coreHandlers/handleClick';
import { handleKeyboardEvent } from './coreHandlers/handleKeyboardEvent';
import { setupPerformanceObserver } from './coreHandlers/performanceObserver';
import { DEBUG_BUILD } from './debug-build';
import { createEventBuffer } from './eventBuffer';
import { clearSession } from './session/clearSession';
import { loadOrCreateSession } from './session/loadOrCreateSession';
import { saveSession } from './session/saveSession';
import { shouldRefreshSession } from './session/shouldRefreshSession';

import type {
  AddEventResult,
  AddUpdateCallback,
  AllPerformanceEntry,
  AllPerformanceEntryData,
  EventBuffer,
  InternalEventContext,
  PopEventContext,
  RecordingEvent,
  RecordingOptions,
  ReplayBreadcrumbFrame,
  ReplayCanvasIntegrationOptions,
  ReplayContainer as ReplayContainerInterface,
  ReplayPerformanceEntry,
  ReplayPluginOptions,
  SendBufferedReplayOptions,
  Session,
  SlowClickConfig,
  Timeouts,
} from './types';
import { ReplayEventTypeCustom } from './types';
import { addEvent, addEventSync } from './util/addEvent';
import { addGlobalListeners } from './util/addGlobalListeners';
import { addMemoryEntry } from './util/addMemoryEntry';
import { createBreadcrumb } from './util/createBreadcrumb';
import { createPerformanceEntries } from './util/createPerformanceEntries';
import { createPerformanceSpans } from './util/createPerformanceSpans';
import { debounce } from './util/debounce';
import { getHandleRecordingEmit } from './util/handleRecordingEmit';
import { isExpired } from './util/isExpired';
import { isSessionExpired } from './util/isSessionExpired';
import { sendReplay } from './util/sendReplay';
import type { SKIPPED } from './util/throttle';
import { THROTTLED, throttle } from './util/throttle';

/**
 * The main replay container class, which holds all the state and methods for recording and sending replays.
 */
export class ReplayContainer implements ReplayContainerInterface {
  /**
   * 用于存储录制的事件缓冲区，可以为 null 或一个事件缓存的实例
   * 通过使用缓冲区可以确保在触发发送之前能够积累一定量的事件。
   * 这有助于在高效地管理网络请求的同时确保关键事件不会丢失。
   */
  public eventBuffer: EventBuffer | null;

  /**
   * 存储了与性能相关的条目，包括用户的交互、资源加载时间等
   * 用户回放功能不仅仅记录 DOM 操作，还可以追踪性能指标，
   * 例如页面加载时间或用户点击之后的反应时间。这些数据可帮助你分析用户体验的流畅度。
   */
  public performanceEntries: AllPerformanceEntry[];

  /**
   * 用于保存与回放相关的性能条目
   * 有助于你在回顾错误时，不仅能看到用户的操作，还能看到相应的系统性能表现
   */
  public replayPerformanceEntries: ReplayPerformanceEntry<AllPerformanceEntryData>[];

  /**
   * 当前的回放会话，每个回放对应一个会话对象，Session 负责记录当前的用户会话状态，
   * 如会话开始、结束的时间等信息。在错误或异常发生时，这个会话记录便于将整个用户行为和背景还原。
   */
  public session: Session | undefined;

  /**
   * 用于检测用户点击事件的工具
   */
  public clickDetector: ClickDetector | undefined;

  /**
   * 回放的录制模式。支持三种模式
   * Recording can happen in one of three modes:
   *   - session：录制整个会话，并持续发送数据
   *   - buffer：仅保留最近 60 秒的数据（但并不会立即发送这些数据，会保存在一个缓冲区中，等待满足某些条件后再发送）
   *     - 错误回放采样率：当 replaysOnErrorSampleRate 大于 0 时，如果发生错误，系统会根据该采样率决定是否将缓冲区中的数据发送出去
   *     - 手动触发：调用 flush() 方法也可以手动触发发送
   */
  public recordingMode: ReplayRecordingMode;

  /**
   * 保存当前或最近的活跃 span（性能分析相关的标记）
   */
  public lastActiveSpan?: Span;

  /**
   * 用于存储回放相关的超时配置
   * 置控制着回放系统的各种超时行为，比如用户闲置多长时间后暂停会话等
   * @hidden
   */
  public readonly timeouts: Timeouts;

  /**
   * 指示是否需要手动启动回放。如果没有配置采样率(没有错误、没有会话)，回放需要手动启动
   * 在某些场景下，自动启动回放可能不合适或不必要，因此提供手动启动的方式可以让开发者根据实际需求控制回放的启动时机
   */
  private _requiresManualStart: boolean;

  /**
   * 用于将事件添加到缓冲区的函数，并通过节流机制控制事件的频繁添加
   * 确保高频事件（如滚动、鼠标移动）不会触发过多的回放记录请求，从而提升系统性能
   */
  private _throttledAddEvent: (
    event: RecordingEvent,
    isCheckout?: boolean,
  ) => typeof THROTTLED | typeof SKIPPED | Promise<AddEventResult | null>;

  /**
   * 存储传递给 rrweb.record() 函数的配置选项
   * rrweb 是一个流行的用于记录和重播用户交互的库
   */
  private readonly _recordingOptions: RecordingOptions;

  /**
   * 回放的相关配置项，用于细化回放行为，例如哪些事件需要记录、回放的频率等
   */
  private readonly _options: ReplayPluginOptions;

  /**
   * 用于在回放结束后清理性能记录的回调函数
   * 当用户会话结束或回放功能停止时，需要清理与性能相关的监听器和数据，在这些操作结束后释放资源，避免内存泄漏或无用的数据残留
   */
  private _performanceCleanupCallback?: () => void;

  /**
   * 一个防抖动的 flush 函数，用于批量发送回放数据
   * 比如在用户频繁操作时，不必每次都立即发送数据，可以在一段时间内聚合多次操作，然后一次性发送
   */
  private _debouncedFlush: ReturnType<typeof debounce>;
  /**
   * 用于确保 flush 操作的顺序性，防止并发的 flush 请求
   * 制确保当数据缓冲区正在刷新时，其他的 flush 操作会等待，避免出现数据竞态条件或数据重复发送的问题
   */
  private _flushLock: Promise<unknown> | undefined;

  /**
   * 保存上次用户活动的时间戳。这个值会跨越会话保存
   *
   * 主要用于追踪用户最近一次交互的时间，这可以帮助回放系统判断用户是否处于活跃状态，
   * 以及在回放过程中确定特定事件的时间。它对恢复用户行为的时间线非常重要，尤其是在会话跨越多个时间段的情况下
   */
  private _lastActivity: number;

  /**
   * 指示当前回放功能是否处于激活状态，标识回放功能是否处于工作状态
   */
  private _isEnabled: boolean;

  /**
   * 指示回放是否处于暂停状态，暂停时：
   * - DOM 录制不再进行
   * - 事件缓冲区不会接收任何新事件（如 SDK 事件）
   *
   * 暂停状态通常用于临时停止数据记录，而不会销毁当前的录制上下文
   */
  private _isPaused: boolean;

  /**
   * 指示是否已经将监听器附加到核心 SDK 中，这些监听器是无法移除的，因此需要跟踪它们是否已初始化
   *
   * 回放功能需要监听一些核心事件（如用户点击、页面加载等），通过这个属性确保这些事件监听器只会初始化一次
   * 这样可以避免多次重复绑定同样的事件，防止性能问题或重复记录
   */
  private _hasInitializedCoreListeners: boolean;

  /**
   * 用于存储停止录制的函数
   */
  private _stopRecording: ReturnType<typeof record> | undefined;

  /**
   * 保存事件的上下文信息，包含内部的事件状态和元数据
   */
  private _context: InternalEventContext;

  /**
   * 用于内部与画布相关的录制配置选项
   */
  private _canvas: ReplayCanvasIntegrationOptions | undefined;

  public constructor({
    options,
    recordingOptions,
  }: {
    options: ReplayPluginOptions;
    recordingOptions: RecordingOptions;
  }) {
    this.eventBuffer = null;
    this.performanceEntries = [];
    this.replayPerformanceEntries = [];
    this.recordingMode = 'session';
    this.timeouts = {
      sessionIdlePause: SESSION_IDLE_PAUSE_DURATION,
      sessionIdleExpire: SESSION_IDLE_EXPIRE_DURATION,
    } as const;

    // 记录上次用户活动的时间戳，每当用户有交互行为时，这个值会被更新，用于监控用户活动
    this._lastActivity = Date.now();
    this._isEnabled = false;
    this._isPaused = false;

    // 回放是否需要手动启动
    this._requiresManualStart = false;
    // 核心 SDK 事件监听器是否已经初始化
    this._hasInitializedCoreListeners = false;

    // 存储事件的上下文信息，如错误 ID、追踪 ID、URL 列表等
    this._context = {
      errorIds: new Set(),
      traceIds: new Set(),
      urls: [],
      initialTimestamp: Date.now(),
      initialUrl: '',
    };

    // 保存传递给 rrweb.record() 的录制选项
    this._recordingOptions = recordingOptions;
    this._options = options;

    // 创建一个延迟的 flush 函数，用于在一定时间内将事件数据发送到服务器
    // 最小延迟 (flushMinDelay) 和最大等待时间 (flushMaxDelay)
    this._debouncedFlush = debounce(
      () => this._flush(),
      this._options.flushMinDelay,
      {
        maxWait: this._options.flushMaxDelay,
      },
    );

    // 限制每 5 秒最多添加 300 个事件，避免在短时间内添加过多事件，影响性能
    this._throttledAddEvent = throttle(
      (event: RecordingEvent, isCheckout?: boolean) =>
        addEvent(this, event, isCheckout),
      // Max 300 events...
      300,
      // ... per 5s
      5,
    );

    /**
     * slowClickTimeout：慢速点击的时间阈值。如果用户点击超过这个时间，就被视为慢点击
     * slowClickIgnoreSelectors：指定应该忽略慢速点击检测的选择器
     */
    const { slowClickTimeout, slowClickIgnoreSelectors } = this.getOptions();

    // 慢点击配置
    const slowClickConfig: SlowClickConfig | undefined = slowClickTimeout
      ? {
          // 点击时间阈值，取较小值，保证点击时间不会超出某个合理的范围
          threshold: Math.min(SLOW_CLICK_THRESHOLD, slowClickTimeout),
          // 超时值，即慢速点击的定义时间
          timeout: slowClickTimeout,
          // 滚动相关的超时，用于处理滚动操作时的点击行为
          scrollTimeout: SLOW_CLICK_SCROLL_TIMEOUT,
          // 忽略慢速点击的 DOM 元素选择器
          ignoreSelector: slowClickIgnoreSelectors
            ? slowClickIgnoreSelectors.join(',')
            : '',
        }
      : undefined;

    // 存在配置则初始化一个慢点击实例
    if (slowClickConfig) {
      this.clickDetector = new ClickDetector(this, slowClickConfig);
    }

    // Configure replay logger w/ experimental options
    if (DEBUG_BUILD) {
      const experiments = options._experiments;
      logger.setConfig({
        captureExceptions: !!experiments.captureExceptions,
        traceInternals: !!experiments.traceInternals,
      });
    }
  }

  /** 获取当前事件的上下文信息 */
  public getContext(): InternalEventContext {
    return this._context;
  }

  /** 当前回放功能是否处于激活状态 */
  public isEnabled(): boolean {
    return this._isEnabled;
  }

  /** 回放功能是否处于暂停状态 */
  public isPaused(): boolean {
    return this._isPaused;
  }

  /**
   * 是否启用了 canvas 录制功能
   */
  public isRecordingCanvas(): boolean {
    return Boolean(this._canvas);
  }

  /** 获取回放插件的配置信息 */
  public getOptions(): ReplayPluginOptions {
    return this._options;
  }

  /** 捕获异常的包装器，在启用 DEBUG_BUILD 时，将错误信息通过日志记录 */
  public handleException(error: unknown): void {
    DEBUG_BUILD && logger.exception(error);
  }

  /**
   * 基于采样配置初始化插件，不应在构造函数外部调用
   */
  public initializeSampling(previousSessionId?: string): void {
    // 获取错误采样率、会话采样率
    const { errorSampleRate, sessionSampleRate } = this._options;

    // 如果两个采样率都小于等于 0，则需要用户手动启动回放
    const requiresManualStart = errorSampleRate <= 0 && sessionSampleRate <= 0;

    this._requiresManualStart = requiresManualStart;

    if (requiresManualStart) {
      return;
    }

    // 否则有一个采样率大于 0，则尝试从之前的会话中恢复或者创建一个新的会话
    this._initializeSessionForSampling(previousSessionId);

    // 如果无法创建会话，记录异常并返回
    if (!this.session) {
      // This should not happen, something wrong has occurred
      DEBUG_BUILD &&
        logger.exception(new Error('Unable to initialize and create session'));
      return;
    }

    // 当前会话未被采样，避免处理未采样的会话
    if (this.session.sampled === false) {
      // 具体原因可能是 errorSampleRate 为 0，并且会话未进行错误采样。
      // 在这种情况下，代码立即返回，不执行任何操作。
      return;
    }

    // 录制模式的判断，依据 session.sampled 的值来决定
    // 如果 segmentId > 0，意味着此会话已经有部分数据被捕获，因此继续使用 session 模式进行全会话录制
    this.recordingMode =
      // 表示此会话是新的且尚未捕获任何数据，因此启用 buffer 模式
      this.session.sampled === 'buffer' && this.session.segmentId === 0
        ? 'buffer'
        : 'session';

    DEBUG_BUILD &&
      logger.infoTick(`Starting replay in ${this.recordingMode} mode`);

    this._initializeRecording();
  }

  /**
   * Start a replay regardless of sampling rate. Calling this will always
   * create a new session. Will log a message if replay is already in progress.
   *
   * Creates or loads a session, attaches listeners to varying events (DOM,
   * _performanceObserver, Recording, Sentry SDK, etc)
   */
  public start(): void {
    if (this._isEnabled && this.recordingMode === 'session') {
      DEBUG_BUILD && logger.info('Recording is already in progress');
      return;
    }

    if (this._isEnabled && this.recordingMode === 'buffer') {
      DEBUG_BUILD &&
        logger.info(
          'Buffering is in progress, call `flush()` to save the replay',
        );
      return;
    }

    DEBUG_BUILD && logger.infoTick('Starting replay in session mode');

    // Required as user activity is initially set in
    // constructor, so if `start()` is called after
    // session idle expiration, a replay will not be
    // created due to an idle timeout.
    this._updateUserActivity();

    const session = loadOrCreateSession(
      // 与会话生命周期相关的信息
      {
        // 最大会话回放持续时间
        maxReplayDuration: this._options.maxReplayDuration,
        // 会话在空闲多长时间后会过期
        sessionIdleExpire: this.timeouts.sessionIdleExpire,
      },
      // 控制会话行为
      {
        // 会话是否应该在不同页面刷新或者跳转时保持一致。
        stickySession: this._options.stickySession,
        // 这是有意的：在调用‘ start() ’时创建一个新的基于会话的重放
        // 控制会话的采样率，决定了采样的频率
        sessionSampleRate: 1,
        // 是否允许数据缓冲
        allowBuffering: false,
      },
    );

    this.session = session;

    this._initializeRecording();
  }

  /**
   * Start replay buffering. Buffers until `flush()` is called or, if
   * `replaysOnErrorSampleRate` > 0, an error occurs.
   */
  public startBuffering(): void {
    if (this._isEnabled) {
      DEBUG_BUILD &&
        logger.info(
          'Buffering is in progress, call `flush()` to save the replay',
        );
      return;
    }

    DEBUG_BUILD && logger.infoTick('Starting replay in buffer mode');

    const session = loadOrCreateSession(
      {
        sessionIdleExpire: this.timeouts.sessionIdleExpire,
        maxReplayDuration: this._options.maxReplayDuration,
      },
      {
        stickySession: this._options.stickySession,
        sessionSampleRate: 0,
        allowBuffering: true,
      },
    );

    this.session = session;

    this.recordingMode = 'buffer';
    this._initializeRecording();
  }

  /**
   * Start recording.
   *
   * Note that this will cause a new DOM checkout
   */
  public startRecording(): void {
    try {
      const canvasOptions = this._canvas;

      this._stopRecording = record({
        ...this._recordingOptions,
        // When running in error sampling mode, we need to overwrite `checkoutEveryNms`
        // Without this, it would record forever, until an error happens, which we don't want
        // instead, we'll always keep the last 60 seconds of replay before an error happened
        ...(this.recordingMode === 'buffer' && {
          checkoutEveryNms: BUFFER_CHECKOUT_TIME,
        }),
        emit: getHandleRecordingEmit(this),
        onMutation: this._onMutationHandler,
        ...(canvasOptions
          ? {
              recordCanvas: canvasOptions.recordCanvas,
              getCanvasManager: canvasOptions.getCanvasManager,
              sampling: canvasOptions.sampling,
              dataURLOptions: canvasOptions.dataURLOptions,
            }
          : {}),
      });
    } catch (err) {
      this.handleException(err);
    }
  }

  /**
   * Stops the recording, if it was running.
   *
   * Returns true if it was previously stopped, or is now stopped,
   * otherwise false.
   */
  public stopRecording(): boolean {
    try {
      if (this._stopRecording) {
        this._stopRecording();
        this._stopRecording = undefined;
      }

      return true;
    } catch (err) {
      this.handleException(err);
      return false;
    }
  }

  /**
   * Currently, this needs to be manually called (e.g. for tests). Sentry SDK
   * does not support a teardown
   */
  public async stop({
    forceFlush = false,
    reason,
  }: { forceFlush?: boolean; reason?: string } = {}): Promise<void> {
    if (!this._isEnabled) {
      return;
    }

    // We can't move `_isEnabled` after awaiting a flush, otherwise we can
    // enter into an infinite loop when `stop()` is called while flushing.
    this._isEnabled = false;

    try {
      DEBUG_BUILD &&
        logger.info(
          `Stopping Replay${reason ? ` triggered by ${reason}` : ''}`,
        );

      this._removeListeners();
      this.stopRecording();

      this._debouncedFlush.cancel();
      // See comment above re: `_isEnabled`, we "force" a flush, ignoring the
      // `_isEnabled` state of the plugin since it was disabled above.
      if (forceFlush) {
        await this._flush({ force: true });
      }

      // After flush, destroy event buffer
      this.eventBuffer && this.eventBuffer.destroy();
      this.eventBuffer = null;

      // Clear session from session storage, note this means if a new session
      // is started after, it will not have `previousSessionId`
      clearSession(this);
    } catch (err) {
      this.handleException(err);
    }
  }

  /**
   * Pause some replay functionality. See comments for `_isPaused`.
   * This differs from stop as this only stops DOM recording, it is
   * not as thorough of a shutdown as `stop()`.
   */
  public pause(): void {
    if (this._isPaused) {
      return;
    }

    this._isPaused = true;
    this.stopRecording();

    DEBUG_BUILD && logger.info('Pausing replay');
  }

  /**
   * Resumes recording, see notes for `pause().
   *
   * Note that calling `startRecording()` here will cause a
   * new DOM checkout.`
   */
  public resume(): void {
    if (!this._isPaused || !this._checkSession()) {
      return;
    }

    this._isPaused = false;
    this.startRecording();

    DEBUG_BUILD && logger.info('Resuming replay');
  }

  /**
   * If not in "session" recording mode, flush event buffer which will create a new replay.
   * Unless `continueRecording` is false, the replay will continue to record and
   * behave as a "session"-based replay.
   *
   * Otherwise, queue up a flush.
   */
  public async sendBufferedReplayOrFlush({
    continueRecording = true,
  }: SendBufferedReplayOptions = {}): Promise<void> {
    if (this.recordingMode === 'session') {
      return this.flushImmediate();
    }

    const activityTime = Date.now();

    DEBUG_BUILD && logger.info('Converting buffer to session');

    // Allow flush to complete before resuming as a session recording, otherwise
    // the checkout from `startRecording` may be included in the payload.
    // Prefer to keep the error replay as a separate (and smaller) segment
    // than the session replay.
    await this.flushImmediate();

    const hasStoppedRecording = this.stopRecording();

    if (!continueRecording || !hasStoppedRecording) {
      return;
    }

    // To avoid race conditions where this is called multiple times, we check here again that we are still buffering
    if ((this.recordingMode as ReplayRecordingMode) === 'session') {
      return;
    }

    // Re-start recording in session-mode
    this.recordingMode = 'session';

    // Once this session ends, we do not want to refresh it
    if (this.session) {
      this._updateUserActivity(activityTime);
      this._updateSessionActivity(activityTime);
      this._maybeSaveSession();
    }

    this.startRecording();
  }

  /**
   * 用于批量处理重放事件的上传,通过检测时间间隔和设置节流策略，避免频繁或立即触发数据上传
   *
   * 这里有两个条件：
   * 1. 只有在上一个事件之后经过了 <flushMinDelay> 毫秒后，才会保存新的事件
   * 这意味着如果事件产生得过于频繁，则不会立即上传，从而避免过多的网络请求
   *
   * 2. 如果自上一个事件以来已经超过了 <flushMaxDelay> 毫秒，无论是否还有新事件到来，都会保存当前的事件并进行上传。
   * 为了确保在某些情况下，即使没有新的事件，系统也能在合理的时间内进行上传，以避免数据丢失
   *
   * 接受一个回调函数 cb，该函数可以执行一些副作用（如更新状态或触发其他操作）
   * 如果回调函数返回 true，则会停止批量处理，并将控制权交还给调用者
   * 这允许调用者根据自己的逻辑决定是否继续处理批量事件
   */
  public addUpdate(cb: AddUpdateCallback): void {
    // We need to always run `cb` (e.g. in the case of `this.recordingMode == 'buffer'`)
    // 我们总是需要调用传入的回调
    const cbResult = cb();

    // buffer 模式应该是一种特殊的记录模式，可能是为了批量保存数据而不立即上传的机制
    // 如果当前记录模式为 buffer 直接返回
    if (this.recordingMode === 'buffer') {
      return;
    }

    //  回调返回的结果为 true，则方法终止，表示调用方不希望继续处理上传（flush），而由调用方自行处理上传逻辑
    if (cbResult === true) {
      return;
    }

    // 使用防抖来触发 flush 操作，防止频繁的上传操作
    this._debouncedFlush();
  }

  /**
   * Updates the user activity timestamp and resumes recording. This should be
   * called in an event handler for a user action that we consider as the user
   * being "active" (e.g. a mouse click).
   */
  public triggerUserActivity(): void {
    this._updateUserActivity();

    // This case means that recording was once stopped due to inactivity.
    // Ensure that recording is resumed.
    if (!this._stopRecording) {
      // Create a new session, otherwise when the user action is flushed, it
      // will get rejected due to an expired session.
      if (!this._checkSession()) {
        return;
      }

      // Note: This will cause a new DOM checkout
      this.resume();
      return;
    }

    // Otherwise... recording was never suspended, continue as normalish
    this.checkAndHandleExpiredSession();

    this._updateSessionActivity();
  }

  /**
   * Updates the user activity timestamp *without* resuming
   * recording. Some user events (e.g. keydown) can be create
   * low-value replays that only contain the keypress as a
   * breadcrumb. Instead this would require other events to
   * create a new replay after a session has expired.
   */
  public updateUserActivity(): void {
    this._updateUserActivity();
    this._updateSessionActivity();
  }

  /**
   * Only flush if `this.recordingMode === 'session'`
   */
  public conditionalFlush(): Promise<void> {
    if (this.recordingMode === 'buffer') {
      return Promise.resolve();
    }

    return this.flushImmediate();
  }

  /**
   * Flush using debounce flush
   */
  public flush(): Promise<void> {
    return this._debouncedFlush() as Promise<void>;
  }

  /**
   * Always flush via `_debouncedFlush` so that we do not have flushes triggered
   * from calling both `flush` and `_debouncedFlush`. Otherwise, there could be
   * cases of mulitple flushes happening closely together.
   */
  public flushImmediate(): Promise<void> {
    this._debouncedFlush();
    // `.flush` is provided by the debounced function, analogously to lodash.debounce
    return this._debouncedFlush.flush() as Promise<void>;
  }

  /**
   * Cancels queued up flushes.
   */
  public cancelFlush(): void {
    this._debouncedFlush.cancel();
  }

  /** Get the current sesion (=replay) ID */
  public getSessionId(): string | undefined {
    return this.session && this.session.id;
  }

  /**
   * 检查是否由于用户不活跃而应停止录制。否则检查会话是否过期，并在过期时创建新会话
   * 如果创建了新会话，会触发新的全量快照
   *
   * 如果会话未过期返回 true，否则返回 false。
   * @hidden
   */
  public checkAndHandleExpiredSession(): boolean | void {
    // 如果用户最后一次活动的时间超过了 SESSION_IDLE_PAUSE_DURATION，
    // 则不再启动新的会话，避免因非用户活动触发新会话和录制，导致不必要的回放
    if (
      this._lastActivity && // 判断用户是否有最近的活动
      // 检查用户是否空闲时间过长
      isExpired(this._lastActivity, this.timeouts.sessionIdlePause) &&
      this.session && // 检查当前是否有会话
      this.session.sampled === 'session' // 会话是否是基于 session 记录的
    ) {
      // 仅对基于 session 的回放暂停录制。
      // 否则，恢复录制时将创建一个新的回放，
      // 并且会与仅选择记录错误回放的用户产生冲突。
      // （例如，恢复的回放将不包含对错误的引用）
      /**
       * 1. 基于会话的回放 (Session-based replays)：
       *  - 基于 session 的回放，指的是那些持续记录用户行为的回放机制，
       *  通常是为了捕获用户在页面上的所有交互，并保存整个会话的回放。
       *  - 对于这种回放，当用户的会话进入空闲状态（例如用户离开页面或长时间没有活动），
       *  可以暂停录制以节省资源。在用户重新活跃时，可以恢复录制并继续同一个会话。
       *
       * 2. 基于错误的回放 (Error-based replays)：
       *  - 基于错误的回放意味着只有当系统检测到某些特定的事件（如 JavaScript 错误、崩溃等）时才会开始记录用户行为的回放
       *  - 这种机制下，不会始终记录用户的交互，而是专门为了错误场景而进行回放记录
       *
       * 3. 暂停逻辑：
       *  - 当系统检测到用户长时间没有活动时，出于性能和存储的考虑，会暂停基于会话的回放
       *  - 但是系统会避免在基于错误的回放中暂停，因为这种回放模式只在特定情况下（如错误发生）触发。
       *  如果错误发生后再重新启动回放，会与之前的错误回放冲突，并且新的回放中可能没有包含对先前错误的引用或记录。
       *
       * 4. 冲突场景：
       *  - 如果系统不正确地区分这两种回放机制，在恢复录制时可能会生成一个新的会话回放，
       *  而这个新回放与之前的错误没有关联，从而导致录制的回放数据不完整或失效。
       *  - 举个例子，如果用户的会话暂停了，但在错误模式下重新恢复录制，
       *  系统可能不会捕捉到错误前发生的关键上下文，这就会导致回放的有效性降低
       *
       */
      // 只针对 session-based replay 暂停录制，避免非错误回放模式下的录制冲突
      this.pause();
      return;
    }

    // --- 用户最近有活动 --- //
    // 检查会话是否过期，若过期则创建新会话
    if (!this._checkSession()) {
      // _checkSession 方法内部会处理会话的刷新
      return false;
    }

    return true;
  }

  /**
   * 函数的目的是在回放的生命周期开始时捕获一些初始状态
   * 这些状态信息在回放过程中可能会发生变化，因此需要在录制开始时就进行捕获，而不是在第一次刷新时
   * 这对于确保录制的完整性和准确性非常重要
   */
  public setInitialState(): void {
    // 捕获当前的url
    /**
     * pathname：当前页面的路径（例如 /example/path）
     * hash：URL 中的锚点部分（例如 #section） /example/path）
     * search：URL 中的查询字符串部分（例如 ?query=1）
     */
    const urlPath = `${WINDOW.location.pathname}${WINDOW.location.hash}${WINDOW.location.search}`;
    // 组合成完整的 URL，包括协议、主机名和路径部分
    const url = `${WINDOW.location.origin}${urlPath}`;

    // 存储性能相关的条目，重置为空数组以准备收集新数据
    this.performanceEntries = [];
    // 存储在回放过程中收集的性能条目，重置为空数组
    this.replayPerformanceEntries = [];

    // 重置或清理之前的上下文状态
    // 上下文中可能存储了一些与会话相关的信息，重置是为了确保新会话的上下文不会受到之前会话数据的影响
    this._clearContext();

    // 将捕获到的初始 URL 存储到上下文中，方便后续访问和记录
    this._context.initialUrl = url;
    // 记录当前时间戳，表示回放开始的时间，可能在后续分析性能或回放数据时使用
    this._context.initialTimestamp = Date.now();
    // 将初始 URL 添加到 urls 数组中，便于在回放过程中跟踪和分析
    this._context.urls.push(url);
  }

  /**
   * 负责添加 RecordingEvent（录制事件），并对事件的添加过程进行节流控制
   * 如果事件被节流（throttled），则会添加一个自定义的面包屑（breadcrumb）来标记事件被跳过
   */
  public throttledAddEvent(
    event: RecordingEvent,
    isCheckout?: boolean,
  ): typeof THROTTLED | typeof SKIPPED | Promise<AddEventResult | null> {
    const res = this._throttledAddEvent(event, isCheckout);

    // 检查 res 是否等于 THROTTLED，如果是则说明该事件被节流了
    // 节流意味着当前的事件流量超过了预设限制，这里需要记录下这个现象
    if (res === THROTTLED) {
      // 表示事件节流的信息，用于标记节流事件
      const breadcrumb = createBreadcrumb({
        category: 'replay.throttled',
      });

      this.addUpdate(() => {
        // 同步的添加一个自定义事件
        // 成功添加了事件，则返回 false，以表示成功添加后，可能需要安排一次刷新（flush）操作
        return !addEventSync(this, {
          type: ReplayEventTypeCustom,
          timestamp: breadcrumb.timestamp || 0,
          data: {
            tag: 'breadcrumb',
            payload: breadcrumb,
            metric: true,
          },
        });
      });
    }

    // 如果事件没有被节流，它可能返回添加事件的结果，或者一个 Promise
    return res;
  }

  /**
   * This will get the parametrized route name of the current page.
   * This is only available if performance is enabled, and if an instrumented router is used.
   */
  public getCurrentRoute(): string | undefined {
    const lastActiveSpan = this.lastActiveSpan || getActiveSpan();
    const lastRootSpan = lastActiveSpan && getRootSpan(lastActiveSpan);

    const attributes = (lastRootSpan && spanToJSON(lastRootSpan).data) || {};
    const source = attributes[SEMANTIC_ATTRIBUTE_SENTRY_SOURCE];
    if (!lastRootSpan || !source || !['route', 'custom'].includes(source)) {
      return undefined;
    }

    return spanToJSON(lastRootSpan).description;
  }

  /**
   * 用于初始化并开始监听各种事件（例如 DOM 事件、性能观察器、录制操作、Sentry SDK 等）
   * 这是录制功能启动时的关键步骤，通常在页面加载时或手动调用时触发
   */
  private _initializeRecording(): void {
    // 设置初始状态。此方法可能用于清理或重置某些内部状态，使系统处于准备录制的状态。
    this.setInitialState();

    // 将此方法的调用视为一次用户活动
    // 因为 _initializeRecording 通常在页面加载时触发，而页面加载时应该被视为一次用户活动，
    // 因此会更新会话的活动时间。这样有助于防止会话在刚启动时被认为已过期。
    this._updateSessionActivity();

    // 创建一个事件缓冲区
    this.eventBuffer = createEventBuffer({
      useCompression: this._options.useCompression, // 是否使用压缩来减小事件数据的大小
      workerUrl: this._options.workerUrl, // Web Worker 的 URL，用于处理数据的缓冲和压缩
    });

    // 移除之前可能已添加的事件监听器，避免重复绑定
    this._removeListeners();

    // 绑定新的事件监听器，开始监听各种事件，如 DOM 变化、用户交互、性能数据等
    this._addListeners();

    /**
     * 调用 startRecording() 是启动录制的关键步骤。然而，record() 方法可能会立即触发一些重要操作，
     * 比如将当前收集到的事件数据进行 "flush"（刷新）——这意味着将缓冲区中的事件数据提交或保存下来。
     *
     * - Flush：在这里，"flush" 指的是将缓冲区中的数据提交或清空。如果没有设置为启用，缓冲区可能没有数据或无法执行刷新操作
     * - New checkout：指的是在录制过程中，可能会定期创建新的 "检查点"（checkout），用来标记一个新的录制片段或会话开始。
     * 如果录制状态未被启用，新的 "检查点" 可能无法正确生成或保存
     */

    // 录制功能已启用
    this._isEnabled = true;
    // 录制没有被暂停
    this._isPaused = false;

    // 正式开始录制，启动核心录制逻辑，捕获用户的行为、页面的状态变化等
    this.startRecording();
  }

  /**
   * 用于加载或刷新当前会话,主要用于采样错误和会话信息，并决定是否允许对会话进行缓冲
   *
   * @param previousSessionId 上一次会话的 ID,用于恢复某个会话或在刷新时保持会话的连续性
   */
  private _initializeSessionForSampling(previousSessionId?: string): void {
    // 如果存在任何错误采样率，系统需要持续缓冲数据，因为采样是基于错误发生时决定的。
    // 为了确保能够采样错误事件，需要在错误发生之前一直保持数据的缓冲
    /** 是否允许会话缓冲 */
    const allowBuffering = this._options.errorSampleRate > 0;

    // 加载或创建会话
    const session = loadOrCreateSession(
      {
        sessionIdleExpire: this.timeouts.sessionIdleExpire,
        maxReplayDuration: this._options.maxReplayDuration,
        previousSessionId,
      },
      {
        stickySession: this._options.stickySession,
        sessionSampleRate: this._options.sessionSampleRate,
        allowBuffering,
      },
    );

    // 将生成的会话保存到当前实例中
    this.session = session;
  }

  /**
   * Checks and potentially refreshes the current session.
   * Returns false if session is not recorded.
   */
  private _checkSession(): boolean {
    // If there is no session yet, we do not want to refresh anything
    // This should generally not happen, but to be safe....
    if (!this.session) {
      return false;
    }

    const currentSession = this.session;

    if (
      shouldRefreshSession(currentSession, {
        sessionIdleExpire: this.timeouts.sessionIdleExpire,
        maxReplayDuration: this._options.maxReplayDuration,
      })
    ) {
      // This should never reject
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this._refreshSession(currentSession);
      return false;
    }

    return true;
  }

  /**
   * Refresh a session with a new one.
   * This stops the current session (without forcing a flush, as that would never work since we are expired),
   * and then does a new sampling based on the refreshed session.
   */
  private async _refreshSession(session: Session): Promise<void> {
    if (!this._isEnabled) {
      return;
    }
    await this.stop({ reason: 'refresh session' });
    this.initializeSampling(session.id);
  }

  /**
   * Adds listeners to record events for the replay
   */
  private _addListeners(): void {
    try {
      WINDOW.document.addEventListener(
        'visibilitychange',
        this._handleVisibilityChange,
      );
      WINDOW.addEventListener('blur', this._handleWindowBlur);
      WINDOW.addEventListener('focus', this._handleWindowFocus);
      WINDOW.addEventListener('keydown', this._handleKeyboardEvent);

      if (this.clickDetector) {
        this.clickDetector.addListeners();
      }

      // There is no way to remove these listeners, so ensure they are only added once
      if (!this._hasInitializedCoreListeners) {
        addGlobalListeners(this);

        this._hasInitializedCoreListeners = true;
      }
    } catch (err) {
      this.handleException(err);
    }

    this._performanceCleanupCallback = setupPerformanceObserver(this);
  }

  /**
   * 用于取消之前添加的事件监听器，确保不会有不必要的事件处理，从而避免内存泄漏或意外的事件触发
   */
  private _removeListeners(): void {
    try {
      // 移除浏览器上的可见性变化事件
      WINDOW.document.removeEventListener(
        'visibilitychange',
        this._handleVisibilityChange,
      );

      // 移除 失焦、聚焦、键盘事件
      WINDOW.removeEventListener('blur', this._handleWindowBlur);
      WINDOW.removeEventListener('focus', this._handleWindowFocus);
      WINDOW.removeEventListener('keydown', this._handleKeyboardEvent);

      // 清理 clickDetector 自己的监听器
      if (this.clickDetector) {
        this.clickDetector.removeListeners();
      }

      // 清理性能相关的回调，比如停止性能监控、日志记录等
      if (this._performanceCleanupCallback) {
        this._performanceCleanupCallback();
      }
    } catch (err) {
      // 发生错误，捕获异常
      this.handleException(err);
    }
  }

  /**
   * 处理页面可见性变化。
   * 当打开一个新标签页时，当前页面的内容会被隐藏，状态会变为 hidden
   * 类似地，当另一个窗口覆盖当前页面内容时，也会触发状态变为 hidden
   */
  private _handleVisibilityChange: () => void = () => {
    // 判断页面当前的可见性状态
    if (WINDOW.document.visibilityState === 'visible') {
      // 页面可见，执行进入前台的任务
      this._doChangeToForegroundTasks();
    } else {
      // 页面不可见，执行进入后台的任务
      this._doChangeToBackgroundTasks();
    }
  };

  /**
   * 在页面失去焦点时（blur 事件）被触发
   */
  private _handleWindowBlur: () => void = () => {
    // 创建面包屑，用来标记用户离开页面的时间点
    const breadcrumb = createBreadcrumb({
      category: 'ui.blur',
    });

    // 将用户的状态从前台切换到后台，但不会将 blur 视为用户动作，因为这是自然离开页面的过程
    this._doChangeToBackgroundTasks(breadcrumb);
  };

  /**
   * 当页面重新获得焦点时（focus 事件）触发，表示用户回到了当前页面或标签
   */
  private _handleWindowFocus: () => void = () => {
    // 创建面包屑，标记页面重新获得焦点
    const breadcrumb = createBreadcrumb({
      category: 'ui.focus',
    });

    // 处理页面切换回前台的逻辑，但不将 focus 视为用户的交互动作，
    // 只有当用户在 focus 之后与页面交互时，才会认为有了新的动作
    this._doChangeToForegroundTasks(breadcrumb);
  };

  /** 确保当用户按下键盘时，页面的活动状态能被正确记录*/
  private _handleKeyboardEvent: (event: KeyboardEvent) => void = (
    event: KeyboardEvent,
  ) => {
    handleKeyboardEvent(this, event);
  };

  /**
   * 主要用于处理进入“后台”时需要执行的任务逻，会处理会话的有效性检查、记录面包屑日志以及触发回放（replay）功能
   * Tasks to run when we consider a page to be hidden (via blurring and/or visibility)
   */
  private _doChangeToBackgroundTasks(breadcrumb?: ReplayBreadcrumbFrame): void {
    // 不存在会话直接返回
    if (!this.session) {
      return;
    }

    // 检查会话是否已经过期
    const expired = isSessionExpired(this.session, {
      maxReplayDuration: this._options.maxReplayDuration, // 最大回放时长
      sessionIdleExpire: this.timeouts.sessionIdleExpire, // 会话空闲过期时间
    });

    // 如果会话已过期，直接返回
    if (expired) {
      return;
    }

    // 如果有 breadcrumb（面包屑），创建自定义面包屑
    if (breadcrumb) {
      this._createCustomBreadcrumb(breadcrumb);
    }

    // 当页面或标签页被隐藏时，发送回放数据。没有必要在页面变得可见时发送，
    // 因为在页面隐藏时没有需要记录的动作。
    // 这部分逻辑应该不会出现 reject 异常
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    // void 表示忽略返回的promise 即使它执行过程中可能会抛出异常，也不会中断整个流程。
    // 这是一种简化的异步操作，通常用于那些几乎不会失败的操作。
    void this.conditionalFlush();
  }

  /**
   * 通过页面获得焦点或可见性变化来判断
   * 目的是在页面重新可见时处理会话状态，并可能记录某些用户行为（breadcrumb）
   */
  private _doChangeToForegroundTasks(breadcrumb?: ReplayBreadcrumbFrame): void {
    // 如果没有会话，直接返回
    if (!this.session) {
      return;
    }

    // 检查会话是否过期并处理过期会话
    const isSessionActive = this.checkAndHandleExpiredSession();

    if (!isSessionActive) {
      // 如果用户在会话空闲时间 (SESSION_IDLE_PAUSE_DURATION) 内返回页面，
      // 则会继续使用现有的会话，否则创建一个新的会话
      DEBUG_BUILD &&
        logger.info('Document has become active, but session has expired');
      return;
    }

    // 如果有 breadcrumb（面包屑），创建自定义面包屑记录
    if (breadcrumb) {
      this._createCustomBreadcrumb(breadcrumb);
    }
  }

  /**
   * Update user activity (across session lifespans)
   */
  private _updateUserActivity(_lastActivity: number = Date.now()): void {
    this._lastActivity = _lastActivity;
  }

  /**
   * 更新会话的最后活动时间
   */
  private _updateSessionActivity(_lastActivity: number = Date.now()): void {
    if (this.session) {
      this.session.lastActivity = _lastActivity;
      // 保存会话数据
      this._maybeSaveSession();
    }
  }

  /**
   * 用于将核心 SDK 的 “breadcrumb”（面包屑）转换为“重放”功能的自定义面包屑，并将其缓存在系统中
   */
  private _createCustomBreadcrumb(breadcrumb: ReplayBreadcrumbFrame): void {
    // 这里通过节流和缓冲操作来避免过多的资源消耗

    // 负责记录或者缓冲更新操作的一个函数
    this.addUpdate(() => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      // 节流函数
      this.throttledAddEvent({
        type: EventType.Custom,
        timestamp: breadcrumb.timestamp || 0,
        data: {
          tag: 'breadcrumb',
          payload: breadcrumb,
        },
      });

      // 整个方法的主要功能是处理面包屑事件，将其包装成一个重放事件，并通过系统进行记录或缓冲
    });
  }

  /**
   * Observed performance events are added to `this.performanceEntries`. These
   * are included in the replay event before it is finished and sent to Sentry.
   */
  private _addPerformanceEntries(): Promise<Array<AddEventResult | null>> {
    const performanceEntries = createPerformanceEntries(
      this.performanceEntries,
    ).concat(this.replayPerformanceEntries);

    this.performanceEntries = [];
    this.replayPerformanceEntries = [];

    return Promise.all(createPerformanceSpans(this, performanceEntries));
  }

  /**
   * Clear _context
   */
  private _clearContext(): void {
    // XXX: `initialTimestamp` and `initialUrl` do not get cleared
    this._context.errorIds.clear();
    this._context.traceIds.clear();
    this._context.urls = [];
  }

  /** Update the initial timestamp based on the buffer content. */
  private _updateInitialTimestampFromEventBuffer(): void {
    const { session, eventBuffer } = this;
    // If replay was started manually (=no sample rate was given),
    // We do not want to back-port the initial timestamp
    if (!session || !eventBuffer || this._requiresManualStart) {
      return;
    }

    // we only ever update this on the initial segment
    if (session.segmentId) {
      return;
    }

    const earliestEvent = eventBuffer.getEarliestTimestamp();
    if (earliestEvent && earliestEvent < this._context.initialTimestamp) {
      this._context.initialTimestamp = earliestEvent;
    }
  }

  /**
   * Return and clear _context
   */
  private _popEventContext(): PopEventContext {
    const _context = {
      initialTimestamp: this._context.initialTimestamp,
      initialUrl: this._context.initialUrl,
      errorIds: Array.from(this._context.errorIds),
      traceIds: Array.from(this._context.traceIds),
      urls: this._context.urls,
    };

    this._clearContext();

    return _context;
  }

  /**
   *
   * 用于将录制的重放事件缓冲区的数据发送到 Sentry
   * 性能事件仅在刷新前添加，因为这些事件是通过性能观察器缓冲的
   *
   * 该方法应仅通过 flush 调用，而不应直接调用
   */
  private async _runFlush(): Promise<void> {
    // 获取当前会话的重放 ID
    const replayId = this.getSessionId();

    // 确保会话、事件缓冲区、重放id 存在
    if (!this.session || !this.eventBuffer || !replayId) {
      DEBUG_BUILD && logger.error('No session or eventBuffer found to flush.');
      return;
    }

    // 添加性能事件条目
    await this._addPerformanceEntries();

    // 再次检查事件缓冲区，以确保它没有被停止且仍然有事件可发送
    if (!this.eventBuffer || !this.eventBuffer.hasEvents) {
      return;
    }

    // 如果事件缓冲区不为空，则添加内存事件
    await addMemoryEntry(this);

    // 再次检查 eventBuffer，因为它可以在此期间停止
    if (!this.eventBuffer) {
      return;
    }

    // 如果重放 ID 已改变（例如会话已刷新），则中止当前操作
    if (replayId !== this.getSessionId()) {
      return;
    }

    try {
      // 当前的操作依赖于从事件缓冲区 (eventBuffer) 中提取的数据，因此必须在调用 finish() 方法之前执行
      // 这是因为一旦调用 finish()，事件缓冲区将被清空或重置，从而无法再获取数据。
      // 更新事件缓冲区的初始时间戳
      this._updateInitialTimestampFromEventBuffer();

      // 获取当前时间以用于记录持续时间
      const timestamp = Date.now();

      /**
       * 检查当前会话的持续时间，以确保不会发送过期的数据或持续时间超出预期范围的重放
       *
       * （30秒）是一个额外的冗余时间，用于处理可能的延迟，比如浏览器在执行刷新操作期间被挂起
       * 这确保在短时间内的数据发送失败不会导致过期的数据被发送。
       */
      if (
        // 计算当前时间戳与会话初始时间戳之间的差值，这个值表示会话的持续时间
        timestamp - this._context.initialTimestamp >
        // 最大重放持续时间的配置项，定义了允许的最长会话持续时间，这里加上30秒是一个额外的冗余时间
        this._options.maxReplayDuration + 30_000
      ) {
        throw new Error('Session is too long, not sending replay');
      }

      // 获取当前事件的上下文
      const eventContext = this._popEventContext();
      // 会将当前会话的 segmentId 增加 1，并将新的值赋给 segmentId 变量
      // 无论发送重放事件的结果如何，都会增加 segmentId，这表明一个新的事件段已经开始
      // 这样做是为了确保每次发送重放数据时都有唯一的标识符，方便后续的追踪和管理
      const segmentId = this.session.segmentId++;

      // 根据当前的会话状态决定是否保存会话信息
      this._maybeSaveSession();

      // 调用缓冲区的 finish 这会清空缓冲区数据
      // finish 方法通常会将当前缓冲的事件数据处理完并返回这些数据
      // 重要的是，这个操作将会清空事件缓冲区（即即使发送重放失败，缓冲区也会被清空）这有助于避免重复发送相同的数据。
      const recordingData = await this.eventBuffer.finish();

      await sendReplay({
        replayId,
        recordingData,
        segmentId,
        eventContext,
        session: this.session,
        options: this.getOptions(),
        timestamp,
      });
    } catch (err) {
      // 捕获错误
      this.handleException(err);

      /**
       * sendReplay 会将数据发送到 sentry，在失败时会重试（三次）
       *
       * 进入到 catch 这意味着我们重试了3次，但都失败了
       * 或者遇到了不希望重试的错误，例如速率限制（rate limiting）
       *  - 速率限制是一种保护机制，用于防止过多的请求发送到服务器，从而避免过载。
       *  在这种情况下，继续尝试发送重放数据可能会造成更多的错误或服务的进一步拒绝
       *
       * 在遇到上述两种情况时，应该停止重放的原因，以避免产生不一致的事件段
       */
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      // 停止重放的过程，并传递一个原因，说明停止的原因是发送重放时出错
      this.stop({ reason: 'sendReplay' });

      const client = getClient();

      // 记录一个丢弃的事件，说明重放发送时发生了错误。
      // 有助于监控系统的健康状况，开发者可以通过查看丢弃事件的日志，了解在何种情况下重放数据没有成功发送。
      if (client) {
        client.recordDroppedEvent('send_error', 'replay');
      }
    }
  }

  /**
   * 将录制的数据刷新（上传）到 Sentry，该方法实现了一个锁机制，
   * 以确保在任何时刻，只能有一个刷新操作在进行，避免了并发冲突，确保数据的一致性
   *
   * 该方法不应被外部直接调用，应该通过其他公开方法间接调用
   */
  private _flush = async ({
    force = false,
  }: {
    /**
     * 如果 force 参数的值为 true，则在执行刷新操作时，将忽略 _isEnabled 状态。
     * 这意味着，即使重放集成当前处于禁用状态，也会执行刷新操作。
     * 这在某些特殊情况下非常有用，比如开发调试或需要强制发送数据时，即使系统的正常工作状态表明不应进行刷新
     *
     * 默认情况下，如果重放集成处于停止状态，则刷新操作不会执行（即没有效果）
     * 它提供了一种机制来绕过常规的状态检查，以便在特定情况下强制执行操作
     */
    force?: boolean;
  } = {}): Promise<void> => {
    // 如果 Replay 集成未启用且未强制刷新，则直接返回
    // 意味着在正常情况下，只有当集成处于启用状态时，才能执行刷新操作
    if (!this._isEnabled && !force) {
      // 如果重播因为超过重试限制而停止，则可能发生这种情况
      return;
    }

    // 检查会话是否过期，如果会话已经过期，则记录错误并返回
    if (!this.checkAndHandleExpiredSession()) {
      DEBUG_BUILD &&
        logger.error(
          'Attempting to finish replay event after session expired.',
        );
      return;
    }

    // 如果没有活动的会话，直接返回
    if (!this.session) {
      // 不应该发生这种情况，因为我们之前就会退出
      return;
    }

    // 获取会话的开始时间和计算会话的持续时间
    const start = this.session.started;
    const now = Date.now();
    const duration = now - start;

    // 在即将执行刷新操作之前，取消任何已排队的刷新操作，以避免多次重复刷新
    this._debouncedFlush.cancel();

    // 如果会话时间过短或过长，则不发送重放事件。
    // 这一逻辑保证了只有在合适的会话长度下才会发送数据，避免发送无效的或冗余的重放数据
    const tooShort = duration < this._options.minReplayDuration;
    const tooLong = duration > this._options.maxReplayDuration + 5_000;
    if (tooShort || tooLong) {
      DEBUG_BUILD &&
        logger.info(
          `Session duration (${Math.floor(duration / 1000)}s) is too ${
            tooShort ? 'short' : 'long'
          }, not sending replay.`,
        );

      if (tooShort) {
        this._debouncedFlush();
      }
      return;
    }

    // 获取缓冲区
    const eventBuffer = this.eventBuffer;
    if (
      eventBuffer &&
      // 当前会话的段 ID 是否为 0（通常表示这是一个新的会话段）
      this.session.segmentId === 0 &&
      // 事件缓冲区中是否没有“checkout”事件 快照
      !eventBuffer.hasCheckout
    ) {
      // 记录提示，正则上传且没有快照
      DEBUG_BUILD && logger.info('Flushing initial segment without checkout.');
      // TODO FN: Evaluate if we want to stop here, or remove this again?
      // 在未来评估是否在这种情况下停止处理，或者是否需要移除这段逻辑
    }

    // 检查 _flushLock 是否存在，_flushLock 是一个锁，用于确保在某个时间点只能有一个刷新操作进行
    // 直到这个promise 被完成
    if (!this._flushLock) {
      this._flushLock = this._runFlush();
      // 等待刷新完
      await this._flushLock;
      // 释放锁
      this._flushLock = undefined;
      return;
    }

    /**
     * 在执行新的刷新操作之前，等待之前的刷新操作完成。
     * - 确保不会同时有多个刷新操作在进行，从而避免数据混乱或重复上传
     *
     * 可能会有其他的刷新请求排队等候之前的刷新操作完成
     * - 表示系统中可能有多个刷新请求在不同的时间发起，但这些请求必须依次进行处理。
     *
     * 将所有未完成的刷新请求（以及在之前的刷新操作完成的一秒钟内发起的新刷新请求）合并为一次刷新操作
     * - 通过将多个请求合并为一次，减少对网络和服务器的压力，优化性能，避免不必要的重复上传。
     * 这种机制确保只有在必要的情况下才会发送数据，从而提高效率
     */

    try {
      // 走到这说明已有的刷新正在进行，
      await this._flushLock;
    } catch (err) {
      DEBUG_BUILD && logger.error(err);
    } finally {
      // 尝试进行下一次刷新
      this._debouncedFlush();
    }
  };

  /** 在会话为 sticky 时保存会话信息 */
  private _maybeSaveSession(): void {
    if (this.session && this._options.stickySession) {
      saveSession(this.session);
    }
  }

  /** Handler for rrweb.record.onMutation */
  private _onMutationHandler = (mutations: unknown[]): boolean => {
    const count = mutations.length;

    const mutationLimit = this._options.mutationLimit;
    const mutationBreadcrumbLimit = this._options.mutationBreadcrumbLimit;
    const overMutationLimit = mutationLimit && count > mutationLimit;

    // Create a breadcrumb if a lot of mutations happen at the same time
    // We can show this in the UI as an information with potential performance improvements
    if (count > mutationBreadcrumbLimit || overMutationLimit) {
      const breadcrumb = createBreadcrumb({
        category: 'replay.mutations',
        data: {
          count,
          limit: overMutationLimit,
        },
      });
      this._createCustomBreadcrumb(breadcrumb);
    }

    // Stop replay if over the mutation limit
    if (overMutationLimit) {
      // This should never reject
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.stop({
        reason: 'mutationLimit',
        forceFlush: this.recordingMode === 'session',
      });
      return false;
    }

    // `true` means we use the regular mutation handling by rrweb
    return true;
  };
}
