/* eslint-disable max-lines */
import type {
  Attachment,
  Breadcrumb,
  CaptureContext,
  Client,
  Context,
  Contexts,
  Event,
  EventHint,
  EventProcessor,
  Extra,
  Extras,
  Primitive,
  PropagationContext,
  RequestSession,
  Scope as ScopeInterface,
  ScopeContext,
  ScopeData,
  Session,
  SeverityLevel,
  User,
} from '@xigua-monitor/types';
import {
  dateTimestampInSeconds,
  generatePropagationContext,
  isPlainObject,
  logger,
  uuid4,
} from '@xigua-monitor/utils';

import { updateSession } from './session';
import { _getSpanForScope, _setSpanForScope } from './utils/spanOnScope';

/**
 * 添加到事件中的面包屑的最大数量的默认值
 */
const DEFAULT_MAX_BREADCRUMBS = 100;

/**
 * 这个类主要是用于处理事件的上下文和附加信息的管理
 */
class ScopeClass implements ScopeInterface {
  /**
   * 表示是否正在通知侦听器
   * 当作用域中的数据发生变化时，比如用户信息、事件等，相关的侦听器（listeners）会被触发来执行某些逻辑操作。
   * 这个属性通过防止重复通知，避免在作用域更新时陷入无限循环
   */
  protected _notifyingListeners: boolean;

  /**
   * 存放作用域侦听器的数组，每个侦听器都是一个回调函数
   * 当作用域中的数据变化时，所有侦听器会依次被调用。侦听器函数接受当前的作用域对象作为参数，
   * 用于在监听到作用域变化时执行相应的处理逻辑，比如重新渲染 UI 或记录日志。
   * 这个机制确保了作用域的动态变化能够通知到系统的其他部分。
   */
  protected _scopeListeners: Array<(scope: Scope) => void>;

  /**
   * 事件处理器是处理事件的回调函数，用于在事件生成并捕获到事件处理逻辑之前执行一些额外的操作。
   * 事件处理器可以修改事件的内容、添加更多的元数据、过滤掉某些不需要的事件等。
   * 这个属性存储所有注册的事件处理器，这些处理器会在事件捕获时依次被执行，帮助开发者对事件流进行更细粒度的控制。
   */
  protected _eventProcessors: EventProcessor[];

  /**
   * 面包屑是系统中一些关键操作的简短记录，通常用来帮助追踪用户的操作路径或系统内部的事件链。
   * 每一个面包屑记录一个事件的元信息（比如时间戳、消息、类别等），帮助开发者在调试或分析时回溯发生错误之前的操作序列。
   * 数组中的元素数量可以由最大面包屑限制控制（通常为 100）
   */
  protected _breadcrumbs: Breadcrumb[];

  /**
   * 存储当前用户的信息，比如用户的 id、email、username、ip_address 等。
   * 这些信息被用来与事件一起发送到 Sentry 系统，以便在错误或异常发生时追踪相关的用户
   */
  protected _user: User;

  /**
   * 标签是一些简短的键值对，用来给事件和作用域添加更多的上下文信息，可以帮助开发者对事件进行分类和过滤。
   * 这个属性存储了当前的标签，开发者可以随时更新这些标签并附加到后续的事件中。
   */
  protected _tags: { [key: string]: Primitive };

  /**
   * 存储不太重要的附加数据，它不像标签那样结构化或经常用于过滤，更多是用来在需要时提供额外的上下文。
   */
  protected _extra: Extras;

  /**
   * 上下文是一个包含更多细节信息的对象，例如设备、操作系统、浏览器等信息。
   * 在分布式跟踪系统中，它也可以包含 trace 和 span 等信息，用于在系统间传递追踪数据。
   */
  protected _contexts: Contexts;

  /**
   * 用于存储所有当前附加的文件数据。
   * 附件是一些额外的数据文件或信息，可以与事件一起发送到 Sentry。
   * 例如，你可能想要附加某些二进制文件或日志文件，以帮助调试特定事件或错误。
   */
  protected _attachments: Attachment[];

