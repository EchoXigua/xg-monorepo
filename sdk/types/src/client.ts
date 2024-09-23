import type { Breadcrumb, BreadcrumbHint } from './breadcrumb';
import type { CheckIn, MonitorConfig } from './checkin';
import type { EventDropReason } from './clientreport';
import type { DataCategory } from './datacategory';
import type { DsnComponents } from './dsn';
import type { DynamicSamplingContext, Envelope } from './envelope';
import type { Event, EventHint } from './event';
import type { EventProcessor } from './eventprocessor';
import type { FeedbackEvent } from './feedback';
import type { Integration } from './integration';
import type { ClientOptions } from './options';
import type { ParameterizedString } from './parameterize';
import type { Scope } from './scope';
import type { SdkMetadata } from './sdkmetadata';
import type { Session, SessionAggregates } from './session';
import type { SeverityLevel } from './severity';
import type { Span, SpanAttributes, SpanContextData } from './span';
import type { StartSpanOptions } from './startSpanOptions';
import type { Transport, TransportMakeRequestResponse } from './transport';

/**
 * 面向用户的客户端,用于与 Sentry 进行交互
 *
 * 这个接口定义了一系列方法和钩子（hooks），用于捕获异常、发送事件、记录会话、处理自定义逻辑等
 * 每个方法在 SDK 被安装后，可用于发送事件到 Sentry，或者自定义事件处理逻辑
 *
 * This interface contains all methods to interface with the SDK once it has
 * been installed. It allows to send events to Sentry, record breadcrumbs and
 * set a context included in every event. Since the SDK mutates its environment,
 * there will only be one instance during runtime.
 *
 */
export interface Client<O extends ClientOptions = ClientOptions> {
  /**
   * 捕获异常并发送到 Sentry
   *
   * 不像从每个SDK导出的' captureException '，这个方法需要你传递给它当前作用域
   *
   * @param exception 要捕获的异常对象
   * @param hint 额外的异常信息（可选）
   * @param currentScope 当前作用域，包含元数据（可选）
   * @returns 生成的事件 ID
   */
  captureException(
    exception: any,
    hint?: EventHint,
    currentScope?: Scope,
  ): string;

  /**
   * 捕获一条信息（message）并发送到 Sentry，通常用于手动记录日志或调试信息
   *
   * 不像从每个SDK导出的' captureMessage '，这个方法需要你传递给它当前的作用域
   *
   * @param message 要发送的消息
   * @param level 消息的级别（如 error、warning 等）
   * @param hint 额外信息（可选）
   * @param currentScope 当前作用域（可选）
   * @returns 生成的事件 ID
   */
  captureMessage(
    message: string,
    level?: SeverityLevel,
    hint?: EventHint,
    currentScope?: Scope,
  ): string;

  /**
   * 发送手动创建的事件，直接将一个预先构建的 Event 对象发送到 Sentry
   *
   * 不像从每个SDK导出的' captureEvent '，这个方法需要你传递它当前的作用域。
   *
   * @param event 事件对象
   * @param hint 额外信息（可选）
   * @param currentScope 当前作用域（可选）
   * @returns 生成的事件 ID
   */
  captureEvent(event: Event, hint?: EventHint, currentScope?: Scope): string;

  /**
   * 捕获会话信息，用于跟踪会话状态
   *
   * @param session 需要捕获的会话对象
   */
  captureSession(session: Session): void;

  /**
   * 创建 cron 监控的检查点，并发送到 Sentry
   * 此方法并非在所有客户端上都可用。
   *
   * @param checkIn 检查点的描述对象
   * @param upsertMonitorConfig 描述监视器配置的可选对象
   * 如果您希望在发送签入时自动创建监视器，请使用此选项
   * @param scope 当前作用域（可选）
   * @returns  检查点的 ID
   */
  captureCheckIn?(
    checkIn: CheckIn,
    monitorConfig?: MonitorConfig,
    scope?: Scope,
  ): string;

  /** 获取当前 Sentry 的 DSN（数据源名称），用于标识发送数据的目标 Sentry 项目 */
  getDsn(): DsnComponents | undefined;

