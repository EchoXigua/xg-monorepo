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

/**
 * 一个用于标记是否需要抑制追踪的键
 * 当某些操作不需要追踪时，可以设置这个键，以避免产生不必要的 Span。
 */
const SUPPRESS_TRACING_KEY = '__SENTRY_SUPPRESS_TRACING__';

/**
 * 这个函数的主要作用是创建一个 span 对象。span 是一种用于表示和追踪一个操作或事件的时间段的结构化数据。
 * 生成的 span 不会被设置为“活动”状态。所谓“活动”意味着它不会被自动注册为当前活跃的 span。
 * 因为这个 span 不是“活动”状态，所以它不会自动附带子 span。
 * 通常，活动的 span 可以自动追踪和关联其子操作，而非活动的 span 则不会具备这种自动追踪的功能。
 * 这个 span 不能通过 Sentry.getActiveSpan() 方法获取
 *
 * 如果你希望创建一个设置为“活动”状态的 span，你应该使用 startSpan 函数。
 * startSpan 会生成一个自动被设置为当前活跃的 span，并且支持自动追踪子操作。
 * If you want to create a span that is set as active, use {@link startSpan}.
 *
 * 无论如何，这个函数总会返回一个 span 对象。
 * 在某些情况下，返回的 span 可能只是一个“非记录”状态的 span，也就是说它不会实际记录任何信息。
 * 如果这个 span 没有被采样（即不在要记录的采样范围内）或者追踪功能被禁用了，
 * 这个 span 就会是“非记录”状态，即这个 span 可能不会实际记录任何数据。
 * Sentry 通过采样来控制记录的数量，以平衡性能和数据量。
 *
 * @param options 创建 Span 所需的配置选项
 * @returns 返回一个 span
 */
export function startInactiveSpan(options: StartSpanOptions): Span {
  /** 获取当前活动上下文的状态对象 */
  const acs = getAcs();
  // 如果 acs 中存在这个方法则通过这个方法来创建 span
  if (acs.startInactiveSpan) {
    return acs.startInactiveSpan(options);
  }

  // 解析传入的配置
  const spanArguments = parseSentrySpanArguments(options);
  /**
   * forceTransaction: 表示是否强制将该 Span 作为一个 Transaction（一个完整的操作）
   * customParentSpan: 自定义的父 Span，如果提供了它，新的 Span 将作为这个 parentSpan 的子 Span
   */
  const { forceTransaction, parentSpan: customParentSpan } = options;

  // If `options.scope` is defined, we use this as as a wrapper,
  // If `options.parentSpan` is defined, we want to wrap the callback in `withActiveSpan`
  // 创建一个 wrapper 函数，用于包装创建 span 的逻辑
  const wrapper = options.scope
    ? (callback: () => Span) => withScope(options.scope, callback)
    : customParentSpan !== undefined
      ? // 存在父span
        (callback: () => Span) => withActiveSpan(customParentSpan, callback)
      : // 没有 scope 没有 父span 则wrapper 只是简单的执行回调
        (callback: () => Span) => callback();

  return wrapper(() => {
    // 这里是span 创建的逻辑

    // 获取当前的 scope（范围或上下文）
    const scope = getCurrentScope();
    // 根据当前的 scope 获取一个可能存在的 parentSpan
    // 这个 parentSpan 将作为新 Span 的父级
    const parentSpan = getParentSpan(scope);

    // 如果 onlyIfParent 为 true 并且没有找到 parentSpan
    // 这意味着当前 Span 将不会被创建，而是直接返回一个非记录的 Span
    const shouldSkipSpan = options.onlyIfParent && !parentSpan;

    if (shouldSkipSpan) {
      // 这种 Span 对象不会记录任何数据，仅用于占位符
      return new SentryNonRecordingSpan();
    }

    // 如果没有跳过 Span 的创建，则通过这个方法来创建span
    return createChildOrRootSpan({
      parentSpan,
      spanArguments,
      forceTransaction,
      scope,
    });
  });
}

/**
 * 这个函数的目的是将输入的 StartSpanOptions 对象转换为符合 Sentry 所需的 SentrySpanArguments 格式。
 * 这涉及一些属性的重命名（如 startTime -> startTimestamp）以及一些属性的条件性添加（如 isStandalone）。
 */
function parseSentrySpanArguments(
  options: StartSpanOptions,
): SentrySpanArguments {
  // 将 experimental种的standalone 属性映射到返回的对象种
  const exp = options.experimental || {};
  const initialCtx: SentrySpanArguments = {
    isStandalone: exp.standalone,
    ...options,
  };

  if (options.startTime) {
    // 如果 options 对象中包含 startTime 属性，该属性将被转换为 startTimestamp
    const ctx: SentrySpanArguments & { startTime?: SpanTimeInput } = {
      ...initialCtx,
    };
    ctx.startTimestamp = spanTimeInputToSeconds(options.startTime);
    // startTime 属性被删除，因为它已被替换为 startTimestamp。
    delete ctx.startTime;
    return ctx;
  }

  //  options 中没有 startTime 属性，则直接返回初始的 initialCtx 对象
  return initialCtx;
}

