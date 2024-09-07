/* eslint-disable max-lines */
import type {
  Breadcrumb,
  BreadcrumbHint,
  Client,
  ClientOptions,
  DataCategory,
  DsnComponents,
  DynamicSamplingContext,
  Envelope,
  ErrorEvent,
  Event,
  EventDropReason,
  EventHint,
  EventProcessor,
  FeedbackEvent,
  Integration,
  Outcome,
  ParameterizedString,
  SdkMetadata,
  Session,
  SessionAggregates,
  SeverityLevel,
  Span,
  SpanAttributes,
  SpanContextData,
  SpanJSON,
  StartSpanOptions,
  TransactionEvent,
  Transport,
  TransportMakeRequestResponse,
} from '@xigua-monitor/types';
import {
  SentryError,
  SyncPromise,
  addItemToEnvelope,
  checkOrSetAlreadyCaught,
  createAttachmentEnvelopeItem,
  createClientReportEnvelope,
  dropUndefinedKeys,
  dsnToString,
  isParameterizedString,
  isPlainObject,
  isPrimitive,
  isThenable,
  logger,
  makeDsn,
  rejectedSyncPromise,
  resolvedSyncPromise,
  uuid4,
} from '@xigua-monitor/utils';

import { getEnvelopeEndpointWithUrlEncodedAuth } from './api';
import { getIsolationScope } from './currentScopes';
import { DEBUG_BUILD } from './debug-build';
import { createEventEnvelope, createSessionEnvelope } from './envelope';
import type { IntegrationIndex } from './integration';
import { afterSetupIntegrations } from './integration';
import { setupIntegration, setupIntegrations } from './integration';
import type { Scope } from './scope';
import { updateSession } from './session';
import { getDynamicSamplingContextFromClient } from './tracing/dynamicSamplingContext';
import { parseSampleRate } from './utils/parseSampleRate';
import { prepareEvent } from './utils/prepareEvent';

/**
 * 用于表示不再捕获异常的错误信息
 * 该常量可能会在捕获异常的逻辑中使用，以确保 SDK 不会重复捕获同一异常
 */
const ALREADY_SEEN_ERROR =
  "Not capturing exception because it's already been captured.";

/**
 * 这个类是所有 JavaScript SDK 客户端的基础实
 *
 * 在调用构造函数时需要传入特定于客户端子类的选项，随后可以使用 Client.getOptions 方法访问这些选项
 * {@link Client.getOptions}.
 *
 * 如果在选项中指定了 DSN（数据源名称），它会被解析和存储。可以使用 Client.getDsn 方法随时检索 DSN。
 * {@link Client.getDsn}
 * 如果 DSN 无效，构造函数将抛出 SentryException。在没有有效 DSN 的情况下，SDK 不会发送任何事件到 Sentry。
 *  {@link SentryException}
 *
 * 在发送事件之前，会通过 BaseClient._prepareEvent 方法进行处理，
 * 以添加 SDK 信息和作用域数据（例如，面包屑和上下文）。可以通过重写该方法来添加更多自定义信息。
 * {@link BaseClient._prepareEvent}
 *
 * 这里提供了关于如何使用 Client.captureEvent 自动生成事件以及如何使用 Client.addBreadcrumb 来生成自动面包屑的说明
 * {@link Client.captureEvent}     {@link Client.addBreadcrumb}.
 *
 * @example
 * class NodeClient extends BaseClient<NodeOptions> {
 *   public constructor(options: NodeOptions) {
 *     super(options);
 *   }
 *
 *   // ...
 * }
 */
export abstract class BaseClient<O extends ClientOptions> implements Client<O> {
  /** 保存传递给 SDK 的选项 */
  protected readonly _options: O;

  /** 客户端的 DSN（数据源名称），如果在选项中指定了，类型为 DsnComponents。没有 DSN，SDK 将被禁用 */
  protected readonly _dsn?: DsnComponents;

  /** 运输层的实现，用于发送事件 */
  protected readonly _transport?: Transport;

  /** 已设置的集成 */
  protected _integrations: IntegrationIndex;

  /** 处理中的调用数 */
  protected _numProcessing: number;

  /** 事件处理器数组 */
  protected _eventProcessors: EventProcessor[];

  /** 存储可刷新事件的对象，键为字符串，值为数字  */
  private _outcomes: { [key: string]: number };

  // eslint-disable-next-line @typescript-eslint/ban-types
  /** 记录钩子的对象，用于存储与特定事件相关的回调函数 */
  private _hooks: Record<string, Function[]>;

  /**
   * 用于初始化客户端实例
   *
   * @param options Options for the client.
   */
  protected constructor(options: O) {
    this._options = options;
    this._integrations = {};
    this._numProcessing = 0;
    this._outcomes = {};
    this._hooks = {};
    this._eventProcessors = [];

    if (options.dsn) {
      // 提供了 dsn，数生成 DSN 组件，并保存到 _dsn 属性
      this._dsn = makeDsn(options.dsn);
    } else {
      // 如果没有提供 DSN，在调试模式下发出警告，表示客户端不会发送事件
      DEBUG_BUILD &&
        logger.warn('No DSN provided, client will not send events.');
    }

    if (this._dsn) {
      // 存在dsn，生成运输层的 URL，并根据传入的选项创建一个运输实例，赋值给 _transport 属性
      const url = getEnvelopeEndpointWithUrlEncodedAuth(
        this._dsn,
        options.tunnel,
        options._metadata ? options._metadata.sdk : undefined,
      );

      this._transport = options.transport({
        tunnel: this._options.tunnel,
        recordDroppedEvent: this.recordDroppedEvent.bind(this),
        ...options.transportOptions,
        url,
      });
    }
  }

  /**
   * 捕获异常并将其发送到 Sentry
   * @inheritDoc
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public captureException(
    exception: any,
    hint?: EventHint,
    scope?: Scope,
  ): string {
    // 生成唯一事件 ID
    const eventId = uuid4();

    // 检查是否已经捕获过该异常
    if (checkOrSetAlreadyCaught(exception)) {
      // 则在调试模式下记录警告，并返回事件 ID
      DEBUG_BUILD && logger.log(ALREADY_SEEN_ERROR);
      return eventId;
    }

    // 包含事件 ID 的提示对象
    const hintWithEventId = {
      event_id: eventId,
      ...hint,
    };

    this._process(
      // 从异常中生成事件，并捕获该事件
      this.eventFromException(exception, hintWithEventId).then((event) =>
        this._captureEvent(event, hintWithEventId, scope),
      ),
    );

    return hintWithEventId.event_id;
  }

  /**
   * 捕获消息并将其发送到 Sentry
   * @inheritDoc
   */
  public captureMessage(
    message: ParameterizedString,
    level?: SeverityLevel,
    hint?: EventHint,
    currentScope?: Scope,
  ): string {
    // 包含事件ID 的提示对象
    const hintWithEventId = {
      event_id: uuid4(),
      ...hint,
    };

    // 如何是字符串直接使用，否则转为字符串
    const eventMessage = isParameterizedString(message)
      ? message
      : String(message);

    // 检查消息类型是否为原始值
    const promisedEvent = isPrimitive(message)
      ? // 原始值
        this.eventFromMessage(eventMessage, level, hintWithEventId)
      : // 不是原始值
        this.eventFromException(message, hintWithEventId);

    this._process(
      promisedEvent.then((event) =>
        this._captureEvent(event, hintWithEventId, currentScope),
      ),
    );

    return hintWithEventId.event_id;
  }

