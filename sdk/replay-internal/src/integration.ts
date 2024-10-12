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

/**
 * 包含了一系列的媒体元素选择器。这些选择器指向了不同类型的媒体元素，如图像、视频和音频等。
 *
 * img、video、audio等标签是常见的多媒体内容。
 * link[rel="icon"] 和 link[rel="apple-touch-icon"] 选择了网页中常用的图标和 Apple 触控图标链接。
 *
 * 这个常量可能用于设置过滤或阻止特定媒体内容的逻辑，比如在会话重放中隐藏敏感信息或控制媒体播放的行为。
 */
const MEDIA_SELECTORS =
  'img,image,svg,video,object,picture,embed,map,audio,link[rel="icon"],link[rel="apple-touch-icon"]';

/** 默认的网络请求头部字段 */
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

    // blockAllMedia 是一个配置选项，它可以让用户决定是否要阻止嵌入的媒体元素（如音频、视频等）
    if (this._initialOptions.blockAllMedia) {
      // 设置 blockSelector，该选择器用于确定需要阻止的元素
      this._recordingOptions.blockSelector = !this._recordingOptions
        .blockSelector
        ? // 如果没有配置选择器则使用默认的
          MEDIA_SELECTORS
        : // 配置后会将现有的选择器和 默认的组合在一起
          `${this._recordingOptions.blockSelector},${MEDIA_SELECTORS}`;
    }

    // 防止重复初始化 Sentry Session Replay 实例
    if (this._isInitialized && isBrowser()) {
      throw new Error(
        // 提示不支持多个实例
        'Multiple Sentry Session Replay instances are not supported',
      );
    }

    // 设置为 true，表示当前实例已经初始化完成
    this._isInitialized = true;
  }

  /**
   * 受保护的属性，使用 getter 和 setter 来访问和更新
   */
  protected get _isInitialized(): boolean {
    return _initialized;
  }

  protected set _isInitialized(value: boolean) {
    _initialized = value;
  }

  /**
   * 在所有设置完成后调用，初始化回放系统
   */
  public afterAllSetup(client: Client): void {
    // 只有在浏览器环境下且回放系统尚未初始化时，才会调用 _setup 和 _initialize 来完成设置和初始化
    if (!isBrowser() || this._replay) {
      return;
    }

    this._setup(client);
    this._initialize(client);
  }

  /**
   * 启动回放系统
   *
   * 1. 强制启动回放：
   * 调用这个方法会 始终创建一个新会话，不管采样率是否满足条件。
   * 即使配置中有可能限制某些条件下的回放启动，但调用此方法会忽略这些限制并启动回放。
   *
   * 2. 日志记录：
   * 如果回放已经在进行中，系统会记录一条日志信息，表明回放已经在运行。这样可以避免多次启动回放的情况。
   *
   * 3. 会话创建与监听器：
   * 这个方法不仅会创建或加载一个会话，还会 附加监听器 来监听各种事件，包括：
   *  - DOM 事件：用户界面交互（如点击、滚动等）的事件
   *  - PerformanceObserver：用于监控性能变化，例如资源加载时间等
   *  - Recording：捕获用户会话的录制行为
   *  - Sentry SDK：整合 Sentry 错误监控的相关事件
   *
   */
  public start(): void {
    if (!this._replay) {
      return;
    }
    this._replay.start();
  }

  /**
   * 启动缓冲机制，开始将数据缓冲直到 flush() 被调用，
   * 或者在错误发生时（如果 replaysOnErrorSampleRate 大于 0）再处理数据
   */
  public startBuffering(): void {
    if (!this._replay) {
      return;
    }

    this._replay.startBuffering();
  }

  /**
   * 停止回放系统。如果回放系统存在，则调用 stop() 方法停止回放。
   * 参数 forceFlush 决定是否强制刷新缓冲区（当录制模式为 session 时强制刷新）
   *
   * 目前，必须手动调用 stop() 方法来停止回放的录制或缓冲
   * Sentry SDK 并不提供自动“teardown”机制，表示一旦回放启动后，
   * SDK 本身没有提供自动清理或终止回放的机制。开发者需要自行处理停止回放的逻辑。
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
   * 将缓冲的数据刷新（发送）出去。
   * 如果回放系统没有启用，会先启动回放系统。如果已经启用，则会根据传入的选项刷新缓冲区
   *
   *
   * 1. 非 "session" 录制模式下刷新事件缓冲：
   * 当不处于会话录制模式时，调用 flush() 会将当前缓冲区中的事件数据发送出去，并创建一个新的回放会话。
   * 换句话说，这种情况下的 flush() 操作相当于触发了一个新的会话回放。
   *
   * 2. 回放未启用时启动新会话：
   * 如果当前回放功能未启用，那么 flush() 会先启动一个新的回放会话。
   * 这意味着即使在回放未开启的状态下，调用此方法也会确保回放功能正常运行。
   *
   * 3. 控制是否继续录制：
   * 如果 continueRecording 参数为 false，那么回放在缓冲区数据刷新后将不会继续录制。
   * 否则，回放将继续录制并且表现得像基于 "session" 的回放。
   *
   * 4. 排队刷新操作：
   * 如果不符合上述情况，flush() 会将刷新操作排队，等待稍后执行。
   *
   */
  public flush(options?: SendBufferedReplayOptions): Promise<void> {
    if (!this._replay) {
      return Promise.resolve();
    }

    if (!this._replay.isEnabled()) {
      // 如果回放系统没有启动，这里会启动回放系统并返回成功的promise
      this._replay.start();
      return Promise.resolve();
    }

    // 发送缓冲的数据
    return this._replay.sendBufferedReplayOrFlush(options);
  }

  /**
   * 获取当前会话id
   */
  public getReplayId(): string | undefined {
    if (!this._replay || !this._replay.isEnabled()) {
      return;
    }

    return this._replay.getSessionId();
  }

  /**
   * 初始化回放功能，确保回放功能正确配置并启动
   */
  protected _initialize(client: Client): void {
    if (!this._replay) {
      return;
    }

    // 在回放初始化时检查并加载与 Canvas 相关的集成
    this._maybeLoadFromReplayCanvasIntegration(client);
    // 初始化会话采样逻辑，可能涉及会话的采样率或其他策略
    this._replay.initializeSampling();
  }

  /** Setup the integration. */
  private _setup(client: Client): void {
    /**
     * 这里解释了为什么 client 对象不能在构造函数中使用，需要等到 setupOnce 方法被调用后再进行设置
     *
     * 构造函数中的 client 对象未初始化是常见的情况，
     * 因为某些依赖项（如 Sentry SDK 中的客户端实例）通常在应用的初始化过程中晚些时候才创建
     * 由于回放集成需要访问 client 提供的一些配置信息或功能，因此在构造函数中无法直接访问这些内容。
     *
     * 由于 client 对象在构造函数内尚未准备好，因此需要等到适当的时机（例如在 setupOnce 方法中）才能设置回放集成。
     */

    // 将 client 传递过来的配置项与当前类的 _initialOptions 合并，生成最终的配置
    const finalOptions = loadReplayOptionsFromClient(
      this._initialOptions,
      client,
    );

    // 创建一个新的 回放系统实例
    this._replay = new ReplayContainer({
      options: finalOptions,
      recordingOptions: this._recordingOptions,
    });
  }

  /**
   * 用于从 ReplayCanvas 集成中获取画布的选项（如果该集成已添加）
   * 主要逻辑是检查客户端中的 ReplayCanvas 集成，如果存在该集成，
   * 则调用其 getOptions() 方法获取画布相关的配置，并将其存储到 _replay 对象的 _canvas 属性中。
   */
  private _maybeLoadFromReplayCanvasIntegration(client: Client): void {
    /**
     * 注释部分提到：“为了节省包的大小，我们在这里跳过对内容的检查，而是选择使用 try-catch 机制，因为通常这些内容应该都是已定义的。”
     * 这个注释的主要目的是解释在获取 ReplayCanvas 集成选项时选择使用 try-catch 的原因
     */
    /* eslint-disable @typescript-eslint/no-non-null-assertion */
    try {
      // 获取 ReplayCanvas 集成
      const canvasIntegration = client.getIntegrationByName(
        'ReplayCanvas',
      ) as Integration & {
        getOptions(): ReplayCanvasIntegrationOptions;
      };
      if (!canvasIntegration) {
        return;
      }

      // 获取canvas 的配置，并保存在回放系统中
      this._replay!['_canvas'] = canvasIntegration.getOptions();
    } catch {
      // ignore errors here
    }
    /* eslint-enable @typescript-eslint/no-non-null-assertion */
  }
}

