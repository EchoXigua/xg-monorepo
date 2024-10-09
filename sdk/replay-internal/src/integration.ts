import { parseSampleRate } from '@xigua-monitor/core';
import type {
  BrowserClientReplayOptions,
  Client,
  Integration,
  IntegrationFn,
} from '@xigua-monitor/types';
import {
  consoleSandbox,
  dropUndefinedKeys,
  isBrowser,
} from '@xigua-monitor/utils';

import {
  DEFAULT_FLUSH_MAX_DELAY,
  DEFAULT_FLUSH_MIN_DELAY,
  MAX_REPLAY_DURATION,
  MIN_REPLAY_DURATION,
  MIN_REPLAY_DURATION_LIMIT,
} from './constants';
import { ReplayContainer } from './replay';
import type {
  InitialReplayPluginOptions,
  RecordingOptions,
  ReplayCanvasIntegrationOptions,
  ReplayConfiguration,
  ReplayPluginOptions,
  SendBufferedReplayOptions,
} from './types';
import { getPrivacyOptions } from './util/getPrivacyOptions';
import { maskAttribute } from './util/maskAttribute';

const MEDIA_SELECTORS =
  'img,image,svg,video,object,picture,embed,map,audio,link[rel="icon"],link[rel="apple-touch-icon"]';

const DEFAULT_NETWORK_HEADERS = ['content-length', 'content-type', 'accept'];

let _initialized = false;

/**
 * Sentry integration for [Session Replay](https://sentry.io/for/session-replay/).
 *
 * See the [Replay documentation](https://docs.sentry.io/platforms/javascript/guides/session-replay/) for more information.
 *
 * @example
 *
 * ```
 * Sentry.init({
 *   dsn: '__DSN__',
 *   integrations: [Sentry.replayIntegration()],
 * });
 * ```
 */
export const replayIntegration = ((options?: ReplayConfiguration) => {
  return new Replay(options);
}) satisfies IntegrationFn;

/**
 * 用于在前端应用中捕获用户会话回放，以便在调试和分析时复现用户的行为，帮助开发者了解问题发生的具体过程
 * 通过捕获并记录用户的会话数据（例如 DOM 变更、网络请求等）来帮助开发者复现用户操作，并结合错误日志更好地定位问题
 *
 * 待办事项：将代码重写为函数集成方式
 * 用于测试
 */
export class Replay implements Integration {
  /**
   * @inheritDoc
   */
  public static id: string = 'Replay';

  /**
   * @inheritDoc
   */
  public name: string;

  /**
   * 传递给 rrweb.record() 的选项,rrweb 是用于记录用户操作的库
   * 可以自定义记录内容，例如是否遮盖输入框内容、是否捕获字体等
   */
  private readonly _recordingOptions: RecordingOptions;

  /**
   * 初始化时的选项，这些选项定义了回放的各种配置，例如
   * 是否压缩数据 (useCompression)、是否记录所有媒体元素 (blockAllMedia)、网络请求的捕获配置等
   * 注意：sessionSampleRate 和 errorSampleRate 在这里不是必须的，
   * 因为它们只有在调用setupOnce()时才能最终设置。
   *
   * @private
   */
  private readonly _initialOptions: InitialReplayPluginOptions;

  private _replay?: ReplayContainer;