  /**
   * 捕获自定义事件并将其发送到 Sentry
   * @inheritDoc
   */
  public captureEvent(
    event: Event,
    hint?: EventHint,
    currentScope?: Scope,
  ): string {
    const eventId = uuid4();

    if (
      hint &&
      hint.originalException &&
      // 检查是否已经捕获过该事件
      checkOrSetAlreadyCaught(hint.originalException)
    ) {
      DEBUG_BUILD && logger.log(ALREADY_SEEN_ERROR);
      return eventId;
    }

    const hintWithEventId = {
      event_id: eventId,
      ...hint,
    };

    // 获取 SDK 处理元数据中的捕获跨度作用域
    const sdkProcessingMetadata = event.sdkProcessingMetadata || {};
    const capturedSpanScope: Scope | undefined =
      sdkProcessingMetadata.capturedSpanScope;

    this._process(
      this._captureEvent(
        event,
        hintWithEventId,
        capturedSpanScope || currentScope,
      ),
    );

    return hintWithEventId.event_id;
  }

  /**
   * 这个方法用于捕获会话并确保其正确发送
   * @inheritDoc
   */
  public captureSession(session: Session): void {
    // 如果 release 不存在或不是字符串，程序会记录警告并丢弃该会话（在 DEBUG 模式下）
    // release 是 Sentry 捕获会话的关键数据
    if (!(typeof session.release === 'string')) {
      DEBUG_BUILD &&
        logger.warn(
          'Discarded session because of missing or non-string release',
        );
    } else {
      // 如果 release 是字符串，发送会话数据
      this.sendSession(session);
      // 发送之后，我们将init设为false，以表示这不是第一次发生.这通常用于标记会话是否是新的
      updateSession(session, { init: false });
    }
  }

  /**
   * 这个方法用于获取当前 SDK 客户端的 DSN（Data Source Name）
   * @inheritDoc
   */
  public getDsn(): DsnComponents | undefined {
    return this._dsn;
  }

  /**
   * 获取配置信息
   * @inheritDoc
   */
  public getOptions(): O {
    return this._options;
  }

  /**
   * 获取 SDK 的元数据（metadata），用来描述 SDK 的版本、名称等信息
   * @see SdkMetadata in @sentry/types
   *
   * @return The metadata of the SDK
   */
  public getSdkMetadata(): SdkMetadata | undefined {
    return this._options._metadata;
  }

  /**
   * 获取 SDK 所使用的传输层（Transport）
   * @inheritDoc
   */
  public getTransport(): Transport | undefined {
    return this._transport;
  }

  /**
   * 这个方法用于确保所有数据在给定的时间内发送完成
   *
   * flush 接受一个可选的超时时间 timeout 参数，在该时间内等待所有任务完成
   * @param timeout 超时时间
   * @returns
   * @inheritDoc
   */
  public flush(timeout?: number): PromiseLike<boolean> {
    // 获取传输层对象
    const transport = this._transport;
    if (transport) {
      // 如果传输层存在,触发 flush 事件通知监听器有数据需要清空
      this.emit('flush');

      // 检查客户端是否还有待处理的事件
      return this._isClientDoneProcessing(timeout).then((clientFinished) => {
        return (
          transport
            .flush(timeout)
            // clientFinished：标记客户端是否已完成所有事件的处理
            // transportFlushed：标记传输层是否已完成发送数据
            // 两者都为 true 时，表示所有数据都成功发送完毕
            .then((transportFlushed) => clientFinished && transportFlushed)
        );
      });
    } else {
      // 如果传输层不存在，直接返回一个已解决的同步 Promise
      // 表示数据发送操作立即完成，因为没有需要发送的内容。
      return resolvedSyncPromise(true);
    }
  }

  /**
   * 用于关闭 SDK 并确保在关闭之前完成所有未发送的事件
   * @inheritDoc
   */
  public close(timeout?: number): PromiseLike<boolean> {
    // 调用 this.flush(timeout)，确保所有的事件在指定的超时时间内被处理和发送
    return this.flush(timeout).then((result) => {
      // 一旦所有事件处理完成,将 SDK 的 enabled 属性设置为 false，表示 SDK 不再处理或发送事件
      this.getOptions().enabled = false;
      // 触发 close 事件
      this.emit('close');
      // 返回 flush 方法的结果,表明所有事件是否成功发送
      return result;
    });
  }

  /**
   * 获取所有事件处理器
   */
  public getEventProcessors(): EventProcessor[] {
    return this._eventProcessors;
  }

  /**
   * 用于添加新的事件处理器
   * @inheritDoc
   */
  public addEventProcessor(eventProcessor: EventProcessor): void {
    this._eventProcessors.push(eventProcessor);
  }

  /**
   * 用于初始化 SDK，包括设置集成
   *  @inheritdoc
   *
   */
  public init(): void {
    if (
      // 首先检查 SDK 是否已启用
      this._isEnabled() ||
      // Force integrations to be setup even if no DSN was set when we have
      // Spotlight enabled. This is particularly important for browser as we
      // don't support the `spotlight` option there and rely on the users
      // adding the `spotlightBrowserIntegration()` to their integrations which
      // wouldn't get initialized with the check below when there's no DSN set.
      /**
       * 注释的目的是解释为什么在没有设置 DSN（数据源名称）的情况下，仍然强制初始化某些集成
       * Spotlight 是 Sentry 的一个特性，可能涉及错误跟踪和性能监控等功能。
       * 当启用 Spotlight 功能时，即使没有 DSN 也应确保集成被设置。
       *
       * 在浏览器环境中，Spotlight 集成需要用户手动添加名为 spotlightBrowserIntegration() 的集成。
       * 如果没有强制初始化这些集成，它们可能不会被设置，导致应用无法使用 Spotlight 的功能。
       *
       * 在通常情况下，Sentry SDK 需要 DSN 来发送事件和报告错误。但在这个特殊的情况下，
       * 即使 DSN 未设置，只要有 Spotlight 集成，SDK 就会初始化集成。这是为了确保 Spotlight 功能能够正常工作。
       *
       * 由于 Sentry SDK 依赖于用户添加的集成，强制初始化确保用户在使用 Spotlight 时不必担心集成未初始化的问题，减少了潜在的错误。
       */

      // 如果在集成选项中有名称以 "Spotlight" 开头的集成（即使没有设置 DSN），也会强制进行初始化。
      this._options.integrations.some(({ name }) =>
        name.startsWith('Spotlight'),
      )
    ) {
      // 初始化所有注册的集成,以便在 SDK 启动时自动准备好这些功能
      this._setupIntegrations();
    }
  }