/**
 * 从 SDK 客户端获取与重放（Replay）相关的选项，并根据这些选项创建一个最终的重放插件配置
 */
function loadReplayOptionsFromClient(
  initialOptions: InitialReplayPluginOptions,
  client: Client,
): ReplayPluginOptions {
  // 客户端配置
  const opt = client.getOptions() as BrowserClientReplayOptions;

  // 最终配置
  const finalOptions: ReplayPluginOptions = {
    sessionSampleRate: 0,
    errorSampleRate: 0,
    // 过滤掉 undefined 的属性
    ...dropUndefinedKeys(initialOptions),
  };

  // 解析采样率
  const replaysSessionSampleRate = parseSampleRate(
    opt.replaysSessionSampleRate,
  );
  const replaysOnErrorSampleRate = parseSampleRate(
    opt.replaysOnErrorSampleRate,
  );

  // 如果两个采样率都没有设置，发出警告
  if (replaysSessionSampleRate == null && replaysOnErrorSampleRate == null) {
    consoleSandbox(() => {
      // eslint-disable-next-line no-console
      console.warn(
        'Replay is disabled because neither `replaysSessionSampleRate` nor `replaysOnErrorSampleRate` are set.',
      );
    });
  }

  // 如果采样率有效，则将其更新到 finalOptions 中。
  if (replaysSessionSampleRate != null) {
    finalOptions.sessionSampleRate = replaysSessionSampleRate;
  }

  if (replaysOnErrorSampleRate != null) {
    finalOptions.errorSampleRate = replaysOnErrorSampleRate;
  }

  // 返回最终配置
  return finalOptions;
}

/**
 * 合并默认网络请求头与自定义请求头，并返回一个新的请求头数组
 *
 * @param headers
 * @returns
 */
function _getMergedNetworkHeaders(headers: string[]): string[] {
  return [
    ...DEFAULT_NETWORK_HEADERS,
    ...headers.map((header) => header.toLowerCase()),
  ];
}