  /**
   * 初始化 replay 通过 options 可以控制 replay 的行为
   * @param param0
   */
  public constructor({
    // 发送回放数据的最小延迟
    flushMinDelay = DEFAULT_FLUSH_MIN_DELAY,
    // 发送回放数据的最大延迟
    flushMaxDelay = DEFAULT_FLUSH_MAX_DELAY,
    // 指定最小回放时长
    minReplayDuration = MIN_REPLAY_DURATION,
    // 指定最大回放时长
    maxReplayDuration = MAX_REPLAY_DURATION,
    // 是否在多个页面之间保持同一会话，默认值是 true，用于在多页面应用中保持回放连续性
    stickySession = true,
    // 启用数据压缩，用于减少网络传输的数据大小
    useCompression = true,
    // 用于 Replay 处理的 Web Worker URL
    workerUrl,
    _experiments = {},
    // 隐藏页面上的所有文本内容以保护隐私
    maskAllText = true,
    // 隐藏页面上所有输入字段内容，尤其是敏感信息（如密码）
    maskAllInputs = true,
    // 用于阻止页面上的所有媒体元素（如视频、音频），以减少回放的带宽和存储消耗
    blockAllMedia = true,

    // DOM 变更记录的限制，默认为 750，防止过多变更日志影响性能
    mutationBreadcrumbLimit = 750,
    // DOM 变更的限制，默认为 10_000，超过该限制后不再记录额外的变更
    mutationLimit = 10_000,

    // 慢点击”操作的时间阈值
    slowClickTimeout = 7_000,
    // 指定忽略慢点击检测的选择器数组。
    slowClickIgnoreSelectors = [],

    // 捕获详细网络信息的 URL 列表
    networkDetailAllowUrls = [],
    // 忽略的 URL 列表
    networkDetailDenyUrls = [],
    // 是否捕获网络请求和响应的内容主体
    networkCaptureBodies = true,
    // 设置捕获的请求头部信息
    networkRequestHeaders = [],
    // 设置捕获的响应头部信息
    networkResponseHeaders = [],

    // 用于配置隐私策略，如指定应屏蔽或忽略的元素或属性
    mask = [],
    maskAttributes = ['title', 'placeholder'],
    unmask = [],
    block = [],
    unblock = [],
    ignore = [],

    // 自定义屏蔽函数，用于自定义如何屏蔽输入和文本
    maskFn,

    // 在录制事件添加之前的回调
    beforeAddRecordingEvent,
    // 错误采样之前的回调
    beforeErrorSampling,
  }: ReplayConfiguration = {}) {
    this.name = Replay.id;

    // 生成隐私选项，控制哪些元素或属性应被屏蔽、显示或忽略，从而保护用户隐私
    const privacyOptions = getPrivacyOptions({
      mask,
      unmask,
      block,
      unblock,
      ignore,
    });

    // 设置录制选项
    this._recordingOptions = {
      maskAllInputs, // 隐藏所有输入框
      maskAllText, // 隐藏所有文本内容
      maskInputOptions: { password: true }, // 专门针对密码输入框设置，确保密码不会被录制

      // 自定义的屏蔽函数，用于自定义如何屏蔽文本和输入
      maskTextFn: maskFn,
      maskInputFn: maskFn,

      // 屏蔽特定元素的属性值（如 title 和 placeholder），以保护隐私
      maskAttributeFn: (key: string, value: string, el: HTMLElement): string =>
        maskAttribute({
          maskAttributes,
          maskAllText,
          privacyOptions,
          key,
          value,
          el,
        }),

      ...privacyOptions,

      // 表示对 DOM 进行瘦化处理，去除不必要的节点，以减少录制数据的体积。
      slimDOMOptions: 'all',
      // 控制是否内联样式表和图片。
      inlineStylesheet: true,
      // 内联图片会增加录制数据的大小，因此默认关闭内联图片
      inlineImages: false,
      // 是否收集字体，但需要确保回放时允许 sentry.io 域名
      collectFonts: true,

      // 处理录制时的错误，将错误标记为 __rrweb__，防止某些不可变对象抛出异常
      errorHandler: (err: Error & { __rrweb__?: boolean }) => {
        try {
          err.__rrweb__ = true;
        } catch (error) {
          // ignore errors here
          // this can happen if the error is frozen or does not allow mutation for other reasons
        }
      },
    };

    this._initialOptions = {
      flushMinDelay,
      flushMaxDelay,
      minReplayDuration: Math.min(minReplayDuration, MIN_REPLAY_DURATION_LIMIT),
      maxReplayDuration: Math.min(maxReplayDuration, MAX_REPLAY_DURATION),
      stickySession,
      useCompression,
      workerUrl,
      blockAllMedia,
      maskAllInputs,
      maskAllText,
      mutationBreadcrumbLimit,
      mutationLimit,
      slowClickTimeout,
      slowClickIgnoreSelectors,
      networkDetailAllowUrls,
      networkDetailDenyUrls,
      networkCaptureBodies,
      networkRequestHeaders: _getMergedNetworkHeaders(networkRequestHeaders),
      networkResponseHeaders: _getMergedNetworkHeaders(networkResponseHeaders),
      beforeAddRecordingEvent,
      beforeErrorSampling,

      _experiments,
    };

    if (this._initialOptions.blockAllMedia) {
      // `blockAllMedia` is a more user friendly option to configure blocking
      // embedded media elements
      this._recordingOptions.blockSelector = !this._recordingOptions
        .blockSelector
        ? MEDIA_SELECTORS
        : `${this._recordingOptions.blockSelector},${MEDIA_SELECTORS}`;
    }

    if (this._isInitialized && isBrowser()) {
      throw new Error(
        'Multiple Sentry Session Replay instances are not supported',
      );
    }

    this._isInitialized = true;
  }

  /** If replay has already been initialized */
  protected get _isInitialized(): boolean {
    return _initialized;
  }

  /** Update _isInitialized */
  protected set _isInitialized(value: boolean) {
    _initialized = value;
  }

  /**
   * Setup and initialize replay container
   */
  public afterAllSetup(client: Client): void {
    if (!isBrowser() || this._replay) {
      return;
    }

    this._setup(client);
    this._initialize(client);
  }