  /**
   * 用于分布式跟踪，跟踪不同服务或系统之间的请求链
   * 包含了 trace、span 的数据，用于确保跨服务调用的请求可以被追踪到同一个事件链上。
   * 在微服务架构中，追踪请求的传播对于故障诊断非常关键。
   */
  protected _propagationContext: PropagationContext;

  /**
   * 这是 SDK 用来存放内部数据的地方，这些数据在事件处理过程中可能会使用到，但不会发送到 Sentry。
   * 它允许 SDK 在整个事件处理流水线中传递一些特定的元数据，这些数据对用户不可见，也不会影响外部的分析和日志。
   */
  protected _sdkProcessingMetadata: { [key: string]: unknown };

  /**
   * 指纹用于对事件进行去重
   * 默认情况下，相同的错误报告可能会被认为是重复的，而指纹可以通过手动设置不同的值，来确保某些相似事件被视为不同的事件。
   * 这个属性允许开发者指定自定义的指纹，从而精细化地控制事件聚合策略
   */
  protected _fingerprint?: string[];

  /**
   * 事件的严重级别
   * 决定了事件的优先级以及如何在 Sentry 系统中展示和处理它。
   * 开发者可以通过修改该属性来改变事件的严重性，从而影响事件在 Sentry 中的排序和呈现。
   */
  protected _level?: SeverityLevel;

  /**
   * 事务名用于标识非事务事件的名称。
   * 事务和 root span 无关，它用于帮助将当前的事件与特定的业务逻辑或路径关联起来，方便后续的分析和追踪。
   *
   */
  protected _transactionName?: string;

  /**
   * 会话信息用于追踪用户的会话生命周期
   * 有助于理解用户何时开始一个新会话、会话的持续时间以及是否在会话中出现了错误。
   * 会话信息对用户行为的分析以及稳定性报告至关重要。
   */
  protected _session?: Session;

  /**
   * 请求会话状态与 HTTP 请求相关，记录了请求的会话信息。
   * 可以帮助监控特定 HTTP 请求的生命周期，追踪请求中的错误、性能等。
   */
  protected _requestSession?: RequestSession;

  /**
   * 存储了与作用域关联的客户端实例
   * Client 负责与 Sentry 服务器通信，捕获并发送事件。如果这个属性没有设置，则无法将事件发送出去。
   */
  protected _client?: Client;

  /**
   * 最后一个被捕获事件的 ID。
   * 每次捕获一个新事件时，Sentry 会生成一个唯一的事件 ID，这个属性记录了最后一个生成的 ID，用于后续追踪和调试。
   */
  protected _lastEventId?: string;

  //注意:这里添加的任何字段不仅应该添加到构造函数中，还应该添加到clone方法中

  public constructor() {
    this._notifyingListeners = false;
    this._scopeListeners = [];
    this._eventProcessors = [];
    this._breadcrumbs = [];
    this._attachments = [];
    this._user = {};
    this._tags = {};
    this._extra = {};
    this._contexts = {};
    this._sdkProcessingMetadata = {};
    this._propagationContext = generatePropagationContext();
  }

  /**
   * @inheritDoc
   */
  public clone(): ScopeClass {
    const newScope = new ScopeClass();
    newScope._breadcrumbs = [...this._breadcrumbs];
    newScope._tags = { ...this._tags };
    newScope._extra = { ...this._extra };
    newScope._contexts = { ...this._contexts };
    newScope._user = this._user;
    newScope._level = this._level;
    newScope._session = this._session;
    newScope._transactionName = this._transactionName;
    newScope._fingerprint = this._fingerprint;
    newScope._eventProcessors = [...this._eventProcessors];
    newScope._requestSession = this._requestSession;
    newScope._attachments = [...this._attachments];
    newScope._sdkProcessingMetadata = { ...this._sdkProcessingMetadata };
    newScope._propagationContext = { ...this._propagationContext };
    newScope._client = this._client;
    newScope._lastEventId = this._lastEventId;

    _setSpanForScope(newScope, _getSpanForScope(this));

    return newScope;
  }