function getAcs(): AsyncContextStrategy {
  const carrier = getMainCarrier();
  return getAsyncContextStrategy(carrier);
}

/**
 * 用于启动一个根 span，通常用于性能监控和追踪
 * @param spanArguments 包含有关 span 的参数，例如名称和属性
 * @param scope 当前作用域，用于跟踪上下文
 * @param parentSampled 父级 span 是否被采样
 * @returns
 */
function _startRootSpan(
  spanArguments: SentrySpanArguments,
  scope: Scope,
  parentSampled?: boolean,
): SentrySpan {
  const client = getClient();
  const options: Partial<ClientOptions> = (client && client.getOptions()) || {};

  // 提取属性
  const { name = '', attributes } = spanArguments;

  // 检查当前是否需要采样
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

  // 创建啊根 span
  const rootSpan = new SentrySpan({
    ...spanArguments,
    attributes: {
      // 标识这是一个自定义源的 span
      [SEMANTIC_ATTRIBUTE_SENTRY_SOURCE]: 'custom',
      ...spanArguments.attributes,
    },
    sampled,
  });
  // 存在采样率
  if (sampleRate !== undefined) {
    // 在根 span上设置采样率
    rootSpan.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE, sampleRate);
  }

  // 如果存在客户端，触发spanStart事件
  if (client) {
    client.emit('spanStart', rootSpan);
  }

  // 返回根 span
  return rootSpan;
}

/**

 * 这个函数用于管理与 Sentry 监控相关的「活动 Span」上下文。
 * 它允许你在某个回调函数执行时，将一个 Span 设置为当前活动的 Span，确保在该回调上下文中所有新创建的 Spans 都与这个 Span 相关联。
 *
 * @param span 传入的 Span 将被设置为当前活动的 Span，在回调 callback 的执行过程中，
 * 所有新创建的 Span 都将被视为这个 Span 的子 Span。
 * 如果传入 null，意味着在回调执行期间新创建的 Spans 不会关联到任何父 Span
 *
 * @param callback 它将在 withActiveSpan 函数设置了新的 Span 上下文后被调用
 * @returns
 */
export function withActiveSpan<T>(
  span: Span | null,
  callback: (scope: Scope) => T,
): T {
  // 获取当前的 acs 对象
  const acs = getAcs();
  if (acs.withActiveSpan) {
    // 如果 acs 对象支持 withActiveSpan 方法，则使用acs 对象的方法
    return acs.withActiveSpan(span, callback);
  }

  // 默认实现
  return withScope((scope) => {
    // 在新的 Scope 中设置 Span
    _setSpanForScope(scope, span || undefined);
    return callback(scope);
  });
}

/**
 * 这个函数用于获取给定 Scope 的父级 Span
 * 在 Sentry 中，Span 是用于跟踪操作和事件的基本单元，通过 Span 可以组织和管理一系列相关操作。
 * Scope 则是一个包含上下文信息的对象，可以包含当前活跃的 Span。
 *
 * @param scope
 * @returns
 */
function getParentSpan(scope: Scope): SentrySpan | undefined {
  // 获取的当前 Scope 中的 Span
  const span = _getSpanForScope(scope) as SentrySpan | undefined;

  // 如果 Span 不存在，直接返回 undefined，表示没有可用的父 Span
  if (!span) {
    return undefined;
  }

  // 获取的当前 Sentry 客户端实例
  const client = getClient();
  // 获取客户端实例的配置项，不存在的为空对象
  const options: Partial<ClientOptions> = client ? client.getOptions() : {};

  // 检查配置种是否设置了 parentSpanIsAlwaysRootSpan，
  // 这个选项指示是否应该总是将根 Span 作为父 Span。
  if (options.parentSpanIsAlwaysRootSpan) {
    // 获取根 Span 并将其作为父 Span 返回
    return getRootSpan(span) as SentrySpan;
  }

  // 如果没有特殊配置，直接返回当前的 Span 作为父 Span
  return span;
}

/**
 * 这是一个核心函数，用于根据当前的上下文创建一个新的 Span
 * Span 是 Sentry 中用于追踪操作（如请求、事务等）的基本单元
 * 这个函数能够根据是否有父 Span、是否强制创建事务等条件，决定创建一个子 Span 还是根 Span
 *
 * @param param0
 * @returns
 */