  /**
   * 通过名称获取已安装的集成
   *
   * @returns 返回指定名称的集成，或者在未找到集成时返回 undefined
   */
  public getIntegrationByName<T extends Integration = Integration>(
    integrationName: string,
  ): T | undefined {
    return this._integrations[integrationName] as T | undefined;
  }

  /**
   * 用于添加集成到 SDK 中，确保每个集成只被安装一次
   * @inheritDoc
   */
  public addIntegration(integration: Integration): void {
    // 检查集成是否已经安装过了
    const isAlreadyInstalled = this._integrations[integration.name];

    // 安装集成,该钩子只负责安装尚未安装的钩子
    setupIntegration(this, integration, this._integrations);
    // Here we need to check manually to make sure to not run this multiple times
    if (!isAlreadyInstalled) {
      // 如果集成尚未安装,调用安装函数 以确保任何需要在集成设置后执行的额外逻辑都能够正常运行
      afterSetupIntegrations(this, [integration]);
    }
  }

  /**
   * 这个方法将一个 event 事件发送给 Sentry 服务器，并在发送前和发送后执行一些钩子函数
   * @inheritDoc
   */
  public sendEvent(event: Event, hint: EventHint = {}): void {
    // 在发送事件前，触发 'beforeSendEvent' 钩子，通知其他组件有事件要发送
    this.emit('beforeSendEvent', event, hint);

    // 创建 信封对象
    let env = createEventEnvelope(
      event,
      this._dsn,
      this._options._metadata,
      this._options.tunnel,
    );

    // 如果有附件（如日志、截图等），则将它们加入 Envelope 中
    for (const attachment of hint.attachments || []) {
      env = addItemToEnvelope(env, createAttachmentEnvelopeItem(attachment));
    }

    // 发送 Envelope，返回一个 Promise 对象，处理发送结果
    const promise = this.sendEnvelope(env);
    if (promise) {
      promise.then(
        // 事件成功发送后，触发 'afterSendEvent' 钩子
        (sendResponse) => this.emit('afterSendEvent', event, sendResponse),
        // 错误处理忽略
        null,
      );
    }
  }

  /**
   * 这个函数的主要功能是发送一个会话（Session 或 SessionAggregates）到 Sentry 服务端，
   * 它通过构造一个会话的封装包（envelope），并使用 sendEnvelope 方法将其发送
   * @inheritDoc
   */
  public sendSession(session: Session | SessionAggregates): void {
    // 创建一个 envelope（信封），也就是 Sentry 用来封装数据的容器
    const env = createSessionEnvelope(
      session, // 要发送的会话数据（或聚合数据）
      this._dsn, // Sentry 的 DSN（Data Source Name），表示发送数据的目标地址
      this._options._metadata, // 一些额外的元数据（metadata），可能用于标识或记录附加信息。
      this._options.tunnel, // 如果 Sentry 使用了一个隧道（tunnel）来传输数据，则 tunnel 表示那个地址。如果没有隧道，则直接发送到 DSN
    );

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    // 将封装包发送出去,发送不应该抛出异常
    this.sendEnvelope(env);
  }

  /**
   * 这个方法用于记录某个事件未被发送的原因（dropped event）
   * 它是 Sentry SDK 中用于统计和跟踪那些被丢弃的事件或未成功发送的事件的功能。
   * @inheritDoc
   */
  public recordDroppedEvent(
    reason: EventDropReason,
    category: DataCategory,
    eventOrCount?: Event | number,
  ): void {
    // 检查是否启用了客户端报告功能（即是否需要记录被丢弃的事件）
    if (this._options.sendClientReports) {
      // v9版本:我们不再需要' event '作为第三个参数传递了，并且可以删除这个重载。
      // 如果是 number，它表示丢弃了多少个事件。如果是 Event，表示丢弃的是具体的事件，默认认为丢弃的数量为 1。
      const count = typeof eventOrCount === 'number' ? eventOrCount : 1;

      // We want to track each category (error, transaction, session, replay_event) separately
      // but still keep the distinction between different type of outcomes.
      // We could use nested maps, but it's much easier to read and type this way.
      // A correct type for map-based implementation if we want to go that route
      // would be `Partial<Record<SentryRequestType, Partial<Record<Outcome, number>>>>`
      // With typescript 4.1 we could even use template literal types
      /**
       * 这段注释解释了关于如何跟踪和记录不同类别（如错误、事务、会话、重播事件）中的事件丢弃信息的设计思路
       *
       * Sentry 希望能够分别跟踪每个事件类别的丢弃情况，常见的类别包括：
       *   - error：错误事件
       *   - transaction：事务事件
       *   - session：会话事件
       *   - replay_event：重播事件
       * 每个类别的事件都有不同的上下文和意义，开发者可能想要知道每个类别下具体有多少事件被丢弃、丢弃的原因以及频率如何
       *
       * 尽管想要分离不同类别的事件，但仍需要保持不同事件丢弃原因之间的区分。
       * 例如，一个错误事件可能因为采样率被丢弃，而另一个则可能是由于客户端配置问题被丢弃
       *
       * 在跟踪事件类别和丢弃原因时，既要详细记录每个类别的信息，又要确保各个原因之间的区分度。
       * 可以使用嵌套的映射（Map）来保存每个类别的事件丢弃信息，但这会使代码变得复杂，增加了维护和阅读的难度
       * 当前的方法通过字符串键（如 reason:category）来代替嵌套结构，使得代码更加简洁易读。
       *
       * 这种方法将原因和类别拼接成一个字符串作为键值，减少了复杂性。
       * 例如，"sample_rate:error" 和 "network_error:transaction" 就是两个不同的键，
       * 分别表示因采样率限制丢弃的错误事件和因网络错误丢弃的事务事件。
       *
       * 如果选择使用基于 Map 的实现方式，合适的 TypeScript 类型可以是
       * Partial<Record<SentryRequestType, Partial<Record<Outcome, number>>>>
       *   - SentryRequestType：表示事件的类别（如错误、事务等）
       *   - Outcome：表示丢弃的原因（如采样率、网络错误等）
       *   -number：表示被丢弃的事件数量
       * 每个类别（SentryRequestType）可以有多个可能的丢弃原因（Outcome），每个原因对应一个数字表示丢弃的次数
       */

      // 标识某种类型的事件丢弃
      const key = `${reason}:${category}`;
      // 在debug 模式下 每次记录事件丢弃时都会输出一条日志，方便开发者查看发生了哪些丢弃事件以及丢弃的原因。
      DEBUG_BUILD &&
        logger.log(
          `Recording outcome: "${key}"${count > 1 ? ` (${count} times)` : ''}`,
        );

      // 存储每种 key 对应的丢弃事件数量
      this._outcomes[key] = (this._outcomes[key] || 0) + count;
    }
  }

