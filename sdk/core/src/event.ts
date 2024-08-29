import type { Attachment } from './attachment';
import type { Breadcrumb } from './breadcrumb';
import type { Contexts } from './context';
import type { DebugMeta } from './debugMeta';
import type { Exception } from './exception';
import type { Extras } from './extra';
import type { Measurements } from './measurement';
import type { Mechanism } from './mechanism';
import type { Primitive } from './misc';
import type { Request } from './request';
import type { CaptureContext } from './scope';
import type { SdkInfo } from './sdkinfo';
import type { SeverityLevel } from './severity';
import type { MetricSummary, SpanJSON } from './span';
import type { Thread } from './thread';
import type { TransactionSource } from './transaction';
import type { User } from './user';

/**
 * 定义了一个发送给 Sentry 的事件结构, 在 Sentry 中，事件是报告问题、异常、性能数据等的基本单元。
 * 这个接口包含了事件的各种属性，以便在事件发生时能够捕捉和报告足够的信息。
 * 这些属性大致可以分为几类：标识信息、上下文信息、异常信息、用户信息、性能信息等。
 */
export interface Event {
  /**
   * 事件的唯一标识符，通常是一个 UUID，用来追踪和区分每个事件
   */
  event_id?: string;
  /**
   * 事件的简短描述或消息
   */
  message?: string;
  /**
   * 包含日志消息和可选的参数
   */
  logentry?: {
    message?: string;
    params?: string[];
  };

  /**
   * 事件发生的时间
   */
  timestamp?: number;
  /**
   * 事件开始的时间戳，主要用于性能跟踪和事务处理
   */
  start_timestamp?: number;
  /**
   * 事件的严重程度
   */
  level?: SeverityLevel;
  /**
   * 事件发生的运行平台
   */
  platform?: string;
  /**
   * 日志记录器的名称，通常是应用中用于生成日志的模块名称
   */
  logger?: string;

  /**
   * 发生事件的服务器的名称或标识符
   */
  server_name?: string;
  /**
   *  应用的发布版本号，用来标识发生事件时应用的具体版本
   */
  release?: string;
  /**
   *  分发标识符，通常与 release 结合使用以区分不同的发布包
   */
  dist?: string;
  /**
   * 应用的运行环境，比如 production, staging, development 等。
   */
  environment?: string;
  /**
   * 包含 SDK 相关的信息，如 SDK 名称和版本等
   */
  sdk?: SdkInfo;
  /**
   * 与当前 HTTP 请求相关的信息，如 URL、方法、标头等。
   */
  request?: Request;
  /**
   *  当前事务或操作的名称，通常用于性能监控
   */
  transaction?: string;
  /**
   * 应用程序中使用的模块或库的名称和版本
   */
  modules?: { [key: string]: string };
  fingerprint?: string[];
  /**
   * 记录异常或错误的详细信息，通常包含异常的类型、消息、堆栈跟踪等
   */
  exception?: {
    values?: Exception[];
  };
  /**
   * 用户行为或操作的记录，用于追踪事件发生前的操作历史
   */
  breadcrumbs?: Breadcrumb[];
  /**
   * 上下文信息，如设备信息、操作系统、浏览器信息等
   */
  contexts?: Contexts;
  /**
   * 用于分类和过滤事件的键值对
   */
  tags?: { [key: string]: Primitive };
  /**
   * 其他的附加数据，可以是任意的键值对
   */
  extra?: Extras;
  /**
   * 与当前事件关联的用户信息，如用户 ID、邮箱、用户名等
   */
  user?: User;

  /**
   * 用来指定事件的类型
   */
  type?: EventType;
  /**
   * 跟踪的性能片段，通常用于详细分析事务的各个部分的性能表现
   */
  spans?: SpanJSON[];
  /**
   *  自定义的性能测量值，如内存使用量、加载时间等
   */
  measurements?: Measurements;
  /**
   * 调试相关的元信息，用于进一步调试和分析事件。
   */
  debug_meta?: DebugMeta;

  /**
   * SDK 在事件处理流程中使用的临时数据，不会被发送到 Sentry
   */
  sdkProcessingMetadata?: { [key: string]: any };

  /**
   * 事务的附加信息，例如事务来源
   */
  transaction_info?: {
    source: TransactionSource;
  };

  /**
   * 包含与当前事件关联的线程信息，通常用于多线程环境下的错误报告。
   */
  threads?: {
    values: Thread[];
  };
}

/**
 * 对于 ErrorEvent 类型的事件，type 属性通常是未定义的 (undefined)。
 * 而对于其他类型的事件（如事务、性能剖析、回放、反馈等），则要求必须有一个明确的 type。
 */
export type EventType =
  // 表示该事件是一个事务事件，用于捕捉和追踪应用中的事务（如 API 请求、数据库查询等）的性能数据
  | 'transaction'
  // 表示该事件是一个性能剖析事件，用于捕捉应用的性能剖析数据
  | 'profile'
  //  表示该事件是一个回放事件，用于捕捉用户会话回放的数据
  | 'replay_event'
  // 表示该事件是一个用户反馈事件，用于捕捉用户在应用中提交的反馈信息
  | 'feedback'
  // 如果事件类型未定义，比如 ErrorEvent，通常不需要指定类型
  | undefined;

export interface ErrorEvent extends Event {
  type: undefined;
}
/**
 * 表示一种特定类型的事件，即“事务事件”。这是 Sentry 中用于捕捉和追踪应用中事务的事件类型。
 */
export interface TransactionEvent extends Event {
  type: 'transaction';
  /**
   * 这些数据通常用于总结和记录与事务相关的度量信息。由于前缀 _，这可能是一个内部使用的属性，不会直接发送给 Sentry。
   */
  _metrics_summary?: Record<string, Array<MetricSummary>>;
}

/**
 * 定义了一些附加信息，这些信息在创建和处理事件时可以使用。这些信息帮助在事件捕获的不同阶段进行定制和扩展。
 */
export interface EventHint {
  /**
   * 可以指定一个事件的 ID。这在某些情况下，比如自定义事件捕获流程中，可能会用到。
   */
  event_id?: string;
  /**
   * 可以用于在捕获事件时提供额外的上下文信息，比如用户信息或额外的标签。
   */
  captureContext?: CaptureContext;
  /**
   * 部分定义了捕获事件的机制。这可能包括如何捕获到的异常（如全局错误处理器、手动捕获等）。
   */
  mechanism?: Partial<Mechanism>;
  /**
   * 可能会包含一个合成的异常对象，用于提供更多的调试信息。
   */
  syntheticException?: Error | null;
  /**
   * 用于保存最原始的异常对象，类型是未知的 (unknown)。
   */
  originalException?: unknown;
  /**
   * 一个附件数组，允许将额外的文件或数据附加到事件中。
   */
  attachments?: Attachment[];
  /**
   * 可以包含任意数据，通常用于在事件捕获时传递自定义信息
   */
  data?: any;
  /**
   * 一个字符串数组，列出了处理该事件时使用的集成（integrations）。
   */
  integrations?: string[];
}
