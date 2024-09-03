import type {
  CaptureContext,
  Client,
  ClientOptions,
  Event,
  EventHint,
  Scope as ScopeInterface,
  ScopeContext,
  StackFrame,
  StackParser,
} from '@xigua-monitor/types';
import {
  GLOBAL_OBJ,
  addExceptionMechanism,
  dateTimestampInSeconds,
  normalize,
  truncate,
  uuid4,
} from '@xigua-monitor/utils';
import { DEFAULT_ENVIRONMENT } from '../constants';
import { Scope } from '../scope';
import { applyScopeDataToEvent, mergeScopeData } from './applyScopeDataToEvent';
import { notifyEventProcessors } from '../eventProcessors';
import { getGlobalScope } from '../currentScopes';

/**
 * This type makes sure that we get either a CaptureContext, OR an EventHint.
 * It does not allow mixing them, which could lead to unexpected outcomes, e.g. this is disallowed:
 * { user: { id: '123' }, mechanism: { handled: false } }
 */
export type ExclusiveEventHintOrCaptureContext =
  | (CaptureContext & Partial<{ [key in keyof EventHint]: never }>)
  | (EventHint & Partial<{ [key in keyof ScopeContext]: never }>);

/**
 * Adds common information to events.
 *
 * The information includes release and environment from `options`,
 * breadcrumbs and context (extra, tags and user) from the scope.
 *
 * Information that is already present in the event is never overwritten. For
 * nested objects, such as the context, keys are merged.
 *
 * @param event The original event.
 * @param hint May contain additional information about the original exception.
 * @param scope A scope containing event metadata.
 * @returns A new event with more information.
 * @hidden
 */
export function prepareEvent(
  options: ClientOptions,
  event: Event,
  hint: EventHint,
  scope?: ScopeInterface,
  client?: Client,
  isolationScope?: ScopeInterface,
): PromiseLike<Event | null> {
  const { normalizeDepth = 3, normalizeMaxBreadth = 1_000 } = options;
  const prepared: Event = {
    ...event,
    event_id: event.event_id || hint.event_id || uuid4(),
    timestamp: event.timestamp || dateTimestampInSeconds(),
  };
  const integrations =
    hint.integrations || options.integrations.map((i) => i.name);

  applyClientOptions(prepared, options);
  applyIntegrationsMetadata(prepared, integrations);

  if (client) {
    client.emit('applyFrameMetadata', event);
  }

  // Only put debug IDs onto frames for error events.
  if (event.type === undefined) {
    applyDebugIds(prepared, options.stackParser);
  }

  // If we have scope given to us, use it as the base for further modifications.
  // This allows us to prevent unnecessary copying of data if `captureContext` is not provided.
  const finalScope = getFinalScope(scope, hint.captureContext);

  if (hint.mechanism) {
    addExceptionMechanism(prepared, hint.mechanism);
  }

  const clientEventProcessors = client ? client.getEventProcessors() : [];

  // This should be the last thing called, since we want that
  // {@link Scope.addEventProcessor} gets the finished prepared event.
  // Merge scope data together
  const data = getGlobalScope().getScopeData();

  if (isolationScope) {
    const isolationData = isolationScope.getScopeData();
    mergeScopeData(data, isolationData);
  }

  if (finalScope) {
    const finalScopeData = finalScope.getScopeData();
    mergeScopeData(data, finalScopeData);
  }

  const attachments = [...(hint.attachments || []), ...data.attachments];
  if (attachments.length) {
    hint.attachments = attachments;
  }

  applyScopeDataToEvent(prepared, data);

  const eventProcessors = [
    ...clientEventProcessors,
    // Run scope event processors _after_ all other processors
    ...data.eventProcessors,
  ];

  const result = notifyEventProcessors(eventProcessors, prepared, hint);

  return result.then((evt) => {
    if (evt) {
      // We apply the debug_meta field only after all event processors have ran, so that if any event processors modified
      // file names (e.g.the RewriteFrames integration) the filename -> debug ID relationship isn't destroyed.
      // This should not cause any PII issues, since we're only moving data that is already on the event and not adding
      // any new data
      applyDebugMeta(evt);
    }

    if (typeof normalizeDepth === 'number' && normalizeDepth > 0) {
      return normalizeEvent(evt, normalizeDepth, normalizeMaxBreadth);
    }
    return evt;
  });
}

/**
 * 用于解析 EventHint 或将CaptureContext 转换为 EventHint
 * 它的目的是兼容旧的函数签名，在需要时将 CaptureContext 转换为 Sentry 现在使用的 EventHint 类型
 *
 * @param hint 想要解析的提示信息或上下文
 * @returns 返回解析后的 EventHint 对象 或 undefined
 */