  // Keep on() & emit() signatures in sync with types' client.ts interface
  /* eslint-disable @typescript-eslint/unified-signatures */

  /** @inheritdoc */
  public on(hook: 'spanStart', callback: (span: Span) => void): () => void;

  /** @inheritdoc */
  public on(hook: 'spanEnd', callback: (span: Span) => void): () => void;

  /** @inheritdoc */
  public on(
    hook: 'idleSpanEnableAutoFinish',
    callback: (span: Span) => void,
  ): () => void;

  /** @inheritdoc */
  public on(
    hook: 'beforeEnvelope',
    callback: (envelope: Envelope) => void,
  ): () => void;

  /** @inheritdoc */
  public on(
    hook: 'beforeSendEvent',
    callback: (event: Event, hint?: EventHint) => void,
  ): () => void;

  /** @inheritdoc */
  public on(
    hook: 'preprocessEvent',
    callback: (event: Event, hint?: EventHint) => void,
  ): () => void;

  /** @inheritdoc */
  public on(
    hook: 'afterSendEvent',
    callback: (
      event: Event,
      sendResponse: TransportMakeRequestResponse,
    ) => void,
  ): () => void;

  /** @inheritdoc */
  public on(
    hook: 'beforeAddBreadcrumb',
    callback: (breadcrumb: Breadcrumb, hint?: BreadcrumbHint) => void,
  ): () => void;

  /** @inheritdoc */
  public on(
    hook: 'createDsc',
    callback: (dsc: DynamicSamplingContext, rootSpan?: Span) => void,
  ): () => void;

  /** @inheritdoc */
  public on(
    hook: 'beforeSendFeedback',
    callback: (
      feedback: FeedbackEvent,
      options?: { includeReplay: boolean },
    ) => void,
  ): () => void;

  /** @inheritdoc */
  public on(
    hook: 'beforeSampling',
    callback: (
      samplingData: {
        spanAttributes: SpanAttributes;
        spanName: string;
        parentSampled?: boolean;
        parentContext?: SpanContextData;
      },
      samplingDecision: { decision: boolean },
    ) => void,
  ): void;

  /** @inheritdoc */
  public on(
    hook: 'startPageLoadSpan',
    callback: (
      options: StartSpanOptions,
      traceOptions?: {
        sentryTrace?: string | undefined;
        baggage?: string | undefined;
      },
    ) => void,
  ): () => void;

  /** @inheritdoc */
  public on(
    hook: 'startNavigationSpan',
    callback: (options: StartSpanOptions) => void,
  ): () => void;

  public on(hook: 'flush', callback: () => void): () => void;

  public on(hook: 'close', callback: () => void): () => void;

  public on(
    hook: 'applyFrameMetadata',
    callback: (event: Event) => void,
  ): () => void;

  /** @inheritdoc */
  public on(hook: string, callback: unknown): () => void {
    const hooks = (this._hooks[hook] = this._hooks[hook] || []);

    // @ts-expect-error We assue the types are correct
    hooks.push(callback);

    // This function returns a callback execution handler that, when invoked,
    // deregisters a callback. This is crucial for managing instances where callbacks
    // need to be unregistered to prevent self-referencing in callback closures,
    // ensuring proper garbage collection.
    return () => {
      // @ts-expect-error We assue the types are correct
      const cbIndex = hooks.indexOf(callback);
      if (cbIndex > -1) {
        hooks.splice(cbIndex, 1);
      }
    };
  }

  /** @inheritdoc */
  public emit(
    hook: 'beforeSampling',
    samplingData: {
      spanAttributes: SpanAttributes;
      spanName: string;
      parentSampled?: boolean;
      parentContext?: SpanContextData;
    },
    samplingDecision: { decision: boolean },
  ): void;

  /** @inheritdoc */
  public emit(hook: 'spanStart', span: Span): void;

  /** @inheritdoc */
  public emit(hook: 'spanEnd', span: Span): void;

  /** @inheritdoc */
  public emit(hook: 'idleSpanEnableAutoFinish', span: Span): void;

  /** @inheritdoc */
  public emit(hook: 'beforeEnvelope', envelope: Envelope): void;

  /** @inheritdoc */
  public emit(hook: 'beforeSendEvent', event: Event, hint?: EventHint): void;

  /** @inheritdoc */
  public emit(hook: 'preprocessEvent', event: Event, hint?: EventHint): void;

  /** @inheritdoc */
  public emit(
    hook: 'afterSendEvent',
    event: Event,
    sendResponse: TransportMakeRequestResponse,
  ): void;

  /** @inheritdoc */
  public emit(
    hook: 'beforeAddBreadcrumb',
    breadcrumb: Breadcrumb,
    hint?: BreadcrumbHint,
  ): void;

  /** @inheritdoc */
  public emit(
    hook: 'createDsc',
    dsc: DynamicSamplingContext,
    rootSpan?: Span,
  ): void;

  /** @inheritdoc */
  public emit(
    hook: 'beforeSendFeedback',
    feedback: FeedbackEvent,
    options?: { includeReplay: boolean },
  ): void;

  /** @inheritdoc */
  public emit(
    hook: 'startPageLoadSpan',
    options: StartSpanOptions,
    traceOptions?: {
      sentryTrace?: string | undefined;
      baggage?: string | undefined;
    },
  ): void;

  /** @inheritdoc */
  public emit(hook: 'startNavigationSpan', options: StartSpanOptions): void;

  /** @inheritdoc */
  public emit(hook: 'flush'): void;