  /**
   * Start a replay regardless of sampling rate. Calling this will always
   * create a new session. Will log a message if replay is already in progress.
   *
   * Creates or loads a session, attaches listeners to varying events (DOM,
   * PerformanceObserver, Recording, Sentry SDK, etc)
   */
  public start(): void {
    if (!this._replay) {
      return;
    }
    this._replay.start();
  }

  /**
   * Start replay buffering. Buffers until `flush()` is called or, if
   * `replaysOnErrorSampleRate` > 0, until an error occurs.
   */
  public startBuffering(): void {
    if (!this._replay) {
      return;
    }

    this._replay.startBuffering();
  }

  /**
   * Currently, this needs to be manually called (e.g. for tests). Sentry SDK
   * does not support a teardown
   */
  public stop(): Promise<void> {
    if (!this._replay) {
      return Promise.resolve();
    }

    return this._replay.stop({
      forceFlush: this._replay.recordingMode === 'session',
    });
  }

  /**
   * If not in "session" recording mode, flush event buffer which will create a new replay.
   * If replay is not enabled, a new session replay is started.
   * Unless `continueRecording` is false, the replay will continue to record and
   * behave as a "session"-based replay.
   *
   * Otherwise, queue up a flush.
   */
  public flush(options?: SendBufferedReplayOptions): Promise<void> {
    if (!this._replay) {
      return Promise.resolve();
    }

    // assuming a session should be recorded in this case
    if (!this._replay.isEnabled()) {
      this._replay.start();
      return Promise.resolve();
    }

    return this._replay.sendBufferedReplayOrFlush(options);
  }

  /**
   * Get the current session ID.
   */
  public getReplayId(): string | undefined {
    if (!this._replay || !this._replay.isEnabled()) {
      return;
    }

    return this._replay.getSessionId();
  }

  /**
   * Initializes replay.
   */
  protected _initialize(client: Client): void {
    if (!this._replay) {
      return;
    }

    this._maybeLoadFromReplayCanvasIntegration(client);
    this._replay.initializeSampling();
  }

  /** Setup the integration. */
  private _setup(client: Client): void {
    // Client is not available in constructor, so we need to wait until setupOnce
    const finalOptions = loadReplayOptionsFromClient(
      this._initialOptions,
      client,
    );

    this._replay = new ReplayContainer({
      options: finalOptions,
      recordingOptions: this._recordingOptions,
    });
  }

  /** Get canvas options from ReplayCanvas integration, if it is also added. */
  private _maybeLoadFromReplayCanvasIntegration(client: Client): void {
    // To save bundle size, we skip checking for stuff here
    // and instead just try-catch everything - as generally this should all be defined
    /* eslint-disable @typescript-eslint/no-non-null-assertion */
    try {
      const canvasIntegration = client.getIntegrationByName(
        'ReplayCanvas',
      ) as Integration & {
        getOptions(): ReplayCanvasIntegrationOptions;
      };
      if (!canvasIntegration) {
        return;
      }

      this._replay!['_canvas'] = canvasIntegration.getOptions();
    } catch {
      // ignore errors here
    }
    /* eslint-enable @typescript-eslint/no-non-null-assertion */
  }
}

/** Parse Replay-related options from SDK options */
function loadReplayOptionsFromClient(
  initialOptions: InitialReplayPluginOptions,
  client: Client,
): ReplayPluginOptions {
  const opt = client.getOptions() as BrowserClientReplayOptions;

  const finalOptions: ReplayPluginOptions = {
    sessionSampleRate: 0,
    errorSampleRate: 0,
    ...dropUndefinedKeys(initialOptions),
  };

  const replaysSessionSampleRate = parseSampleRate(
    opt.replaysSessionSampleRate,
  );
  const replaysOnErrorSampleRate = parseSampleRate(
    opt.replaysOnErrorSampleRate,
  );

  if (replaysSessionSampleRate == null && replaysOnErrorSampleRate == null) {
    consoleSandbox(() => {
      // eslint-disable-next-line no-console
      console.warn(
        'Replay is disabled because neither `replaysSessionSampleRate` nor `replaysOnErrorSampleRate` are set.',
      );
    });
  }

  if (replaysSessionSampleRate != null) {
    finalOptions.sessionSampleRate = replaysSessionSampleRate;
  }

  if (replaysOnErrorSampleRate != null) {
    finalOptions.errorSampleRate = replaysOnErrorSampleRate;
  }

  return finalOptions;
}

function _getMergedNetworkHeaders(headers: string[]): string[] {
  return [
    ...DEFAULT_NETWORK_HEADERS,
    ...headers.map((header) => header.toLowerCase()),
  ];
}
