import type {
  ClientOptions,
  Scope,
  SentrySpanArguments,
  Span,
  SpanTimeInput,
  StartSpanOptions,
} from '@xigua-monitor/types';

import {
  getClient,
  getCurrentScope,
  getIsolationScope,
  withScope,
} from '../currentScopes';
import { SentryNonRecordingSpan } from './sentryNonRecordingSpan';
import type { AsyncContextStrategy } from '../asyncContext/types';
import {
  addChildSpanToSpan,
  getRootSpan,
  spanIsSampled,
  spanTimeInputToSeconds,
  spanToJSON,
} from '../utils/spanUtils';
import { getMainCarrier } from '../carrier';
import { getAsyncContextStrategy } from '../asyncContext';
import { _getSpanForScope, _setSpanForScope } from '../utils/spanOnScope';
import { hasTracingEnabled } from '../utils/hasTracingEnabled';
import { SentrySpan } from './sentrySpan';
import {
  freezeDscOnSpan,
  getDynamicSamplingContextFromSpan,
} from './dynamicSamplingContext';
import { sampleSpan } from './sampling';
import {
  SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE,
  SEMANTIC_ATTRIBUTE_SENTRY_SOURCE,
} from '../semanticAttributes';
import { logSpanStart } from './logSpans';
import { setCapturedScopesOnSpan } from './utils';

const SUPPRESS_TRACING_KEY = '__SENTRY_SUPPRESS_TRACING__';

/**
 * Creates a span. This span is not set as active, so will not get automatic instrumentation spans
 * as children or be able to be accessed via `Sentry.getActiveSpan()`.
 *
 * If you want to create a span that is set as active, use {@link startSpan}.
 *
 * This function will always return a span,
 * it may just be a non-recording span if the span is not sampled or if tracing is disabled.
 */
export function startInactiveSpan(options: StartSpanOptions): Span {
  const acs = getAcs();
  if (acs.startInactiveSpan) {
    return acs.startInactiveSpan(options);
  }

  const spanArguments = parseSentrySpanArguments(options);
  const { forceTransaction, parentSpan: customParentSpan } = options;

  // If `options.scope` is defined, we use this as as a wrapper,
  // If `options.parentSpan` is defined, we want to wrap the callback in `withActiveSpan`
  const wrapper = options.scope
    ? (callback: () => Span) => withScope(options.scope, callback)
    : customParentSpan !== undefined
      ? (callback: () => Span) => withActiveSpan(customParentSpan, callback)
      : (callback: () => Span) => callback();

  return wrapper(() => {
    const scope = getCurrentScope();
    const parentSpan = getParentSpan(scope);

    const shouldSkipSpan = options.onlyIfParent && !parentSpan;

    if (shouldSkipSpan) {
      return new SentryNonRecordingSpan();
    }

    return createChildOrRootSpan({
      parentSpan,
      spanArguments,
      forceTransaction,
      scope,
    });
  });
}

/**
 * This converts StartSpanOptions to SentrySpanArguments.
 * For the most part (for now) we accept the same options,
 * but some of them need to be transformed.
 */
function parseSentrySpanArguments(
  options: StartSpanOptions,
): SentrySpanArguments {
  const exp = options.experimental || {};
  const initialCtx: SentrySpanArguments = {
    isStandalone: exp.standalone,
    ...options,
  };

  if (options.startTime) {
    const ctx: SentrySpanArguments & { startTime?: SpanTimeInput } = {
      ...initialCtx,
    };
    ctx.startTimestamp = spanTimeInputToSeconds(options.startTime);
    delete ctx.startTime;
    return ctx;
  }

  return initialCtx;
}

function getAcs(): AsyncContextStrategy {
  const carrier = getMainCarrier();
  return getAsyncContextStrategy(carrier);
}

function _startRootSpan(
  spanArguments: SentrySpanArguments,
  scope: Scope,
  parentSampled?: boolean,
): SentrySpan {
  const client = getClient();
  const options: Partial<ClientOptions> = (client && client.getOptions()) || {};

  const { name = '', attributes } = spanArguments;
  const [sampled, sampleRate] = scope.getScopeData().sdkProcessingMetadata[
    SUPPRESS_TRACING_KEY
  ]
    ? [false]
    : sampleSpan(options, {
        name,
        parentSampled,
        attributes,
        transactionContext: {
          name,
          parentSampled,
        },
      });

  const rootSpan = new SentrySpan({
    ...spanArguments,
    attributes: {
      [SEMANTIC_ATTRIBUTE_SENTRY_SOURCE]: 'custom',
      ...spanArguments.attributes,
    },
    sampled,
  });
  if (sampleRate !== undefined) {
    rootSpan.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE, sampleRate);
  }

  if (client) {
    client.emit('spanStart', rootSpan);
  }

  return rootSpan;
}