  /** @inheritdoc */
  public emit(hook: 'close'): void;

  /** @inheritdoc */
  public emit(hook: 'applyFrameMetadata', event: Event): void;

  /** @inheritdoc */
  public emit(hook: string, ...rest: unknown[]): void {
    const callbacks = this._hooks[hook];
    if (callbacks) {
      callbacks.forEach((callback) => callback(...rest));
    }
  }

  /**
   * 这个方法的主要作用是将 Envelope（信封对象）通过指定的传输机制（transport）发送给 Sentry 服务器，
   * 并处理发送过程中可能出现的错误。
   * @inheritdoc
   */
  public sendEnvelope(
    envelope: Envelope,
  ): PromiseLike<TransportMakeRequestResponse> {
    // 在发送 Envelope 前，触发 'beforeEnvelope' 事件，通知其他模块 Envelope 正在准备发送
    this.emit('beforeEnvelope', envelope);

    // 检查当前客户端是否启用，并且是否设置了传输机制（transport）
    if (this._isEnabled() && this._transport) {
      // 调用 transport 的 send 方法发送 Envelope，并返回一个 Promise 处理发送结果
      return this._transport.send(envelope).then(
        // 成功不做处理
        null,
        // 如果发送失败，记录错误日志
        (reason) => {
          DEBUG_BUILD && logger.error('Error while sending event:', reason);
          // 返回发送失败的原因
          return reason;
        },
      );
    }

    // 如果传输机制被禁用，记录错误日志
    DEBUG_BUILD && logger.error('Transport disabled');

    // 返回一个立即解决的 Promise，表示没有发送任何请求
    return resolvedSyncPromise({});
  }

  /* eslint-enable @typescript-eslint/unified-signatures */

  /** 设置与当前 SDK 客户端相关的所有集成 */
  protected _setupIntegrations(): void {
    const { integrations } = this._options;
    this._integrations = setupIntegrations(this, integrations);
    // 进行任何需要在集成设置后执行的额外逻辑
    afterSetupIntegrations(this, integrations);
  }

  /** 根据传入的事件更新现有会话的状态 */
  protected _updateSessionFromEvent(session: Session, event: Event): void {
    /** 是否发生崩溃 */
    let crashed = false;
    let errored = false;
    // 提取事件中的异常信息
    const exceptions = event.exception && event.exception.values;

    if (exceptions) {
      errored = true;

      // 遍历所有异常，检查是否有未处理的异常
      for (const ex of exceptions) {
        const mechanism = ex.mechanism;
        if (mechanism && mechanism.handled === false) {
          // 如果找到，则将 crashed 设置为 true
          crashed = true;
          break;
        }
      }
    }

    // A session is updated and that session update is sent in only one of the two following scenarios:
    // 1. Session with non terminal status and 0 errors + an error occurred -> Will set error count to 1 and send update
    // 2. Session with non terminal status and 1 error + a crash occurred -> Will set status crashed and send update

    // 检查会话状态是否为“正常”
    const sessionNonTerminal = session.status === 'ok';

    // 表示是否需要更新并发送会话
    const shouldUpdateAndSend =
      // 如果会话状态为“正常”且没有错误
      (sessionNonTerminal && session.errors === 0) ||
      // 如果会话状态为“正常”且发生了崩溃
      (sessionNonTerminal && crashed);

    if (shouldUpdateAndSend) {
      // 更新会话状态和错误计数
      updateSession(session, {
        ...(crashed && { status: 'crashed' }),
        errors: session.errors || Number(errored || crashed),
      });

      // 发送更新后的会话
      this.captureSession(session);
    }
  }

  /**
   * 用于判断当前客户端是否完成了所有的处理任务
   * 如果在给定的超时时间内客户端未完成处理，则返回 false；否则返回 true
   *
   * @param timeout 指定超时时间,如果传入 0 或未传入任何值，则方法将等待处理完成后再返回true
   *
   * @returns 如果处理已经完成或在超时之前完成，将解析为' true '，否则解析为' false '
   */
  protected _isClientDoneProcessing(timeout?: number): PromiseLike<boolean> {
    return new SyncPromise((resolve) => {
      /** 用于跟踪已过的时间 */
      let ticked: number = 0;
      /** 定义了每次检查间隔的时间，单位是 1 毫秒 */
      const tick: number = 1;

      // 每毫秒检查 _numProcessing 的值（表示当前正在处理的任务数量）
      const interval = setInterval(() => {
        if (this._numProcessing == 0) {
          // 表示所有处理任务已完成,清除定时器
          clearInterval(interval);
          // 返回true
          resolve(true);
        } else {
          ticked += tick;
          if (timeout && ticked >= timeout) {
            // 传递了超时时间,且已过时间超过了超时时间
            // 清除定时器,返回false
            clearInterval(interval);
            resolve(false);
          }
        }
      }, tick);
    });
  }

  /**
   * 用于确定当前 SDK 是否处于启用状态并且是否有可用的传输（transport）实例
   */
  protected _isEnabled(): boolean {
    return this.getOptions().enabled !== false && this._transport !== undefined;
  }

