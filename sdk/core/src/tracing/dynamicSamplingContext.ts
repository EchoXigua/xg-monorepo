import type {
  Client,
  DynamicSamplingContext,
  Span,
} from '@xigua-monitor/types';
import {
  addNonEnumerableProperty,
  baggageHeaderToDynamicSamplingContext,
  dropUndefinedKeys,
  // dynamicSamplingContextToSentryBaggageHeader,
} from '@xigua-monitor/utils';
import { DEFAULT_ENVIRONMENT } from '../constants';
import { getClient } from '../currentScopes';
import { getRootSpan, spanIsSampled, spanToJSON } from '../utils/spanUtils';
import {
  SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE,
  SEMANTIC_ATTRIBUTE_SENTRY_SOURCE,
} from '../semanticAttributes';

/**
 * 这是一个字符串常量，表示一个属性名 _frozenDsc。
 * 它将在 Span 对象中用作键，存储冻结的动态采样上下文。
 *
 * 如果你改变这个值，也要更新terser插件配置，以避免对象属性的最小化!
 */
const FROZEN_DSC_FIELD = '_frozenDsc';

type SpanWithMaybeDsc = Span & {
  [FROZEN_DSC_FIELD]?: Partial<DynamicSamplingContext> | undefined;
};

/**
 * 将给定的动态采样上下文 dsc 冻结在 span 上
 */
export function freezeDscOnSpan(
  span: Span,
  dsc: Partial<DynamicSamplingContext>,
): void {
  // 将传入的 span 转换为 SpanWithMaybeDsc 类型。
  // 这只是为了让 ts 了解 span 可能包含 _frozenDsc 属性。
  const spanWithMaybeDsc = span as SpanWithMaybeDsc;

  // 在span 上添加不可枚举的 dsc
  addNonEnumerableProperty(spanWithMaybeDsc, FROZEN_DSC_FIELD, dsc);
}

/**
 * 根据客户端配置生成一个动态采样上下文，并触发 createDsc 生命周期钩子
 */
export function getDynamicSamplingContextFromClient(
  trace_id: string,
  client: Client,
): DynamicSamplingContext {
  // 获取客户端实例的配置项
  const options = client.getOptions();

  // 从客户端的 DSN 中提取 publicKey（公共密钥）
  const { publicKey: public_key } = client.getDsn() || {};

  // 过滤掉 undefined 的键，然后构建动态采样上下文 dsc。
  const dsc = dropUndefinedKeys({
    environment: options.environment || DEFAULT_ENVIRONMENT, // 环境
    release: options.release, // 版本
    public_key, // 公钥
    trace_id, // 追踪id
  }) as DynamicSamplingContext;

  // 触发一个 createDsc 事件，向客户端发出已创建 dsc 的通知
  client.emit('createDsc', dsc);

  return dsc;
}

/**
 * 这个函数用于从给定的 Span 对象中创建一个动态采样上下文
 *
 * @param span 用于提取相关信息来生成 DSC
 * @returns 返回一个动态采样上下文
 */
export function getDynamicSamplingContextFromSpan(
  span: Span,
): Readonly<Partial<DynamicSamplingContext>> {
  // 如果客户端实例不存在，则返回空对象
  const client = getClient();
  if (!client) {
    return {};
  }

  // 使用 span 的 trace_id 和客户端实例生成 DSC
  const dsc = getDynamicSamplingContextFromClient(
    spanToJSON(span).trace_id || '',
    client,
  );

  // 获取根 span
  const rootSpan = getRootSpan(span);

  // 检查根 Span 上是否已经存在冻结的 DSC，如果存在，直接返回该冻结的 DSC。
  const frozenDsc = (rootSpan as SpanWithMaybeDsc)[FROZEN_DSC_FIELD];
  if (frozenDsc) {
    return frozenDsc;
  }

  // 如果根 Span 的 traceState 中存在 sentry.dsc，
  const traceState = rootSpan.spanContext().traceState;
  const traceStateDsc = traceState && traceState.get('sentry.dsc');
  // 如果根 span有DSC，会优先使用它
  const dscOnTraceState =
    traceStateDsc && baggageHeaderToDynamicSamplingContext(traceStateDsc);

  if (dscOnTraceState) {
    return dscOnTraceState;
  }

  // 否则从根span 生成
  // 将根 Span 转换为 JSON 格式，
  const jsonSpan = spanToJSON(rootSpan);
  const attributes = jsonSpan.data || {};
  // 然后检查其属性中是否包含 SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE
  const maybeSampleRate = attributes[SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE];

  if (maybeSampleRate != null) {
    // 如果存在，则将其设置为 DSC 的采样率
    dsc.sample_rate = `${maybeSampleRate}`;
  }

  /**
   * 检查 Span 的源头 source 属性，如果该源头不是 URL 且事务名称 name 存在，
   * 则将该名称设置为 DSC 的 transaction 字段。
   * 此处避免使用 URL 作为事务名称是为了防止潜在的 PII（Personally Identifiable Information，个人身份信息）泄露
   */
  const source = attributes[SEMANTIC_ATTRIBUTE_SENTRY_SOURCE];
  const name = jsonSpan.description;
  if (source !== 'url' && name) {
    dsc.transaction = name;
  }

  // 检查 根Span 是否被采样，并将结果存储在 DSC 的 sampled 字段中
  dsc.sampled = String(spanIsSampled(rootSpan));
  // 触发 createDsc 事件，通知其他组件已创建 DSC
  client.emit('createDsc', dsc, rootSpan);

  // 返回生成的 DSC。
  return dsc;
}