function createChildOrRootSpan({
  parentSpan, // 表示当前操作的父 Span,如果存在，这个新的 Span 将作为 parentSpan 的子 Span
  spanArguments, // 创建 Span 所需的参数，如操作名称、开始时间等
  forceTransaction, // 如果为 true，则即使存在 parentSpan，也会强制创建一个根 Span（即一个新的事务）
  scope,
}: {
  parentSpan: SentrySpan | undefined;
  spanArguments: SentrySpanArguments;
  forceTransaction?: boolean;
  scope: Scope;
}): Span {
  // 检查是否启用了追踪功能, hasTracingEnabled 函数用于检查当前环境或配置是否启用了 Tracing
  if (!hasTracingEnabled()) {
    // 没有启用追踪功能的话会返回一个 不会记录任何数据，仅作为占位符存在的 span
    return new SentryNonRecordingSpan();
  }

  // 获取当前的隔离范围
  // 隔离范围可能是用于管理 Span 的传播上下文（如追踪 ID、动态采样上下文等）的一个概念
  const isolationScope = getIsolationScope();

  // 创建 Span 有三种情况：

  let span: Span;
  // 有父span且没有强制事务
  if (parentSpan && !forceTransaction) {
    // 这个函数用于创建子 Span，并将其与父 Span 关联
    span = _startChildSpan(parentSpan, scope, spanArguments);
    // 将创建的子 Span 添加到父 Span 的子 Span 列表中
    addChildSpanToSpan(parentSpan, span);
  } else if (parentSpan) {
    // 有 父 span 且 强制事务，则创建一个根 Span，但继续沿用 parentSpan 的上下文信息

    // 获取父 Span 的动态采样上下文
    const dsc = getDynamicSamplingContextFromSpan(parentSpan);

    // 从父 Span上下文信息中提取 的 traceId 和 parentSpanId，这些信息会传递到新创建的根 Span 中。
    const { traceId, spanId: parentSpanId } = parentSpan.spanContext();

    // 获取父span 的采样状态
    const parentSampled = spanIsSampled(parentSpan);

    // 创建一个新的根 Span，并将父 Span 的采样状态 (sampled) 传递下去
    span = _startRootSpan(
      {
        traceId,
        parentSpanId,
        ...spanArguments,
      },
      scope,
      parentSampled,
    );

    // 将动态采样上下文冻结到新的 Span 中，以确保追踪的一致性
    freezeDscOnSpan(span, dsc);
  } else {
    // 没有父 span，也不是强制事务

    // 从 isolationScope 和 scope 中获取传播上下文（如 traceId、动态采样上下文 dsc 等），并创建一个新的根 Span。
    const {
      traceId,
      dsc,
      parentSpanId,
      sampled: parentSampled,
    } = {
      ...isolationScope.getPropagationContext(),
      ...scope.getPropagationContext(),
    };

    // 创建根 Span，并将上下文信息传递进去。
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
      // 如果存在动态采样上下文，它会被冻结到新的 Span 中，以保持一致性。
      freezeDscOnSpan(span, dsc);
    }
  }

  // 记录 Span 的开始时间或其他相关信息，通常用于调试或日志记录
  logSpanStart(span);

  // 这个函数将 scope 和 isolationScope 关联到 Span 上，以确保 Span 的上下文信息被正确捕获和传播。
  setCapturedScopesOnSpan(span, scope, isolationScope);

  // 返回创建的 span
  return span;
}

/**
 * 这个函数的作用是在现有的父 span 的基础上创建一个新的子 Span
 * 并将当前 Span.id 设置为新 Span 的 parentSpanId
 * 这意味着新创建的 Span 会继承其父级 Span 的采样决策
 *
 * @param parentSpan 父 span
 * @param scope 当前上下文，包含了追踪信息、用户会话等数据。
 * @param spanArguments 用于创建 Span 的参数，比如操作名称、开始时间等
 * @returns
 */
function _startChildSpan(
  parentSpan: Span,
  scope: Scope,
  spanArguments: SentrySpanArguments,
): Span {
  // 提取父 span 的上下文信息（spanId 和 traceId），用于构建子 Span
  const { spanId, traceId } = parentSpan.spanContext();
  // 检查当前上下文中是否存在 SUPPRESS_TRACING_KEY
  // 这个键通常用于指示是否要抑制追踪。如果抑制追踪，这里 sampled 会被设置为 false
  const sampled = scope.getScopeData().sdkProcessingMetadata[
    SUPPRESS_TRACING_KEY
  ]
    ? false
    : // 如果没有抑制追踪，判断父级 Span 是否被采样
      spanIsSampled(parentSpan);

  // 如果父级 Span 被采样，新创建的子 Span 也会被采样
  const childSpan = sampled
    ? new SentrySpan({
        ...spanArguments,
        parentSpanId: spanId,
        traceId,
        sampled,
      })
    : // 这是一个不记录任何信息的 Span，主要用于未采样的情况
      new SentryNonRecordingSpan({ traceId });

  // 将新创建的 childSpan 添加到 parentSpan 中。
  // 这样，父级 Span 会持有对其子 Span 的引用，确保它们的层次关系被正确维护。
  addChildSpanToSpan(parentSpan, childSpan);

  // 获取当前 Sentry 客户端实例（client）
  const client = getClient();
  if (client) {
    // 存在客户端实例

    // 触发 spanStart 事件，通知系统新的 Span 已经启动。
    client.emit('spanStart', childSpan);
    if (spanArguments.endTimestamp) {
      // 如果在创建 Span 时已经提供了结束时间戳，说明 Span 已经结束，触发 spanEnd 事件
      client.emit('spanEnd', childSpan);
    }
  }

  // 新创建的 childSpan，这个 Span 要么是真正的记录 Span，要么是一个非记录 Span
  return childSpan;
}