  /**
   * 负责在发送事件之前，添加一些公共信息并对事件进行处理
   *
   * 这些信息包括:
   *  - Release 和 Environment
   *    从 options 中提取的 release（版本）和 environment（环境）信息。
   *    这些信息通常用于指示代码的版本以及运行代码的环境（如开发、测试或生产环境）
   *
   *  - Breadcrumbs
   *    记录用户在应用程序中执行的操作或系统发生的事件,这些面包屑有助于提供事件发生前的上下文。
   *
   *  - context(上下文信息)
   *    包括 extra（额外信息）、tags（标签）和 user（用户信息）等。
   *    这些上下文信息通常用于标识事件的来源、相关的用户以及其他可能影响事件的上下文。
   *
   * 在将这些信息添加到事件时，如果事件对象中已经存在某些信息，那么这些信息不会被覆盖。
   * 这是为了确保原始数据的完整性，并避免不必要的信息丢失。
   * 对于嵌套对象（例如上下文信息），该函数会将新信息与现有信息进行合并。
   * 这意味着如果事件对象中的上下文已有某些键，那么在添加新信息时将会进行合并，而不是直接替换原有的信息。
   *
   *
   * @param event 原始事件对象
   * @param hint 可能包含关于原始异常的附加信息.
   * @param currentScope 当前的作用域，包含事件的元数据.
   * @returns A new event with more information.
   */
  protected _prepareEvent(
    event: Event,
    hint: EventHint,
    currentScope?: Scope,
    isolationScope = getIsolationScope(),
  ): PromiseLike<Event | null> {
    // 获取 SDK 的配置选项
    const options = this.getOptions();

    // 获取当前已安装的集成的名称列表
    const integrations = Object.keys(this._integrations);
    // 处理 Hint 的集成信息
    if (!hint.integrations && integrations.length > 0) {
      hint.integrations = integrations;
    }

    // 在事件准备前触发 preprocessEvent 事件，允许用户自定义处理
    this.emit('preprocessEvent', event, hint);

    // 如果事件没有类型,隔离作用域中获取最新的事件id
    if (!event.type) {
      isolationScope.setLastEventId(event.event_id || hint.event_id);
    }

    return prepareEvent(
      options,
      event,
      hint,
      currentScope,
      this,
      isolationScope,
    ).then((evt) => {
      if (evt === null) {
        // 为 null 表示事件没有准备好发送
        // 这通常意味着在某些情况下（例如，事件被过滤或丢弃），不需要继续处理。
        return evt;
      }

      // 这个上下文包含了与事件传播相关的信息，如追踪 ID、父级跨度 ID 等。
      const propagationContext = {
        // 获取隔离作用域的传播上下文
        ...isolationScope.getPropagationContext(),
        // 获取当前作用域的传播上下文
        ...(currentScope ? currentScope.getPropagationContext() : undefined),
      };

      // 检查事件的 contexts 属性是否已经包含追踪信息
      const trace = evt.contexts && evt.contexts.trace;

      // 如果没有，并且存在传播上下文
      if (!trace && propagationContext) {
        // 从传播上下文中提取 traceId、spanId 和 parentSpanId
        const {
          traceId: trace_id,
          spanId,
          parentSpanId,
          dsc,
        } = propagationContext;

        // 将追踪信息添加到事件的 contexts 属性中。这确保了事件包含所有必要的追踪信息，以便后续的错误追踪和监控。
        evt.contexts = {
          // 去除未定义的键
          trace: dropUndefinedKeys({
            trace_id,
            span_id: spanId,
            parent_span_id: parentSpanId,
          }),
          ...evt.contexts,
        };

        // 如果存在 动态上下文(dsc),则直接使用它；
        const dynamicSamplingContext = dsc
          ? dsc
          : // 获取动态采样上下文
            getDynamicSamplingContextFromClient(trace_id, this);

        // 将动态采样上下文合并到事件的 sdkProcessingMetadata 中。
        // 这是用于后续分析和调试的元数据，包含了有关事件处理过程的信息。
        evt.sdkProcessingMetadata = {
          dynamicSamplingContext,
          ...evt.sdkProcessingMetadata,
        };
      }
      // 返回处理后的事件
      // 此时，该事件已包含了所有必要的信息，包括传播上下文、追踪信息和动态采样上下文
      return evt;
    });
  }

  /**
   * 处理捕获的事件，并在发生错误时记录警告
   * @param event 要捕获的事件对象
   * @param hint 附加的提示信息，默认值为空对象
   * @param scope 作用域
   */
  protected _captureEvent(
    event: Event,
    hint: EventHint = {},
    scope?: Scope,
  ): PromiseLike<string | undefined> {
    // 调用 _processEvent 处理事件
    return this._processEvent(event, hint, scope).then(
      (finalEvent) => {
        // 成功的回调中返回事件id
        return finalEvent.event_id;
      },
      (reason) => {
        // 失败的回调

        // 检查是否在调试模式下，并根据错误的日志级别记录错误信息。
        if (DEBUG_BUILD) {
          // 如果出现错误，将错误记录为警告。如果只是我们在控制流中使用了' SentryError '，那么只记录消息(没有堆栈)作为日志级别的日志。
          const sentryError = reason as SentryError;
          if (sentryError.logLevel === 'log') {
            logger.log(sentryError.message);
          } else {
            logger.warn(sentryError);
          }
        }
        return undefined;
      },
    );
  }

