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
 * Configuration options for the Sentry Browser SDK.
 * @see @sentry/types Options for more information.
 */
export type BrowserOptions = Options<BrowserTransportOptions> &
  BrowserClientReplayOptions &
  BrowserClientProfilingOptions;

/**
 * Configuration options for the Sentry Browser SDK Client class
 * @see BrowserClient for more information.
 */
export type BrowserClientOptions = ClientOptions<BrowserTransportOptions> &
  BrowserClientReplayOptions &
  BrowserClientProfilingOptions & {
    /** If configured, this URL will be used as base URL for lazy loading integration. */
    cdnBaseUrl?: string;
  };

/**
 * The Sentry Browser SDK Client.
 *
 * @see BrowserOptions for documentation on configuration options.
 * @see SentryClient for usage documentation.
 */
export class BrowserClient extends BaseClient<BrowserClientOptions> {
  /**
   * Creates a new Browser SDK instance.
   *
   * @param options Configuration options for this SDK.
   */
  public constructor(options: BrowserClientOptions) {
    const opts = {
      // We default this to true, as it is the safer scenario
      parentSpanIsAlwaysRootSpan: true,
      ...options,
    };
    const sdkSource = WINDOW.SENTRY_SDK_SOURCE || getSDKSource();
    applySdkMetadata(opts, 'browser', ['browser'], sdkSource);

    super(opts);

    if (opts.sendClientReports && WINDOW.document) {
      WINDOW.document.addEventListener('visibilitychange', () => {
        if (WINDOW.document.visibilityState === 'hidden') {
          this._flushOutcomes();
        }
      });
    }
  }

  /**
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
   * Sends user feedback to Sentry.
   *
   * @deprecated Use `captureFeedback` instead.
   */
  public captureUserFeedback(feedback: UserFeedback): void {
    if (!this._isEnabled()) {
      DEBUG_BUILD &&
        logger.warn('SDK not enabled, will not capture user feedback.');
      return;
    }

    const envelope = createUserFeedbackEnvelope(feedback, {
      metadata: this.getSdkMetadata(),
      dsn: this.getDsn(),
      tunnel: this.getOptions().tunnel,
    });

    // sendEnvelope should not throw
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.sendEnvelope(envelope);
  }

  /**
   * @inheritDoc
   */
  protected _prepareEvent(
    event: Event,
    hint: EventHint,
    scope?: Scope,
  ): PromiseLike<Event | null> {
    event.platform = event.platform || 'javascript';
    return super._prepareEvent(event, hint, scope);
  }
}
