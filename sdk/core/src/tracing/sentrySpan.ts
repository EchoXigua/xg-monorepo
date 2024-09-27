import type {
  SentrySpanArguments,
  Span,
  SpanAttributeValue,
  SpanAttributes,
  SpanContextData,
  SpanEnvelope,
  SpanJSON,
  SpanOrigin,
  SpanStatus,
  SpanTimeInput,
  TimedEvent,
  TransactionEvent,
  TransactionSource,
} from '@xigua-monitor/types';
import {
  dropUndefinedKeys,
  logger,
  timestampInSeconds,
  uuid4,
} from '@xigua-monitor/utils';
import { getClient, getCurrentScope } from '../currentScopes';
import { DEBUG_BUILD } from '../debug-build';

import { createSpanEnvelope } from '../envelope';
import { getMetricSummaryJsonForSpan } from '../metrics/metric-summary';
import {
  SEMANTIC_ATTRIBUTE_EXCLUSIVE_TIME,
  SEMANTIC_ATTRIBUTE_PROFILE_ID,
  SEMANTIC_ATTRIBUTE_SENTRY_OP,
  SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN,
  SEMANTIC_ATTRIBUTE_SENTRY_SOURCE,
} from '../semanticAttributes';
import {
  TRACE_FLAG_NONE,
  TRACE_FLAG_SAMPLED,
  getRootSpan,
  getSpanDescendants,
  getStatusMessage,
  spanTimeInputToSeconds,
  spanToJSON,
  spanToTransactionTraceContext,
} from '../utils/spanUtils';
import { getDynamicSamplingContextFromSpan } from './dynamicSamplingContext';
import { logSpanEnd } from './logSpans';
import { timedEventsToMeasurements } from './measurement';
import { getCapturedScopesOnSpan } from './utils';

const MAX_SPAN_COUNT = 1000;

/**
 * SentrySpan 类是 Sentry SDK 中用于追踪和记录应用程序执行过程中的时间跨度及其相关信息的核心类
 * 通过合理使用 Span 和 Trace，可以帮助开发者监控应用程序的性能瓶颈和异常情况
 * Span contains all data about a span
 */
export class SentrySpan implements Span {
  /** 每个 SentrySpan 都会有一个唯一的 traceId，用于标识整个分布式事务 */
  protected _traceId: string;
  /** 该 span 的唯一标识符 */
  protected _spanId: string;
  /** 存储父级 span 的 ID */
  protected _parentSpanId?: string | undefined;
  /** 该 span 是否被采样，采样决定了该 span 是否被报告到 Sentry */
  protected _sampled: boolean | undefined;
  /** Span 的名称 */
  protected _name?: string | undefined;
  /** Span 的属性集合 */
  protected _attributes: SpanAttributes;
  /** span 的开始时间 */
  protected _startTime: number;
  /** span 的结素和时间 */
  protected _endTime?: number | undefined;
  /** Span 的状态，表示追踪单元的当前状态 */
  protected _status?: SpanStatus;
  /** 存储了和该 span 相关的事件 */
  protected _events: TimedEvent[];

  /** 标识该 span 是否为独立的 span（不属于任何 transaction） */
  private _isStandaloneSpan?: boolean;