  /**
   * 处理事件并将其发送到 Sentry，同时添加面包屑和上下文信息
   * 但是，特定于平台的元数据(例如用户的IP地址)必须由SDK实现者添加
   *
   *
   * @param event 要发送的事件
   * @param hint 原始异常的附加信息
   * @param currentScope 包含事件元数据的作用域
   * @returns
   */
  protected _processEvent(
    event: Event,
    hint: EventHint,
    currentScope?: Scope,
  ): PromiseLike<Event> {
    // 获取 sdk 配置
    const options = this.getOptions();
    // 从配置中获取采样率
    const { sampleRate } = options;

    // 检查事件是否是事务或错误，并决定事件类型
    const isTransaction = isTransactionEvent(event);
    const isError = isErrorEvent(event);

    const eventType = event.type || 'error';
    const beforeSendLabel = `before send for type \`${eventType}\``;

    // 解析采样率
    const parsedSampleRate =
      typeof sampleRate === 'undefined'
        ? undefined
        : parseSampleRate(sampleRate);

    // 如果事件是错误且随机数大于采样率
    if (
      isError &&
      typeof parsedSampleRate === 'number' &&
      Math.random() > parsedSampleRate
    ) {
      // 则丢弃事件并返回一个拒绝的 Promise
      this.recordDroppedEvent('sample_rate', 'error', event);
      return rejectedSyncPromise(
        new SentryError(
          `Discarding event because it's not included in the random sample (sampling rate = ${sampleRate})`,
          'log',
        ),
      );
    }

    // 确定事件的类型,对于 replay_event 特殊处理
    const dataCategory: DataCategory =
      eventType === 'replay_event' ? 'replay' : eventType;

    // 事件对象可能包含一些元数据，这些元数据可以用于处理时的特殊情况
    const sdkProcessingMetadata = event.sdkProcessingMetadata || {};
    // 获取可能存在的隔离作用域信息
    const capturedSpanIsolationScope: Scope | undefined =
      sdkProcessingMetadata.capturedSpanIsolationScope;

    // 开始处理事件的准备工作
    return this._prepareEvent(
      event,
      hint,
      currentScope,
      capturedSpanIsolationScope,
    )
      .then((prepared) => {
        // prepared 这是经过准备后的事件对象

        // 如果事件在准备阶段被处理器丢弃（即某些事件处理器返回了 null）
        if (prepared === null) {
          // 则记录这个被丢弃的事件，并抛出 SentryError,这意味着事件将不会被发送
          this.recordDroppedEvent('event_processor', dataCategory, event);
          throw new SentryError(
            'An event processor returned `null`, will not send event.',
            'log',
          );
        }

        // 判断该事件是否为 SDK 内部生成的异常
        const isInternalException =
          hint.data &&
          (hint.data as { __sentry__: boolean }).__sentry__ === true;

        // hint.data.__sentry__ 为 true，说明这是一个内部异常，直接返回 prepared 的事件结果，不再进行后续处理
        if (isInternalException) {
          return prepared;
        }

        // 调用了 beforeSend 钩子函数，允许开发者在事件正式发送到 Sentry 前对事件进行进一步处理和修改
        const result = processBeforeSend(this, options, prepared, hint);
        // 验证 beforeSend 钩子的返回值。如果 beforeSend 返回 null，意味着事件被用户选择丢弃
        return _validateBeforeSendResult(result, beforeSendLabel);
      })
      .then((processedEvent) => {
        // 如果 beforeSend 返回 null，表示事件被丢弃。
        // 在这种情况下，事件不会被发送，SDK 会记录这是由于 before_send 阶段导致的丢弃
        if (processedEvent === null) {
          this.recordDroppedEvent('before_send', dataCategory, event);

          // 如果这是一个事务,SDK 还会记录丢弃的 span 数量（事务中每个操作都被称为一个 span）
          if (isTransaction) {
            const spans = event.spans || [];
            // 事务本身算作一个跨度，加上所有添加的子跨度
            const spanCount = 1 + spans.length;
            this.recordDroppedEvent('before_send', 'span', spanCount);
          }

          // 抛出错误
          throw new SentryError(
            `${beforeSendLabel} returned \`null\`, will not send event.`,
            'log',
          );
        }

        // 获取当前作用域的会话
        const session = currentScope && currentScope.getSession();
        // 如果事件不是事务类型且当前作用域包含会话信息
        if (!isTransaction && session) {
          // 更新会话状态（例如，错误可能会影响用户会话的健康度）
          this._updateSessionFromEvent(session, processedEvent);
        }

        // 如果当前事件是事务
        if (isTransaction) {
          // 在事务的上下文中，SDK 会比较 span 的数量是否在处理过程中有所减少

          /**
           * 在分布式追踪系统中，每个事务可能会包含多个操作，称为 span,每个 span 代表一个子操作或步骤
           * Sentry 中的事务是基于 span 构建的，整个事务可能包含多个 span，每个 span 都有其自身的开始和结束时间，用来表示具体操作的时长
           */

          // 事件进入 SDK 处理流程之前，记录的 span 数量
          const spanCountBefore =
            (processedEvent.sdkProcessingMetadata &&
              processedEvent.sdkProcessingMetadata.spanCountBeforeProcessing) ||
            0;

          // 计算了事件最终包含的 span 数量
          const spanCountAfter = processedEvent.spans
            ? processedEvent.spans.length
            : 0;

          // 如果 spanCountBefore 大于 spanCountAfter，表示有 span 被丢弃，SDK 会记录这一信息，以便后续分析
          const droppedSpanCount = spanCountBefore - spanCountAfter;
          if (droppedSpanCount > 0) {
            this.recordDroppedEvent('before_send', 'span', droppedSpanCount);
          }
        }

        /**
         * 事务代表一个逻辑操作的整体，例如一个 HTTP 请求的处理、一个数据库查询等。
         * 事务名用来描述这个操作的性质，通常是通过 SDK 自动生成的。
         * 任何Sentry构建的事件处理器都不会更新事务名称，所以如果事件处理器更改了事务名称，
         * 我们知道它必须来自用户添加的自定义事件处理器
         */

        const transactionInfo = processedEvent.transaction_info;
        if (
          isTransaction &&
          transactionInfo &&
          // 事件处理完成后的事务名 不等于  事件的事务名
          // 说明用户的自定义事件处理器,更改了事务名
          processedEvent.transaction !== event.transaction
        ) {
          // 更新 transaction_info 添加或更新 source 字段为 'custom'
          // 这表示事务名的变更来源于用户自定义的处理器，而不是 Sentry 内建的事件处理逻辑。
          // 这样，后续分析时可以明确区分事务名是自动生成的，还是经过用户修改的。
          const source = 'custom';
          processedEvent.transaction_info = {
            ...transactionInfo,
            source,
          };
        }

        // 最后，经过准备和处理的事件被发送到 Sentry，发送完成后返回 processedEvent
        this.sendEvent(processedEvent, hint);
        return processedEvent;
      })
      .then(null, (reason) => {
        // 这里是错误处理

        // 如果发生的错误是 SentryError，则直接抛出
        if (reason instanceof SentryError) {
          throw reason;
        }

        // 如果不是 SentryError 类型的错误，SDK 会捕获这个异常并发送到 Sentry
        // 表示事件处理过程中出现了问题,同时生成一个新的事件来报告这个错误
        this.captureException(reason, {
          data: {
            __sentry__: true,
          },
          originalException: reason,
        });

        // 抛出新的 SentryError，说明原始事件没有被发送
        throw new SentryError(
          `Event processing pipeline threw an error, original event will not be sent. Details have been sent as a new event.\nReason: ${reason}`,
        );
      });
  }

  /**
   * 负责管理和跟踪处理中的事件数量
   *
   * 这种逻辑在并发事件处理系统中很重要。
   * 它确保了系统随时可以跟踪处理中的事件数量，并在必要时采取相应的操作（例如等待所有事件处理完成后再执行某些行为）
   *
   * this._numProcessing 的计数可以用于判断是否还有未完成的事件。
   * 如果计数为 0，表示所有事件都处理完毕，SDK 可能可以执行清理、刷新等操作。
   *
   * @param promise 这个 Promise 表示一个异步的事件处理过程
   */
  protected _process<T>(promise: PromiseLike<T>): void {
    // 每当事件处理开始时，增加事件的计数器
    this._numProcessing++;

    // 当事件处理结束时，无论是成功还是失败，都减少计数器
    void promise.then(
      (value) => {
        this._numProcessing--;
        return value;
      },
      (reason) => {
        this._numProcessing--;
        return reason;
      },
    );
  }

  /**
   * 这个方法的主要功能是清空当前客户端的结果，并返回它们的副本
   */
  protected _clearOutcomes(): Outcome[] {
    // 拷贝一份
    const outcomes = this._outcomes;

    // 清空
    this._outcomes = {};

    // 将结果中的每个键值对转换为一个更易读的格式，
    return Object.entries(outcomes).map(([key, quantity]) => {
      const [reason, category] = key.split(':') as [
        EventDropReason,
        DataCategory,
      ];
      return {
        reason,
        category,
        quantity,
      };
    });
  }

