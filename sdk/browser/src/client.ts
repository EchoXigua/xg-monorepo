import type { Scope } from '@xigua-monitor/core';
import type {
  BrowserClientProfilingOptions,
  BrowserClientReplayOptions,
  ClientOptions,
  Event,
  EventHint,
  Options,
  ParameterizedString,
  SeverityLevel,
  UserFeedback,
} from '@xigua-monitor/types';
import { applySdkMetadata, BaseClient } from '@xigua-monitor/core';

import { getSDKSource, logger } from '@xigua-monitor/utils';

import { DEBUG_BUILD } from './debug-build';
import { eventFromException, eventFromMessage } from './eventbuilder';
import { WINDOW } from './helpers';
import type { BrowserTransportOptions } from './transports/types';
import { createUserFeedbackEnvelope } from './userfeedback';

/**
 * 表示 Sentry 浏览器 SDK 的基本配置选项
 * @see @sentry/types Options for more information.
 */
export type BrowserOptions = Options<BrowserTransportOptions> &
  // 定义了与用户重播（User Replay）相关的选项
  // 用户重播是一种功能，允许开发者在发生错误时查看用户的操作过程，从而更容易地重现和修复问题
  BrowserClientReplayOptions &
  // 包含与性能分析相关的配置选项。性能分析可以帮助开发者了解应用程序的性能瓶颈
  BrowserClientProfilingOptions;

/**
 * 包含与客户端行为相关的设置，比如如何与 Sentry 服务器通信
 * @see BrowserClient for more information.
 */
export type BrowserClientOptions = ClientOptions<BrowserTransportOptions> &
  // 重播
  BrowserClientReplayOptions &
  // 性能分析
  BrowserClientProfilingOptions & {
    /**
     * 如果配置了这个属性，它将被用作懒加载集成的基本 URL。
     * 懒加载集成允许 SDK 根据需要动态加载某些功能，从而优化初始加载时间。
     */
    cdnBaseUrl?: string;
  };

/**
 * sentry 浏览器SDK客户端
 * 这个类是 Sentry 浏览器 SDK 的主要入口，负责捕获和发送事件（例如错误、性能监控等）
 * @see BrowserOptions 有关配置选项的文档。
 * @see SentryClient 用于使用文档。
 */
export class BrowserClient extends BaseClient<BrowserClientOptions> {
  /**
   * 创建一个 sentry sdk 浏览器实例
   *
   * @param options 此SDK的配置选项
   */
  public constructor(options: BrowserClientOptions) {
    const opts = {
      // 这意味着每个父级 Span 总是被视为根 Span，以确保追踪的安全性。
      parentSpanIsAlwaysRootSpan: true,
      ...options,
    };
    // 获取 SDK 源
    const sdkSource = WINDOW.SENTRY_SDK_SOURCE || getSDKSource();

    // 应用元数据
    applySdkMetadata(opts, 'browser', ['browser'], sdkSource);

    // 调用父类构造函数，将配置选项传递进去
    super(opts);

    // 如果配置了发送客户端报告，且在浏览器环境下
    if (opts.sendClientReports && WINDOW.document) {
      // 监听当前页面是否可见
      WINDOW.document.addEventListener('visibilitychange', () => {
        // 如果当前页面被隐藏了
        if (WINDOW.document.visibilityState === 'hidden') {
          // 将客户端报告作为信封发送
          this._flushOutcomes();
        }
      });
    }
  }

  /**
   * 从异常中生成事件
   * @inheritDoc
   */
  public eventFromException(
    exception: unknown,
    hint?: EventHint,
  ): PromiseLike<Event> {
    return eventFromException(
      this._options.stackParser,
      exception,
      hint,
      this._options.attachStacktrace,
    );
  }

  /**
   * 从消息中生成事件
   * @inheritDoc
   */
  public eventFromMessage(
    message: ParameterizedString,
    level: SeverityLevel = 'info',
    hint?: EventHint,
  ): PromiseLike<Event> {
    return eventFromMessage(
      this._options.stackParser,
      message,
      level,
      hint,
      this._options.attachStacktrace,
    );
  }

  /**
   * 这个方法用于将用户反馈（feedback）发送到 Sentry
   *
   * @deprecated 该方法已被弃用，推荐使用 captureFeedback 方法代替
   */
  public captureUserFeedback(feedback: UserFeedback): void {
    // 检查 SDK 是否启用
    if (!this._isEnabled()) {
      // 如果没有启用，打印警告信息并返回
      DEBUG_BUILD &&
        logger.warn('SDK not enabled, will not capture user feedback.');
      return;
    }

    // 创建用户反馈的信封，包含元数据、DSN 和隧道配置。
    const envelope = createUserFeedbackEnvelope(feedback, {
      metadata: this.getSdkMetadata(),
      dsn: this.getDsn(),
      tunnel: this.getOptions().tunnel,
    });

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    // 调用 sendEnvelope 方法发送信封，sendEnvelope 方法不应抛出异常
    this.sendEnvelope(envelope);
  }

  /**
   * 该方法在将事件发送到 Sentry 之前，准备事件对象，确保其具有正确的 platform 属性
   * @inheritDoc
   */
  protected _prepareEvent(
    event: Event,
    hint: EventHint,
    scope?: Scope,
  ): PromiseLike<Event | null> {
    event.platform = event.platform || 'javascript';
    // 调用父类的 _prepareEvent 方法处理事件对象、提示信息和作用域
    return super._prepareEvent(event, hint, scope);
  }
}