  /** 获取当前客户端的配置选项 */
  getOptions(): O;

  /**
   * 获取 SDK 的元数据
   * @inheritdoc
   *
   */
  getSdkMetadata(): SdkMetadata | undefined;

  /**
   * 获取用于发送事件的传输层实现
   *
   * 传输层并不会在客户端初始化时立刻创建，而是采用惰性初始化的方式。
   * 这意味着只有当第一个事件被发送时，传输层才会被创建和初始化
   *
   * 通过惰性初始化，Sentry 可以节省资源，只有在需要的时候才会初始化传输层，减少不必要的开销
   *
   * @returns 传输层对象（如果事件未发送过，则返回 undefined）
   */
  getTransport(): Transport | undefined;

  /**
   * 用于刷新事件队列并将客户端的状态设置为 enabled = false，也就是关闭客户端，使其停止处理和发送事件
   * See {@link Client.flush}.
   *
   * @param timeout 表示客户端等待关闭的最长时间，单位为毫秒（ms）
   * - 如果指定了 timeout，客户端将在指定时间内等待所有事件发送完成后关闭
   * - 如果没有指定 timeout，客户端将会等待所有事件发送完毕再关闭，无论需要多长时间
   * @returns 如果在 timeout 时间内成功完成所有事件的发送并关闭客户端，Promise 会解析为 true
   * 如果超出 timeout 时间，还有事件未能发送，Promise 会解析为 false
   */
  close(timeout?: number): PromiseLike<boolean>;

  /**
   * 用于等待所有事件发送完毕或等待超时，以确保在执行其他操作之前尽可能多地发送待处理事件
   *
   * @param timeout 表示客户端等待所有事件发送完成的最长时间，单位为毫秒（ms）
   * - 如果指定了 timeout，客户端将在指定时间内等待所有事件发送完成后关闭
   * - 如果没有指定 timeout，客户端将会等待所有事件发送完毕再关闭，无论需要多长时间
   * @returns
   *  - 如果在指定的 timeout 时间内成功发送完所有事件，Promise 会解析为 true
   *  - 如果超出 timeout 时间还有事件未能发送，Promise 会解析为 false
   */
  flush(timeout?: number): PromiseLike<boolean>;

  /**
   * 添加一个事件处理器，用于处理或修改任何要发送的事件
   */
  addEventProcessor(eventProcessor: EventProcessor): void;

  /**
   * 获取所有已添加的事件处理器
   */
  getEventProcessors(): EventProcessor[];

  /** 获取指定名称的集成 */
  getIntegrationByName<T extends Integration = Integration>(
    name: string,
  ): T | undefined;

  /**
   * 用于向客户端添加一个集成
   * 集成是用于扩展 Sentry 功能的模块，可以帮助捕获特定的事件或提供额外的上下文信息
   *
   * - 延迟加载集成：这个方法可以在运行时添加集成，而不是在初始化时一次性加载所有集成
   * 这种方式称为“懒加载”，可以提高性能，特别是在集成不一定会被使用的情况下
   * - 条件加载：如果某些集成仅在特定条件下需要，可以使用 addIntegration 方法来根据需要动态地添加集成
   *
   * - 通常情况下，推荐在初始化客户端时通过 integrations: [] 直接传入所有需要的集成，
   * 而不是在运行时逐个添加。这是因为在初始化时可以确保所有集成都已正确配置。
   * */
  addIntegration(integration: Integration): void;

  /**
   * 初始化客户端
   * 在将客户端设置为作用域后调用此函数
   */
  init(): void;

  /** Creates an {@link Event} from all inputs to `captureException` and non-primitive inputs to `captureMessage`. */
  eventFromException(exception: any, hint?: EventHint): PromiseLike<Event>;

  /** Creates an {@link Event} from primitive inputs to `captureMessage`. */
  eventFromMessage(
    message: ParameterizedString,
    level?: SeverityLevel,
    hint?: EventHint,
  ): PromiseLike<Event>;

  /** Submits the event to Sentry */
  sendEvent(event: Event, hint?: EventHint): void;

  /** Submits the session to Sentry */
  sendSession(session: Session | SessionAggregates): void;