export function parseEventHintOrCaptureContext(
  hint: ExclusiveEventHintOrCaptureContext | undefined,
): EventHint | undefined {
  if (!hint) {
    // hint 不存在，则返回 undefined
    return undefined;
  }

  // 检查 hint 是否是 Scope 实例或一个返回 Scope 的函数
  if (hintIsScopeOrFunction(hint)) {
    return { captureContext: hint };
  }

  // 检查 hint 是否为 scope 上下文
  if (hintIsScopeContext(hint)) {
    return {
      captureContext: hint,
    };
  }

  // 如果都不是，这种情况意味着 hint 本身已经是 EventHint 类型，不需要进行任何转换
  return hint;
}

/**
 * 用于检查 hint 是否是 Scope 实例或函数
 * @param hint
 * @returns
 */
function hintIsScopeOrFunction(
  hint: CaptureContext | EventHint,
): hint is ScopeInterface | ((scope: ScopeInterface) => ScopeInterface) {
  return hint instanceof Scope || typeof hint === 'function';
}

type ScopeContextProperty = keyof ScopeContext;
const captureContextKeys: readonly ScopeContextProperty[] = [
  'user',
  'level',
  'extra',
  'contexts',
  'tags',
  'fingerprint',
  'requestSession',
  'propagationContext',
] as const;

/**
 * 这个函数用于判断传入的 hint 对象是否可以视为 ScopeContext 的一部分
 * @param hint
 * @returns
 */
function hintIsScopeContext(
  hint: Partial<ScopeContext> | EventHint,
): hint is Partial<ScopeContext> {
  return Object.keys(hint).some((key) =>
    // 检查是否存在至少一个键名在 captureContextKeys 数组中
    // 如果存在，返回 true，表示这个 hint 对象可以视为部分 ScopeContext
    captureContextKeys.includes(key as ScopeContextProperty),
  );
}

/**
 *  Enhances event using the client configuration.
 *  It takes care of all "static" values like environment, release and `dist`,
 *  as well as truncating overly long values.
 * @param event event instance to be enhanced
 */
function applyClientOptions(event: Event, options: ClientOptions): void {
  const { environment, release, dist, maxValueLength = 250 } = options;

  if (!('environment' in event)) {
    event.environment =
      'environment' in options ? environment : DEFAULT_ENVIRONMENT;
  }

  if (event.release === undefined && release !== undefined) {
    event.release = release;
  }

  if (event.dist === undefined && dist !== undefined) {
    event.dist = dist;
  }

  if (event.message) {
    event.message = truncate(event.message, maxValueLength);
  }

  const exception =
    event.exception && event.exception.values && event.exception.values[0];
  if (exception && exception.value) {
    exception.value = truncate(exception.value, maxValueLength);
  }

  const request = event.request;
  if (request && request.url) {
    request.url = truncate(request.url, maxValueLength);
  }
}

/**
 * This function adds all used integrations to the SDK info in the event.
 * @param event The event that will be filled with all integrations.
 */
function applyIntegrationsMetadata(
  event: Event,
  integrationNames: string[],
): void {
  if (integrationNames.length > 0) {
    event.sdk = event.sdk || {};
    event.sdk.integrations = [
      ...(event.sdk.integrations || []),
      ...integrationNames,
    ];
  }
}

const debugIdStackParserCache = new WeakMap<
  StackParser,
  Map<string, StackFrame[]>
>();

/**
 * Puts debug IDs into the stack frames of an error event.
 */
export function applyDebugIds(event: Event, stackParser: StackParser): void {
  const debugIdMap = GLOBAL_OBJ._sentryDebugIds;

  if (!debugIdMap) {
    return;
  }

  let debugIdStackFramesCache: Map<string, StackFrame[]>;
  const cachedDebugIdStackFrameCache = debugIdStackParserCache.get(stackParser);
  if (cachedDebugIdStackFrameCache) {
    debugIdStackFramesCache = cachedDebugIdStackFrameCache;
  } else {
    debugIdStackFramesCache = new Map<string, StackFrame[]>();
    debugIdStackParserCache.set(stackParser, debugIdStackFramesCache);
  }

  // Build a map of filename -> debug_id
  const filenameDebugIdMap = Object.entries(debugIdMap).reduce<
    Record<string, string>
  >((acc, [debugIdStackTrace, debugIdValue]) => {
    let parsedStack: StackFrame[];
    const cachedParsedStack = debugIdStackFramesCache.get(debugIdStackTrace);
    if (cachedParsedStack) {
      parsedStack = cachedParsedStack;
    } else {
      parsedStack = stackParser(debugIdStackTrace);
      debugIdStackFramesCache.set(debugIdStackTrace, parsedStack);
    }

    for (let i = parsedStack.length - 1; i >= 0; i--) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const stackFrame = parsedStack[i]!;
      if (stackFrame.filename) {
        acc[stackFrame.filename] = debugIdValue;
        break;
      }
    }
    return acc;
  }, {});

  try {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    event!.exception!.values!.forEach((exception) => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      exception.stacktrace!.frames!.forEach((frame) => {
        if (frame.filename) {
          frame.debug_id = filenameDebugIdMap[frame.filename];
        }
      });
    });
  } catch (e) {
    // To save bundle size we're just try catching here instead of checking for the existence of all the different objects.
  }
}