  /**
   * 设置当前作用域的客户端实例
   * Client 是用来与 Sentry 服务器进行交互的类。如果传入的是 undefined，则表示清空当前的 Client。
   * @inheritDoc
   */
  public setClient(client: Client | undefined): void {
    this._client = client;
  }

  /**
   *  设置最近捕获的事件的 ID。这可以用来追踪最后一次报告的事件
   * @inheritDoc
   */
  public setLastEventId(lastEventId: string | undefined): void {
    this._lastEventId = lastEventId;
  }

  /**
   * 获取当前 Scope 中的客户端实例，返回的类型是 Client 或者 undefined
   * @inheritDoc
   */
  public getClient<C extends Client>(): C | undefined {
    return this._client as C | undefined;
  }

  /**
   * 返回最后一个事件的 ID
   * @inheritDoc
   */
  public lastEventId(): string | undefined {
    return this._lastEventId;
  }

  /**
   * 向作用域中添加监听器。当作用域发生变化时，这些监听器会被调用
   *
   * @inheritDoc
   */
  public addScopeListener(callback: (scope: Scope) => void): void {
    this._scopeListeners.push(callback);
  }

  /**
   * 添加事件处理器，这些处理器会在事件处理过程中被调用。
   * 返回实例，这样可以链式调用
   * @inheritDoc
   */
  public addEventProcessor(callback: EventProcessor): this {
    this._eventProcessors.push(callback);
    return this;
  }

  /**
   * 设置当前用户。
   * 如果传入 null，则清除用户信息（但保留 key），从而确保后续处理能够清除任何现存的用户数据。
   * @inheritDoc
   */
  public setUser(user: User | null): this {
    // If null is passed we want to unset everything, but still define keys,
    // so that later down in the pipeline any existing values are cleared.
    this._user = user || {
      email: undefined,
      id: undefined,
      ip_address: undefined,
      username: undefined,
    };

    // 存在会话，更新会话信息中的用户
    if (this._session) {
      updateSession(this._session, { user });
    }

    // 通知监听器作用域发生了变化
    this._notifyScopeListeners();
    return this;
  }

  /**
   * 获取当前设置的用户信息
   * @inheritDoc
   */
  public getUser(): User | undefined {
    return this._user;
  }

  /**
   * 获取当前请求的会话信息
   * @inheritDoc
   */
  public getRequestSession(): RequestSession | undefined {
    return this._requestSession;
  }

  /**
   * 设置或更新当前的请求会话
   * @inheritDoc
   */
  public setRequestSession(requestSession?: RequestSession): this {
    this._requestSession = requestSession;
    return this;
  }

  /**
   * 批量设置多个标签
   * @inheritDoc
   */
  public setTags(tags: { [key: string]: Primitive }): this {
    this._tags = {
      ...this._tags,
      ...tags,
    };
    // 通知监听器范围的更新
    this._notifyScopeListeners();
    return this;
  }

  /**
   * 设置单个标签
   * @inheritDoc
   */
  public setTag(key: string, value: Primitive): this {
    this._tags = { ...this._tags, [key]: value };
    // 通知监听器范围的更新
    this._notifyScopeListeners();
    return this;
  }

  /**
   * 设置或更新多个额外信息
   * @inheritDoc
   */
  public setExtras(extras: Extras): this {
    this._extra = {
      ...this._extra,
      ...extras,
    };
    // 通知监听器，说明 Scope 已发生更改
    this._notifyScopeListeners();
    return this;
  }

  /**
   * 设置或更新单个额外信息
   * @inheritDoc
   */
  public setExtra(key: string, extra: Extra): this {
    this._extra = { ...this._extra, [key]: extra };
    // 通知监听器，说明 Scope 已发生更改
    this._notifyScopeListeners();
    return this;
  }