  /** Sends an envelope to Sentry */
  sendEnvelope(envelope: Envelope): PromiseLike<TransportMakeRequestResponse>;

  /**
   * Record on the client that an event got dropped (ie, an event that will not be sent to sentry).
   *
   * @param reason The reason why the event got dropped.
   * @param category The data category of the dropped event.
   * @param event The dropped event.
   */
  recordDroppedEvent(
    reason: EventDropReason,
    dataCategory: DataCategory,
    event?: Event,
  ): void;

  // HOOKS
  /* eslint-disable @typescript-eslint/unified-signatures */

  /**
   * Register a callback for whenever a span is started.
   * Receives the span as argument.
   * @returns A function that, when executed, removes the registered callback.
   */
  on(hook: 'spanStart', callback: (span: Span) => void): () => void;

  /**
   * Register a callback before span sampling runs. Receives a `samplingDecision` object argument with a `decision`
   * property that can be used to make a sampling decision that will be enforced, before any span sampling runs.
   * @returns A function that, when executed, removes the registered callback.
   */
  on(
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

  /**
   * Register a callback for whenever a span is ended.
   * Receives the span as argument.
   * @returns A function that, when executed, removes the registered callback.
   */
  on(hook: 'spanEnd', callback: (span: Span) => void): () => void;

  /**
   * Register a callback for when an idle span is allowed to auto-finish.
   * @returns A function that, when executed, removes the registered callback.
   */
  on(
    hook: 'idleSpanEnableAutoFinish',
    callback: (span: Span) => void,
  ): () => void;

  /**
   * Register a callback for transaction start and finish.
   * @returns A function that, when executed, removes the registered callback.
   */
  on(
    hook: 'beforeEnvelope',
    callback: (envelope: Envelope) => void,
  ): () => void;

  /**
   * Register a callback that runs when stack frame metadata should be applied to an event.
   * @returns A function that, when executed, removes the registered callback.
   */
  on(hook: 'applyFrameMetadata', callback: (event: Event) => void): () => void;

  /**
   * Register a callback for before sending an event.
   * This is called right before an event is sent and should not be used to mutate the event.
   * Receives an Event & EventHint as arguments.
   * @returns A function that, when executed, removes the registered callback.
   */
  on(
    hook: 'beforeSendEvent',
    callback: (event: Event, hint?: EventHint | undefined) => void,
  ): () => void;

  /**
   * Register a callback for preprocessing an event,
   * before it is passed to (global) event processors.
   * Receives an Event & EventHint as arguments.
   * @returns A function that, when executed, removes the registered callback.
   */
  on(
    hook: 'preprocessEvent',
    callback: (event: Event, hint?: EventHint | undefined) => void,
  ): () => void;

  /**
   * Register a callback for when an event has been sent.
   * @returns A function that, when executed, removes the registered callback.
   */
  on(
    hook: 'afterSendEvent',
    callback: (
      event: Event,
      sendResponse: TransportMakeRequestResponse,
    ) => void,
  ): () => void;

  /**
   * Register a callback before a breadcrumb is added.
   * @returns A function that, when executed, removes the registered callback.
   */
  on(
    hook: 'beforeAddBreadcrumb',
    callback: (breadcrumb: Breadcrumb, hint?: BreadcrumbHint) => void,
  ): () => void;

  /**
   * Register a callback when a DSC (Dynamic Sampling Context) is created.
   * @returns A function that, when executed, removes the registered callback.
   */
  on(
    hook: 'createDsc',
    callback: (dsc: DynamicSamplingContext, rootSpan?: Span) => void,
  ): () => void;

  /**
   * Register a callback when a Feedback event has been prepared.
   * This should be used to mutate the event. The options argument can hint
   * about what kind of mutation it expects.
   * @returns A function that, when executed, removes the registered callback.
   */
  on(
    hook: 'beforeSendFeedback',
    callback: (
      feedback: FeedbackEvent,
      options?: { includeReplay?: boolean },
    ) => void,
  ): () => void;

  /**
   * A hook for the browser tracing integrations to trigger a span start for a page load.
   * @returns A function that, when executed, removes the registered callback.
   */
  on(
    hook: 'startPageLoadSpan',
    callback: (
      options: StartSpanOptions,
      traceOptions?: {
        sentryTrace?: string | undefined;
        baggage?: string | undefined;
      },
    ) => void,
  ): () => void;

  /**
   * A hook for browser tracing integrations to trigger a span for a navigation.
   * @returns A function that, when executed, removes the registered callback.
   */
  on(
    hook: 'startNavigationSpan',
    callback: (options: StartSpanOptions) => void,
  ): () => void;

  /**
   * A hook that is called when the client is flushing
   * @returns A function that, when executed, removes the registered callback.
   */
  on(hook: 'flush', callback: () => void): () => void;

  /**
   * A hook that is called when the client is closing
   * @returns A function that, when executed, removes the registered callback.
   */
  on(hook: 'close', callback: () => void): () => void;

  /** Fire a hook whener a span starts. */
  emit(hook: 'spanStart', span: Span): void;

  /** A hook that is called every time before a span is sampled. */
  emit(
    hook: 'beforeSampling',
    samplingData: {
      spanAttributes: SpanAttributes;
      spanName: string;
      parentSampled?: boolean;
      parentContext?: SpanContextData;
    },
    samplingDecision: { decision: boolean },
  ): void;

  /** Fire a hook whener a span ends. */
  emit(hook: 'spanEnd', span: Span): void;

  /**
   * Fire a hook indicating that an idle span is allowed to auto finish.
   */
  emit(hook: 'idleSpanEnableAutoFinish', span: Span): void;

  /*
   * Fire a hook event for envelope creation and sending. Expects to be given an envelope as the
   * second argument.
   */
  emit(hook: 'beforeEnvelope', envelope: Envelope): void;

  /*
   * Fire a hook indicating that stack frame metadata should be applied to the event passed to the hook.
   */
  emit(hook: 'applyFrameMetadata', event: Event): void;

  /**
   * Fire a hook event before sending an event.
   * This is called right before an event is sent and should not be used to mutate the event.
   * Expects to be given an Event & EventHint as the second/third argument.
   */
  emit(hook: 'beforeSendEvent', event: Event, hint?: EventHint): void;

  /**
   * Fire a hook event to process events before they are passed to (global) event processors.
   * Expects to be given an Event & EventHint as the second/third argument.
   */
  emit(hook: 'preprocessEvent', event: Event, hint?: EventHint): void;

  /*
   * Fire a hook event after sending an event. Expects to be given an Event as the
   * second argument.
   */
  emit(
    hook: 'afterSendEvent',
    event: Event,
    sendResponse: TransportMakeRequestResponse,
  ): void;

  /**
   * Fire a hook for when a breadcrumb is added. Expects the breadcrumb as second argument.
   */
  emit(
    hook: 'beforeAddBreadcrumb',
    breadcrumb: Breadcrumb,
    hint?: BreadcrumbHint,
  ): void;

  /**
   * Fire a hook for when a DSC (Dynamic Sampling Context) is created. Expects the DSC as second argument.
   */
  emit(hook: 'createDsc', dsc: DynamicSamplingContext, rootSpan?: Span): void;

  /**
   * Fire a hook event for after preparing a feedback event. Events to be given
   * a feedback event as the second argument, and an optional options object as
   * third argument.
   */
  emit(
    hook: 'beforeSendFeedback',
    feedback: FeedbackEvent,
    options?: { includeReplay?: boolean },
  ): void;

  /**
   * Emit a hook event for browser tracing integrations to trigger a span start for a page load.
   */
  emit(
    hook: 'startPageLoadSpan',
    options: StartSpanOptions,
    traceOptions?: {
      sentryTrace?: string | undefined;
      baggage?: string | undefined;
    },
  ): void;

  /**
   * Emit a hook event for browser tracing integrations to trigger a span for a navigation.
   */
  emit(hook: 'startNavigationSpan', options: StartSpanOptions): void;

  /**
   * Emit a hook event for client flush
   */
  emit(hook: 'flush'): void;

  /**
   * Emit a hook event for client close
   */
  emit(hook: 'close'): void;

  /* eslint-enable @typescript-eslint/unified-signatures */
}