/**
 * Moves debug IDs from the stack frames of an error event into the debug_meta field.
 */
export function applyDebugMeta(event: Event): void {
  // Extract debug IDs and filenames from the stack frames on the event.
  const filenameDebugIdMap: Record<string, string> = {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    event.exception!.values!.forEach((exception) => {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      exception.stacktrace!.frames!.forEach((frame) => {
        if (frame.debug_id) {
          if (frame.abs_path) {
            filenameDebugIdMap[frame.abs_path] = frame.debug_id;
          } else if (frame.filename) {
            filenameDebugIdMap[frame.filename] = frame.debug_id;
          }
          delete frame.debug_id;
        }
      });
    });
  } catch (e) {
    // To save bundle size we're just try catching here instead of checking for the existence of all the different objects.
  }

  if (Object.keys(filenameDebugIdMap).length === 0) {
    return;
  }

  // Fill debug_meta information
  event.debug_meta = event.debug_meta || {};
  event.debug_meta.images = event.debug_meta.images || [];
  const images = event.debug_meta.images;
  Object.entries(filenameDebugIdMap).forEach(([filename, debug_id]) => {
    images.push({
      type: 'sourcemap',
      code_file: filename,
      debug_id,
    });
  });
}

function getFinalScope(
  scope: ScopeInterface | undefined,
  captureContext: CaptureContext | undefined,
): ScopeInterface | undefined {
  if (!captureContext) {
    return scope;
  }

  const finalScope = scope ? scope.clone() : new Scope();
  finalScope.update(captureContext);
  return finalScope;
}

/**
 * Applies `normalize` function on necessary `Event` attributes to make them safe for serialization.
 * Normalized keys:
 * - `breadcrumbs.data`
 * - `user`
 * - `contexts`
 * - `extra`
 * @param event Event
 * @returns Normalized event
 */
function normalizeEvent(
  event: Event | null,
  depth: number,
  maxBreadth: number,
): Event | null {
  if (!event) {
    return null;
  }

  const normalized: Event = {
    ...event,
    ...(event.breadcrumbs && {
      breadcrumbs: event.breadcrumbs.map((b) => ({
        ...b,
        ...(b.data && {
          data: normalize(b.data, depth, maxBreadth),
        }),
      })),
    }),
    ...(event.user && {
      user: normalize(event.user, depth, maxBreadth),
    }),
    ...(event.contexts && {
      contexts: normalize(event.contexts, depth, maxBreadth),
    }),
    ...(event.extra && {
      extra: normalize(event.extra, depth, maxBreadth),
    }),
  };

  // event.contexts.trace stores information about a Transaction. Similarly,
  // event.spans[] stores information about child Spans. Given that a
  // Transaction is conceptually a Span, normalization should apply to both
  // Transactions and Spans consistently.
  // For now the decision is to skip normalization of Transactions and Spans,
  // so this block overwrites the normalized event to add back the original
  // Transaction information prior to normalization.
  if (event.contexts && event.contexts.trace && normalized.contexts) {
    normalized.contexts.trace = event.contexts.trace;

    // event.contexts.trace.data may contain circular/dangerous data so we need to normalize it
    if (event.contexts.trace.data) {
      normalized.contexts.trace.data = normalize(
        event.contexts.trace.data,
        depth,
        maxBreadth,
      );
    }
  }

  // event.spans[].data may contain circular/dangerous data so we need to normalize it
  if (event.spans) {
    normalized.spans = event.spans.map((span) => {
      return {
        ...span,
        ...(span.data && {
          data: normalize(span.data, depth, maxBreadth),
        }),
      };
    });
  }

  return normalized;
}