  /**
   * 你不应该手动调用构造函数，总是使用' Sentry.startSpan() '或其他span方法
   *
   * @internal
   * @hideconstructor
   * @hidden
   */
  public constructor(spanContext: SentrySpanArguments = {}) {
    // 属性初始化
    this._traceId = spanContext.traceId || uuid4();
    this._spanId = spanContext.spanId || uuid4().substring(16);
    this._startTime = spanContext.startTimestamp || timestampInSeconds();

    this._attributes = {};
    // 为 Span 设置一些默认属性和用户传入的属性
    this.setAttributes({
      // 表示手动创建的 Span
      [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'manual',
      [SEMANTIC_ATTRIBUTE_SENTRY_OP]: spanContext.op,
      ...spanContext.attributes,
    });

    // span 上下文信息中提供了 name 则使用它
    this._name = spanContext.name;

    // 如果提供了 parentSpanId，则设置为当前 Span 的父 Span ID，用于构建 Span 层次结构
    if (spanContext.parentSpanId) {
      this._parentSpanId = spanContext.parentSpanId;
    }
    // 设置采样
    if ('sampled' in spanContext) {
      this._sampled = spanContext.sampled;
    }
    if (spanContext.endTimestamp) {
      this._endTime = spanContext.endTimestamp;
    }

    /** 初始化一个空数组，存储在 Span 生命周期中记录的事件 */
    this._events = [];

    // 是否一个独立的 Span（不属于某个事务）
    this._isStandaloneSpan = spanContext.isStandalone;

    // 在创建时已经提供了结束时间 endTime，则立即调用 _onSpanEnded() 方法来处理 Span 结束的逻辑
    if (this._endTime) {
      this._onSpanEnded();
    }
  }

  /**
   * 直接返回 this，即当前实例本身，表示对 SentrySpan 实例没有进行任何更改
   * 主要是为了满足 OpenTelemetry 的 Span 接口要求，但在 Sentry 中没有实际的实现需求
   *
   * @hidden
   * @internal
   */
  public addLink(_link: unknown): this {
    return this;
  }

  /**
   * 返回值也是 this，同样没有对实例进行任何修改
   * 为了支持 OpenTelemetry 标准中可能存在的添加多个 Link 的场景，但在 Sentry 中不做实际操作
   *
   * 背景：
   * - OpenTelemetry 是一个用于分布式追踪和监控的开放标准。
   * 它定义了一个 Span 接口，其中包含多个用于操作 Span 的方法，比如 addLink、addLinks
   * - Link 在 OpenTelemetry 中表示当前 Span 与另一个 Span 之间的关联，它通常用于描述跨服务、跨进程的调用关系
   * - Sentry 的追踪实现并不直接使用这些链接功能，因此这两个方法被实现为空方法，
   * 即它们不执行任何操作，但为了保持与 OpenTelemetry 接口的兼容性，必须定义它们
   *
   * Sentry 中不需要使用这些方法来处理 Span 链接，因为 Sentry 的内部机制可能有其他方式处理 Span 的关联或层级关系
   * 这些方法的主要目的是为了兼容 OpenTelemetry 接口，而不是为 Sentry 的核心功能服务
   *
   * @hidden
   * @internal
   */
  public addLinks(_links: unknown[]): this {
    return this;
  }

  /**
   * 方法的作用是为了与 OTEL (OpenTelemetry) Span 接口 保持兼容，
   * 但在 Sentry 的实现中，它并没有实际的功能，
   * 在 OTEL 中，recordException 通常会存储异常的相关信息，
   * 如异常类型、消息、堆栈跟踪、时间等。然后将这些信息附加到 Span，以便在分布式追踪系统中查看
   *
   * Sentry 本身有其他更强大和直接的错误捕获机制，
   * 因此在 SentrySpan 类中没有必要通过 recordException 方法来记录异常
   *
   * @hidden
   * @internal
   */
  public recordException(
    _exception: unknown,
    _time?: number | undefined,
  ): void {
    // noop
  }

  /**
   * 返回当前 SentrySpan 实例的上下文信息，用于追踪请求链路中的信息
   * @inheritdoc
   *
   */
  public spanContext(): SpanContextData {
    const { _spanId: spanId, _traceId: traceId, _sampled: sampled } = this;
    return {
      spanId,
      traceId,
      traceFlags: sampled ? TRACE_FLAG_SAMPLED : TRACE_FLAG_NONE,
    };
  }

  /**
   * 给当前 Span 设置自定义的属性（单个）
   * @inheritdoc
   */
  public setAttribute(
    key: string,
    value: SpanAttributeValue | undefined,
  ): this {
    if (value === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete this._attributes[key];
    } else {
      this._attributes[key] = value;
    }

    return this;
  }

  /**
   * 批量给当前 Span 设置自定义的属性
   * @inheritdoc
   *
   */
  public setAttributes(attributes: SpanAttributes): this {
    Object.keys(attributes).forEach((key) =>
      this.setAttribute(key, attributes[key]),
    );
    return this;
  }

  /**
   * 手动更新该 Span 的起始时间
   * 这个功能主要是为了浏览器端的追踪场景，某些情况下需要调整开始时间
   * 此方法是内部方法，建议慎用
   *
   * 该方法用于特殊场景，如在浏览器环境中，开发者可能希望在 Span 已经开始后动态调整其起始时间
   * 但由于调整时间可能导致追踪数据不一致或失真，因此建议慎用
   *
   * @hidden
   * @internal
   */
  public updateStartTime(timeInput: SpanTimeInput): void {
    this._startTime = spanTimeInputToSeconds(timeInput);
  }

  /**
   * 用于设置 Span 的状态，通常用来记录该 Span 的执行结果，例如成功、失败、或其它特定状态
   * @inheritDoc
   */
  public setStatus(value: SpanStatus): this {
    this._status = value;
    return this;
  }

  /**
   * 动态更新 Span 的名称
   * @inheritDoc
   */
  public updateName(name: string): this {
    this._name = name;
    return this;
  }

  /**
   * 用于结束一个 Span 并记录其结束时间
   * 如果该 Span 已经结束，方法会直接返回，不再重复记录结束操作
   *
   * @inheritdoc
   */
  public end(endTimestamp?: SpanTimeInput): void {
    // If already ended, skip
    // 如果已经有 _endTime，即已经结束过，跳过处理
    if (this._endTime) {
      return;
    }

    // 将 endTimestamp 转换为秒
    this._endTime = spanTimeInputToSeconds(endTimestamp);
    // 记录结束的 Span
    logSpanEnd(this);

    // 进行 Span 结束后的处理工作
    this._onSpanEnded();
  }

  /**
   * 返回当前 Span 的 JSON 表示形式
   *
   * @hidden
   * @internal 该方法是用于 SDK 内部的，通常用于调试或记录目的。
   * 开发者在外部应使用 spanToJSON() 方法获取 Span 的 JSON 数据，而不是直接调用此方法
   */
  public getSpanJSON(): SpanJSON {
    return dropUndefinedKeys({
      data: this._attributes, // 当前 Span 的所有属性
      description: this._name, // Span 的名称
      op: this._attributes[SEMANTIC_ATTRIBUTE_SENTRY_OP], // 该 Span 执行的操作
      parent_span_id: this._parentSpanId, // 父 Span 的 ID
      span_id: this._spanId, // 当前 Span 的 ID
      start_timestamp: this._startTime, // Span 开始的时间戳
      status: getStatusMessage(this._status), // Span 的状态
      timestamp: this._endTime, // Span 结束时间
      trace_id: this._traceId, // 当前追踪的唯一标识符
      origin: this._attributes[SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN] as  // 追踪的起源
        | SpanOrigin
        | undefined,
      _metrics_summary: getMetricSummaryJsonForSpan(this), // 获取的指标摘要
      // 与该 Span 相关联的 Profile ID
      profile_id: this._attributes[SEMANTIC_ATTRIBUTE_PROFILE_ID] as
        | string
        | undefined,
      // 排他时间，即此 Span 独占的时间
      exclusive_time: this._attributes[SEMANTIC_ATTRIBUTE_EXCLUSIVE_TIME] as
        | number
        | undefined,
      // 获取的 Span 相关的测量数据
      measurements: timedEventsToMeasurements(this._events),
      // 判断该 Span 是否为追踪的独立段
      is_segment:
        (this._isStandaloneSpan && getRootSpan(this) === this) || undefined,

      // 该段的 ID
      segment_id: this._isStandaloneSpan
        ? getRootSpan(this).spanContext().spanId
        : undefined,
    });
  }

  /**
   * 用于检查当前 Span 是否仍在记录中
   * @inheritdoc
   *
   */
  public isRecording(): boolean {
    return !this._endTime && !!this._sampled;
  }

  /**
   * 用于将一个事件（event）添加到当前的 Span 中
   * 事件可以包含时间戳和附加属性。此方法是为了丰富 Span 的追踪信息，将事件与 Span 关联起来
   * @inheritdoc
   */
  public addEvent(
    name: string,
    attributesOrStartTime?: SpanAttributes | SpanTimeInput,
    startTime?: SpanTimeInput,
  ): this {
    DEBUG_BUILD && logger.log('[Tracing] Adding an event to span:', name);

    // 用于判断 attributesOrStartTime 是否为时间输入。
    // 如果是则使用该时间；如果不是，则使用 startTime 参数的值或默认的当前时间
    const time = isSpanTimeInput(attributesOrStartTime)
      ? attributesOrStartTime
      : startTime || timestampInSeconds();
    const attributes = isSpanTimeInput(attributesOrStartTime)
      ? {}
      : attributesOrStartTime || {};

    // 构建事件对象
    const event: TimedEvent = {
      name,
      time: spanTimeInputToSeconds(time),
      attributes,
    };

    // 添加到当前 Span 的 _events 列表
    this._events.push(event);

    return this;
  }

  /**
   * 用于判断当前的 Span 是否为独立 Span
   * 独立 Span 是没有父 Span 的根节点 Span，通常代表整个追踪链的起点
   *
   * 这个方法为 sdk 内部方法，通常我们不应该直接调用
   * 该方法可能在未来发生变化或被移除，因此需要谨慎使用
   * @internal
   * @hidden
   * @experimental
   */
  public isStandaloneSpan(): boolean {
    return !!this._isStandaloneSpan;
  }

  /**
   * 该方法在 Span 结束时触发（同时也会触发 spanEnd 事件）用于处理与该 Span 相关的事件和数据的发送
   * 它主要负责向追踪系统发送结束事件、创建事务事件并记录相关信息
   *
   */
  private _onSpanEnded(): void {
    const client = getClient();
    if (client) {
      client.emit('spanEnd', this);
    }

    /**
     * 这里解释了 Segment Span
     *
     * Segment Span 是一个概念，表示本地 Span 树的根 Span
     * 可以是两种类型之一：
     * - 根 Span：表示该事务的起点，包含其他子 Span（即子操作）
     * - 独立 Span：不属于任何其他 Span 的操作，通常用于单独的追踪，而不嵌套在其他操作中
     *
     * 在追踪系统中，Span 和 Segment 的关系通常如下：
     *
     * Span：表示特定操作的时间段，包含开始时间、结束时间及相关元数据（如属性、状态等）
     *
     * Segment Span：在一些实现中，Segment Span 特指根 Span，或是能够独立存在的 Span。
     * 它可以被视为一个起始节点，拥有其下的子 Span，形成一棵树形结构
     * 这种树形结构帮助开发者理解操作的层级关系和时间序列
     */
    const isSegmentSpan = this._isStandaloneSpan || this === getRootSpan(this);

    // 如果不是直接返回
    if (!isSegmentSpan) {
      return;
    }

    // 如果这是一个独立的跨度，我们将立即发送它
    if (this._isStandaloneSpan) {
      if (this._sampled) {
        // 如果被采样 发送 Span 数据
        sendSpanEnvelope(createSpanEnvelope([this], client));
      } else {
        // 如果没有被采样，说明该 Span 因为没有被采样而被丢弃
        DEBUG_BUILD &&
          logger.log(
            '[Tracing] Discarding standalone span because its trace was not chosen to be sampled.',
          );

        // 记录丢弃事件
        if (client) {
          client.recordDroppedEvent('sample_rate', 'span');
        }
      }
      return;
    }

    // 处理非独立的 span

    // 将 Span 转换为事务事件
    const transactionEvent = this._convertSpanToTransaction();
    if (transactionEvent) {
      // 如果成功转换，获取当前的事件作用域
      const scope = getCapturedScopesOnSpan(this).scope || getCurrentScope();
      // 捕获该事务事件
      scope.captureEvent(transactionEvent);
    }
  }

  /**
   * 将一个结束的 span 转换为 transaction 事件以发送给 Sentry，适用于跟踪系统中记录的事务
   */
  private _convertSpanToTransaction(): TransactionEvent | undefined {
    // 检查是否为完整的结束 span，我们只能转换已完成的跨度
    if (!isFullFinishedSpan(spanToJSON(this))) {
      return undefined;
    }

    if (!this._name) {
      // 如果 span 没有名称，给出警告并设置一个默认名称
      DEBUG_BUILD &&
        logger.warn(
          'Transaction has no name, falling back to `<unlabeled transaction>`.',
        );
      this._name = '<unlabeled transaction>';
    }

    // 获取 span 相关的作用域和客户端信息
    const {
      scope: capturedSpanScope,
      isolationScope: capturedSpanIsolationScope,
    } = getCapturedScopesOnSpan(this);
    const scope = capturedSpanScope || getCurrentScope();
    const client = scope.getClient() || getClient();

    if (this._sampled !== true) {
      // 如果该事务未被采样，则记录日志并丢弃该事务
      DEBUG_BUILD &&
        logger.log(
          '[Tracing] Discarding transaction because its trace was not chosen to be sampled.',
        );

      if (client) {
        client.recordDroppedEvent('sample_rate', 'transaction');
      }

      return undefined;
    }

    // 获取当前 span 的所有子 span，并过滤掉当前 span 以及任何独立的 span
    const finishedSpans = getSpanDescendants(this).filter(
      (span) => span !== this && !isStandaloneSpan(span),
    );

    // 将每个结束的 span 转换为 JSON 格式，并过滤出完整的 span
    const spans = finishedSpans
      .map((span) => spanToJSON(span))
      .filter(isFullFinishedSpan);

    // 当前事务的来源（例如页面加载、路由更改等
    const source = this._attributes[SEMANTIC_ATTRIBUTE_SENTRY_SOURCE] as
      | TransactionSource
      | undefined;

    // 构建事务对象
    const transaction: TransactionEvent = {
      contexts: {
        // 记录了与该事务相关的跟踪信息，通常包括 trace_id 和 span_id 等
        trace: spanToTransactionTraceContext(this),
      },
      spans:
        // 这里的 span 已经是一个副本了，所以可以放心使用 sort（改变原数组）
        // 为了防止子 span 过多，这里有一个上限 MAX_SPAN_COUNT，如果子 span 的数量超过该上限，
        // 则按 start_timestamp 排序，并截取前 MAX_SPAN_COUNT 个 span。
        spans.length > MAX_SPAN_COUNT
          ? spans
              .sort((a, b) => a.start_timestamp - b.start_timestamp)
              .slice(0, MAX_SPAN_COUNT)
          : spans,

      // 当前 span 的开始时间，即事务的开始时间
      start_timestamp: this._startTime,
      // 当前 span 的结束时间，即事务的结束时间
      timestamp: this._endTime,
      // 事务的名称，如果事务名为空，之前会使用默认值
      transaction: this._name,
      type: 'transaction', // 表示这是一个事务事件

      // 包含一些 Sentry SDK 的处理元数据
      sdkProcessingMetadata: {
        capturedSpanScope,
        capturedSpanIsolationScope,
        ...dropUndefinedKeys({
          dynamicSamplingContext: getDynamicSamplingContextFromSpan(this),
        }),
      },

      // 获取该事务的指标摘要，通常用于记录性能相关的测量值
      _metrics_summary: getMetricSummaryJsonForSpan(this),
      ...(source && {
        // 如果 source 存在，则在 transaction_info 中包含该事务的来源（source），表示事务是由什么触发的
        transaction_info: {
          source,
        },
      }),
    };

    // 将 span 中记录的时间事件转换为测量数据
    // 测量数据可能包括页面加载时间、首字节时间等
    const measurements = timedEventsToMeasurements(this._events);
    const hasMeasurements = measurements && Object.keys(measurements).length;

    // 如果存在测量数据，就将这些数据添加到事务对象的 measurements 属性中
    if (hasMeasurements) {
      DEBUG_BUILD &&
        logger.log(
          '[Measurements] Adding measurements to transaction event',
          JSON.stringify(measurements, undefined, 2),
        );
      transaction.measurements = measurements;
    }

    // 返回构建好的事务对象
    return transaction;
  }
}

/**
 * 用于判断一个输入值是否为有效的 SpanTimeInput 类型
 * @param value
 * @returns
 */
function isSpanTimeInput(
  value: undefined | SpanAttributes | SpanTimeInput,
): value is SpanTimeInput {
  return (
    (value && typeof value === 'number') || // 数值
    value instanceof Date || // 日期对象
    Array.isArray(value) // 数组
  );
}

/**
 * 用于判断一个 SpanJSON 对象是否为完整的已完成 Span
 * 我们想要过滤掉所有不完整的SpanJSON对象
 * @param input
 * @returns
 */
function isFullFinishedSpan(input: Partial<SpanJSON>): input is SpanJSON {
  return (
    !!input.start_timestamp &&
    !!input.timestamp &&
    !!input.span_id &&
    !!input.trace_id
  );
}

/**
 * 用于检查一个 Span 对象是否是独立的 SentrySpan
 *
 *  SentrySpan 可以作为一个独立的span发送，而不是属于一个事务
 *
 */
function isStandaloneSpan(span: Span): boolean {
  return span instanceof SentrySpan && span.isStandaloneSpan();
}

/**
 * 函数的主要目的是将 span 数据封装在 SpanEnvelope 中并发送到后端服务
 *
 * 如果 envelope 中的 span 被丢弃，那么这个 envelope 也不会被发送。
 *
 * 假设你有一个请求处理过程中产生了一些 span，但在 beforeSendSpan 钩子中，出于某些条件（比如低于某个采样率）你决定丢弃这些 span
 * 这时，整个 envelope 也将不会被发送，这意味着你不会向服务器发送与这个请求相关的任何跟踪信息
 */
function sendSpanEnvelope(envelope: SpanEnvelope): void {
  const client = getClient();
  if (!client) {
    return;
  }

  // 获取要发送的 span
  const spanItems = envelope[1];
  if (!spanItems || spanItems.length === 0) {
    // 记录在发送之前已丢弃了 span 数据
    client.recordDroppedEvent('before_send', 'span');
    return;
  }

  // 获取传输方式
  const transport = client.getTransport();
  if (transport) {
    // 发送数据到 sentry
    transport.send(envelope).then(null, (reason) => {
      // 如果报错在调试模式下输出日志
      DEBUG_BUILD && logger.error('Error while sending span:', reason);
    });
  }
}