  /**
   * 这个方法用于发送客户端报告
   */
  protected _flushOutcomes(): void {
    // debug 模式下输出日志，表示正在刷新结果
    DEBUG_BUILD && logger.log('Flushing outcomes...');

    // 获取当前的结果
    const outcomes = this._clearOutcomes();

    // 如果没有结果需要发送，则记录日志并返回
    if (outcomes.length === 0) {
      DEBUG_BUILD && logger.log('No outcomes to send');
      return;
    }

    // 这是发送结果的唯一地方，只有在存在 DSN 的情况下才会发送结果。如果没有提供 DSN，则记录日志并返回。
    if (!this._dsn) {
      DEBUG_BUILD && logger.log('No dsn provided, will not send outcomes');
      return;
    }

    DEBUG_BUILD && logger.log('Sending outcomes:', outcomes);

    // 创建一个信封，包含所有需要发送的结果
    const envelope = createClientReportEnvelope(
      outcomes,
      this._options.tunnel && dsnToString(this._dsn),
    );

    // sendEnvelope should not throw
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    // 将包装完的信封发送
    this.sendEnvelope(envelope);
  }

  /**
   * 从传入的异常对象生成一个标准化的事件
   * 这通常涉及到将异常的详细信息（例如堆栈跟踪、消息等）转化为一个结构化的事件格式，以便于监控和分析。
   *
   * 抽象方法,其他类去实现这个抽象类的时候 必须实现这个方法
   * @inheritDoc
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public abstract eventFromException(
    _exception: any,
    _hint?: EventHint,
  ): PromiseLike<Event>;

  /**
   * 从给定的消息生成一个标准化的事件，通常包括将消息和严重性级别转换为结构化的事件格式，以便在发生错误或重要事件时进行监控和分析。
   *
   * 抽象方法
   * @inheritDoc
   */
  public abstract eventFromMessage(
    _message: ParameterizedString,
    _level?: SeverityLevel,
    _hint?: EventHint,
  ): PromiseLike<Event>;
}

/**
 * 这个函数的目的是验证 beforeSend 或 beforeSendTransaction 返回的值是否为 null 或有效的事件对象（即 Event）。
 */
function _validateBeforeSendResult(
  beforeSendResult: PromiseLike<Event | null> | Event | null,
  beforeSendLabel: string,
): PromiseLike<Event | null> | Event | null {
  /**
   * 创建一个错误信息字符串，告知调用者 beforeSend 函数必须返回 null 或一个有效的事件对象。
   * beforeSendLabel 是传入的标签，用于指示是哪个回调函数产生的问题。
   */
  const invalidValueError = `${beforeSendLabel} must return \`null\` or a valid event.`;

  //  检查 beforeSendResult 是否是一个 Promise
  if (isThenable(beforeSendResult)) {
    return beforeSendResult.then(
      (event) => {
        // 成功处理函数

        // 检查解析后的 event 是否是一个有效的事件对象
        if (!isPlainObject(event) && event !== null) {
          // 如果 event 既不是 null 也不是一个普通对象（即事件对象）

          // 抛出一个 SentryError 异常
          throw new SentryError(invalidValueError);
        }

        // 如果 event 是有效的，返回该 event
        return event;
      },
      (e) => {
        // 失败处理函数

        // 抛出一个SentryError, 提示 beforeSendLabel 返回的 Promise 被拒绝，并附带错误信息。
        throw new SentryError(`${beforeSendLabel} rejected with ${e}`);
      },
    );

    //检查它是否是一个普通对象或 null
  } else if (!isPlainObject(beforeSendResult) && beforeSendResult !== null) {
    // 既不是普通对象也不是 null，则抛出 SentryError，表示返回的值无效
    throw new SentryError(invalidValueError);
  }

  // 如果 beforeSendResult 是有效的，则直接返回它
  return beforeSendResult;
}

/**
 * 用于处理与 Sentry 客户端的 beforeSendXXX 回调相关的逻辑
 *
 * @param client  Sentry 客户端实例
 * @param options 客户端的选项，包括可能的回调函数
 * @param event 要处理的事件
 * @param hint 可能包含附加信息的提示对象
 * @returns
 */
function processBeforeSend(
  client: Client,
  options: ClientOptions,
  event: Event,
  hint: EventHint,
): PromiseLike<Event | null> | Event | null {
  // 这三个回调函数用于处理事件的不同情况
  const { beforeSend, beforeSendTransaction, beforeSendSpan } = options;

  // 检查事件是否为错误事件（即不具备类型属性）,并且 beforeSend 回调是否存在
  if (isErrorEvent(event) && beforeSend) {
    // 则调用 beforeSend，并返回其结果
    return beforeSend(event, hint);
  }

  // 检查事件是否为事务事件
  if (isTransactionEvent(event)) {
    // 如果事件包含 spans（表示该事件有子跨度）且存在 beforeSendSpan 回调
    if (event.spans && beforeSendSpan) {
      // 存储处理后的子跨度
      const processedSpans: SpanJSON[] = [];

      // 遍历事件中的所有的span
      for (const span of event.spans) {
        // 对于每个 span，调用 beforeSendSpan 函数
        const processedSpan = beforeSendSpan(span);
        if (processedSpan) {
          // 如果返回值有效，则将其添加到 processedSpans 数组中
          processedSpans.push(processedSpan);
        } else {
          // 否则记录被丢弃的子跨度事件
          client.recordDroppedEvent('before_send', 'span');
        }
      }

      // 将处理完的 span 重新赋值给 事件中的span
      // 在发送事件的时候有一步骤会去对比,事件处理前后 span 的数量是否发生了变化
      event.spans = processedSpans;
    }

    // 如果存在 beforeSendTransaction 回调
    if (beforeSendTransaction) {
      if (event.spans) {
        // 如果事件包含 spans，则记录处理前的跨度数量
        // 并将其存储在 sdkProcessingMetadata 中，以便后续对比处理后丢弃的跨度数量
        const spanCountBefore = event.spans.length;
        event.sdkProcessingMetadata = {
          ...event.sdkProcessingMetadata,
          spanCountBeforeProcessing: spanCountBefore,
        };
      }

      // 返回 beforeSendTransaction 的结果,这将处理当前的事务事件
      return beforeSendTransaction(event, hint);
    }
  }

  // :如果事件不是错误事件或事务事件，则直接返回原始的 event
  return event;
}

/** 用于判断事件是否为错误事件。根据其类型是否未定义来确定 */
function isErrorEvent(event: Event): event is ErrorEvent {
  return event.type === undefined;
}

/** 用于判断事件是否为事务事件,检查 event.type 是否等于 'transaction' 来判断 */
function isTransactionEvent(event: Event): event is TransactionEvent {
  return event.type === 'transaction';
}