/**
 * Forks the current scope and sets the provided span as active span in the context of the provided callback. Can be
 * passed `null` to start an entirely new span tree.
 *
 * @param span Spans started in the context of the provided callback will be children of this span. If `null` is passed,
 * spans started within the callback will not be attached to a parent span.
 * @param callback Execution context in which the provided span will be active. Is passed the newly forked scope.
 * @returns the value returned from the provided callback function.
 */
export function withActiveSpan<T>(
  span: Span | null,
  callback: (scope: Scope) => T,
): T {
  const acs = getAcs();
  if (acs.withActiveSpan) {
    return acs.withActiveSpan(span, callback);
  }

  return withScope((scope) => {
    _setSpanForScope(scope, span || undefined);
    return callback(scope);
  });
}

function getParentSpan(scope: Scope): SentrySpan | undefined {
  const span = _getSpanForScope(scope) as SentrySpan | undefined;

  if (!span) {
    return undefined;
  }

  const client = getClient();
  const options: Partial<ClientOptions> = client ? client.getOptions() : {};
  if (options.parentSpanIsAlwaysRootSpan) {
    return getRootSpan(span) as SentrySpan;
  }

  return span;
}

function createChildOrRootSpan({
  parentSpan,
  spanArguments,
  forceTransaction,
  scope,
}: {
  parentSpan: SentrySpan | undefined;
  spanArguments: SentrySpanArguments;
  forceTransaction?: boolean;
  scope: Scope;
}): Span {
  if (!hasTracingEnabled()) {
    return new SentryNonRecordingSpan();
  }

  const isolationScope = getIsolationScope();

  let span: Span;
  if (parentSpan && !forceTransaction) {
    span = _startChildSpan(parentSpan, scope, spanArguments);
    addChildSpanToSpan(parentSpan, span);
  } else if (parentSpan) {
    // If we forced a transaction but have a parent span, make sure to continue from the parent span, not the scope
    const dsc = getDynamicSamplingContextFromSpan(parentSpan);
    const { traceId, spanId: parentSpanId } = parentSpan.spanContext();
    const parentSampled = spanIsSampled(parentSpan);

    span = _startRootSpan(
      {
        traceId,
        parentSpanId,
        ...spanArguments,
      },
      scope,
      parentSampled,
    );

    freezeDscOnSpan(span, dsc);
  } else {
    const {
      traceId,
      dsc,
      parentSpanId,
      sampled: parentSampled,
    } = {
      ...isolationScope.getPropagationContext(),
      ...scope.getPropagationContext(),
    };

    span = _startRootSpan(
      {
        traceId,
        parentSpanId,
        ...spanArguments,
      },
      scope,
      parentSampled,
    );

    if (dsc) {
      freezeDscOnSpan(span, dsc);
    }
  }

  logSpanStart(span);

  setCapturedScopesOnSpan(span, scope, isolationScope);

  return span;
}

/**
 * Creates a new `Span` while setting the current `Span.id` as `parentSpanId`.
 * This inherits the sampling decision from the parent span.
 */
function _startChildSpan(
  parentSpan: Span,
  scope: Scope,
  spanArguments: SentrySpanArguments,
): Span {
  const { spanId, traceId } = parentSpan.spanContext();
  const sampled = scope.getScopeData().sdkProcessingMetadata[
    SUPPRESS_TRACING_KEY
  ]
    ? false
    : spanIsSampled(parentSpan);

  const childSpan = sampled
    ? new SentrySpan({
        ...spanArguments,
        parentSpanId: spanId,
        traceId,
        sampled,
      })
    : new SentryNonRecordingSpan({ traceId });

  addChildSpanToSpan(parentSpan, childSpan);

  const client = getClient();
  if (client) {
    client.emit('spanStart', childSpan);
    // If it has an endTimestamp, it's already ended
    if (spanArguments.endTimestamp) {
      client.emit('spanEnd', childSpan);
    }
  }

  return childSpan;
}