  /**
   * 设置事件的指纹
   * 指纹用于帮助 Sentry 区分不同的错误或事件
   * @inheritDoc
   */
  public setFingerprint(fingerprint: string[]): this {
    this._fingerprint = fingerprint;
    // 通知监听器作用域的变化
    this._notifyScopeListeners();
    return this;
  }

  /**
   * 设置事件的严重性级别
   * @inheritDoc
   */
  public setLevel(level: SeverityLevel): this {
    this._level = level;
    // 通知监听器作用域的变化
    this._notifyScopeListeners();
    return this;
  }

  /**
   * 设置当前事务的名称
   * @inheritDoc
   */
  public setTransactionName(name?: string): this {
    this._transactionName = name;
    this._notifyScopeListeners();
    return this;
  }

  /**
   * 设置或删除上下文
   * @inheritDoc
   */
  public setContext(key: string, context: Context | null): this {
    if (context === null) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      // 删除 _contexts 对象中的对应 key
      delete this._contexts[key];
    } else {
      // 设置新的值
      this._contexts[key] = context;
    }

    this._notifyScopeListeners();
    return this;
  }

  /**
   * 设置或清除当前会话
   * @inheritDoc
   */
  public setSession(session?: Session): this {
    if (!session) {
      // 删除当前会话
      delete this._session;
    } else {
      // 更新 _session 为新的值
      this._session = session;
    }
    this._notifyScopeListeners();
    return this;
  }

  /**
   * 获取当前会话信息
   * @inheritDoc
   */
  public getSession(): Session | undefined {
    return this._session;
  }

  /**
   * 根据传入的参数更新 Scope 的相关属性
   * @inheritDoc
   */
  public update(captureContext?: CaptureContext): this {
    if (!captureContext) {
      return this;
    }

    const scopeToMerge =
      typeof captureContext === 'function'
        ? captureContext(this)
        : captureContext;

    const [scopeInstance, requestSession] =
      scopeToMerge instanceof Scope
        ? [scopeToMerge.getScopeData(), scopeToMerge.getRequestSession()]
        : isPlainObject(scopeToMerge)
          ? [
              captureContext as ScopeContext,
              (captureContext as ScopeContext).requestSession,
            ]
          : [];

    const {
      tags,
      extra,
      user,
      contexts,
      level,
      fingerprint = [],
      propagationContext,
    } = scopeInstance || {};

    // 做合并
    this._tags = { ...this._tags, ...tags };
    this._extra = { ...this._extra, ...extra };
    this._contexts = { ...this._contexts, ...contexts };

    // 做覆盖
    if (user && Object.keys(user).length) {
      this._user = user;
    }

    if (level) {
      this._level = level;
    }

    if (fingerprint.length) {
      this._fingerprint = fingerprint;
    }

    if (propagationContext) {
      this._propagationContext = propagationContext;
    }

    if (requestSession) {
      this._requestSession = requestSession;
    }

    return this;
  }

  /**
   * 清空 Scope 的状态，将大部分属性重置为默认值
   * client 不会被清除，这意味着 Scope 仍然与它所属的 Client 关联
   * @inheritDoc
   */
  public clear(): this {
    this._breadcrumbs = [];
    this._tags = {};
    this._extra = {};
    this._user = {};
    this._contexts = {};
    this._level = undefined;
    this._transactionName = undefined;
    this._fingerprint = undefined;
    this._requestSession = undefined;
    this._session = undefined;

    // 将当前 Scope 的 Span 重置为 undefined
    _setSpanForScope(this, undefined);
    this._attachments = [];
    this._propagationContext = generatePropagationContext();

    // 通知所有监听器 Scope 已被清空
    this._notifyScopeListeners();
    return this;
  }

  /**
   * 向当前 Scope 中添加一个 Breadcrumb，并限制最大数量
   * @inheritDoc
   */
  public addBreadcrumb(breadcrumb: Breadcrumb, maxBreadcrumbs?: number): this {
    const maxCrumbs =
      typeof maxBreadcrumbs === 'number'
        ? maxBreadcrumbs
        : DEFAULT_MAX_BREADCRUMBS;

    // 没有数据被更改，所以不要通知作用域侦听器
    if (maxCrumbs <= 0) {
      return this;
    }

    const mergedBreadcrumb = {
      timestamp: dateTimestampInSeconds(),
      ...breadcrumb,
    };

    // 合并面包屑
    const breadcrumbs = this._breadcrumbs;
    breadcrumbs.push(mergedBreadcrumb);
    this._breadcrumbs =
      // 长度超过最大限制，只保留最新的最大个数（最开始的会被丢弃）
      breadcrumbs.length > maxCrumbs
        ? breadcrumbs.slice(-maxCrumbs)
        : breadcrumbs;

    // 通知事件监听器
    this._notifyScopeListeners();

    return this;
  }

  /**
   * 获取最新的面包屑
   * @inheritDoc
   */
  public getLastBreadcrumb(): Breadcrumb | undefined {
    return this._breadcrumbs[this._breadcrumbs.length - 1];
  }

  /**
   * 清空当前 Scope 中所有的面包屑
   * 这个方法主要用于在某些操作完成后清除之前的事件追踪信息，使得接下来的操作不会受到之前信息的干扰
   * @inheritDoc
   */
  public clearBreadcrumbs(): this {
    this._breadcrumbs = [];
    // 告知监听器面包屑已被清空
    this._notifyScopeListeners();
    return this;
  }

  /**
   *  添加附件信息
   * 该方法允许开发者在事件追踪中包含额外的数据，便于在问题发生时提供更全面的信息
   * @inheritDoc
   */
  public addAttachment(attachment: Attachment): this {
    this._attachments.push(attachment);
    return this;
  }

  /**
   * 清空附件信息
   * @inheritDoc
   */
  public clearAttachments(): this {
    this._attachments = [];
    return this;
  }

  /**
   * 返回当前 Scope 的数据，包括面包屑、附件、上下文、标签等信息
   * @inheritDoc
   */
  public getScopeData(): ScopeData {
    return {
      breadcrumbs: this._breadcrumbs,
      attachments: this._attachments,
      contexts: this._contexts,
      tags: this._tags,
      extra: this._extra,
      user: this._user,
      level: this._level,
      fingerprint: this._fingerprint || [],
      eventProcessors: this._eventProcessors, // 事件处理器数组
      propagationContext: this._propagationContext, // 用于传播的上下文
      sdkProcessingMetadata: this._sdkProcessingMetadata, // SDK 处理的元数据
      transactionName: this._transactionName,
      span: _getSpanForScope(this), // 当前 Scope 关联的 span
    };
  }

  /**
   * 设置或更新 SDK 处理的元数据
   * @inheritDoc
   */
  public setSDKProcessingMetadata(newData: { [key: string]: unknown }): this {
    // 将新的 元数据合并
    this._sdkProcessingMetadata = {
      ...this._sdkProcessingMetadata,
      ...newData,
    };

    return this;
  }

  /**
   * 设置当前 Scope 的传播上下文
   * @inheritDoc
   */
  public setPropagationContext(context: PropagationContext): this {
    this._propagationContext = context;
    return this;
  }

  /**
   * 获取当前 Scope 的传播上下文
   * @inheritDoc
   */
  public getPropagationContext(): PropagationContext {
    return this._propagationContext;
  }

  /**
   * 捕获异常并将其发送到 Sentry
   * 该方法用于处理和捕获应用程序中的异常，确保这些异常信息能被记录和追踪，便于后续分析
   * @inheritDoc
   */
  public captureException(exception: unknown, hint?: EventHint): string {
    // 如果 hint 中包含 event_id，则使用它；否则生成一个新的 UUID
    const eventId = hint && hint.event_id ? hint.event_id : uuid4();

    // 如果当前没有配置客户端，发出警告并返回事件 ID。
    if (!this._client) {
      logger.warn(
        'No client configured on scope - will not capture exception!',
      );
      return eventId;
    }

    // 创建一个新的 Error 对象，用于 Sentry 处理
    const syntheticException = new Error('Sentry syntheticException');

    // 将捕获的异常及相关信息发送到 Sentry
    this._client.captureException(
      exception,
      {
        originalException: exception,
        syntheticException,
        ...hint,
        event_id: eventId,
      },
      this,
    );

    // 无论是否成功捕获异常，都返回事件 ID
    return eventId;
  }

  /**
   * 捕获一个消息并将其发送到 Sentry
   *
   * @param message 要捕获的消息字符串
   * @param level 指定消息的严重性级别
   * @param hint 事件提示对象，包含额外的信息
   * @returns
   *
   * @inheritDoc
   */
  public captureMessage(
    message: string,
    level?: SeverityLevel,
    hint?: EventHint,
  ): string {
    // 生成事件 ID
    const eventId = hint && hint.event_id ? hint.event_id : uuid4();

    // 检查客户端配置
    if (!this._client) {
      logger.warn('No client configured on scope - will not capture message!');
      return eventId;
    }

    // 创建合成异常，这是用于帮助调试的
    const syntheticException = new Error(message);

    // 将消息、级别、原始异常、合成异常及其它提示信息发送到 Sentry
    this._client.captureMessage(
      message,
      level,
      {
        originalException: message,
        syntheticException,
        ...hint,
        event_id: eventId,
      },
      this,
    );

    return eventId;
  }

  /**
   * 捕获一个完整的事件并将其发送到 Sentry
   * @inheritDoc
   */
  public captureEvent(event: Event, hint?: EventHint): string {
    // 生成事件id
    const eventId = hint && hint.event_id ? hint.event_id : uuid4();

    // 检查客户端配置
    if (!this._client) {
      logger.warn('No client configured on scope - will not capture event!');
      return eventId;
    }

    // 将事件和提示信息发送到 Sentry
    this._client.captureEvent(event, { ...hint, event_id: eventId }, this);

    return eventId;
  }

  /**
   * 通知所有注册的作用域监听器，以便在作用域更新时触发相应的回调
   */
  protected _notifyScopeListeners(): void {
    /**
     * 在某些情况下，在更新对象时通知相关的监听器（scopeListeners）
     * 然而，在通知过程中，如果某些监听器再次尝试更新同一个 Scope 对象，就可能导致无限递归。
     * 所以使用 _notifyingListeners 标志用于指示当前是否正在通知监听器，以避免在通知过程中再次触发
     */

    // 状态检查
    if (!this._notifyingListeners) {
      this._notifyingListeners = true;
      // 遍历，依次调用每个监听器
      this._scopeListeners.forEach((callback) => {
        callback(this);
      });
      // 重置标志
      this._notifyingListeners = false;
    }
  }
}

/**
 * 这里解释了为什么要将 Scope 既作为类导出又作为类型导出
 * 类的导出：通过导出 ScopeClass 作为 Scope，可以在其他模块中获取 Scope 的具体实现，
 * 这样在运行时你可以使用这个类实例化对象并调用其中的方法。
 *
 * 类型的导出：通过将 ScopeInterface 导出为 Scope 类型，允许在静态分析和类型检查时使用。
 * 比如在 Sentry 系统的不同包中（如 @sentry/node 或 @sentry/types），
 * 可以通过 import type { Scope } 来获得类型信息，而不是类实现，
 * 这在某些情况下可以避免额外的代码引入和模块解析问题。
 */

/**
 * Holds additional event information.
 */
export const Scope = ScopeClass;

/**
 * Holds additional event information.
 */
export type Scope = ScopeInterface;
