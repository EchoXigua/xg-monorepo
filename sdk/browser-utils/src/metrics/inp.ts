import {
  SEMANTIC_ATTRIBUTE_EXCLUSIVE_TIME,
  SEMANTIC_ATTRIBUTE_SENTRY_MEASUREMENT_UNIT,
  SEMANTIC_ATTRIBUTE_SENTRY_MEASUREMENT_VALUE,
  SEMANTIC_ATTRIBUTE_SENTRY_OP,
  SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN,
  getActiveSpan,
  getCurrentScope,
  getRootSpan,
  spanToJSON,
} from '@xigua-monitor/core';
import type { Span, SpanAttributes } from '@xigua-monitor/types';
import {
  browserPerformanceTimeOrigin,
  dropUndefinedKeys,
  htmlTreeAsString,
} from '@xigua-monitor/utils';
import {
  addInpInstrumentationHandler,
  addPerformanceInstrumentationHandler,
  isPerformanceEventTiming,
} from './instrument';
import {
  getBrowserPerformanceAPI,
  msToSec,
  startStandaloneWebVitalSpan,
} from './utils';

/**
 * 用于存储最后的交互时间戳（以毫秒为单位）
 */
const LAST_INTERACTIONS: number[] = [];
/**
 * 将数字（可能是交互的 ID 或时间戳）映射到 Span 对象。这可以用来在测量输入延迟时存储相关的时间段信息。
 */
const INTERACTIONS_SPAN_MAP = new Map<number, Span>();

/**
 * 用于启动对 INP Web Vital 事件的跟踪
 */
export function startTrackingINP(): () => void {
  const performance = getBrowserPerformanceAPI();
  // 如果支持性能 api 且 支持基准时间
  if (performance && browserPerformanceTimeOrigin) {
    const inpCallback = _trackINP();

    // 返回一个可以在后续调用中停止跟踪的回调函数
    return (): void => {
      inpCallback();
    };
  }

  // 不支持 返回一个空函数
  return () => undefined;
}

/**
 * 用于将不同的事件名称（如 click, hover, drag, press）关联到它们的类别，
 * 以便在后续处理中快速识别交互类型。
 */
const INP_ENTRY_MAP: Record<string, 'click' | 'hover' | 'drag' | 'press'> = {
  click: 'click',
  pointerdown: 'click',
  pointerup: 'click',
  mousedown: 'click',
  mouseup: 'click',
  touchstart: 'click',
  touchend: 'click',
  mouseover: 'hover',
  mouseout: 'hover',
  mouseenter: 'hover',
  mouseleave: 'hover',
  pointerover: 'hover',
  pointerout: 'hover',
  pointerenter: 'hover',
  pointerleave: 'hover',
  dragstart: 'drag',
  dragend: 'drag',
  drag: 'drag',
  dragenter: 'drag',
  dragleave: 'drag',
  dragover: 'drag',
  drop: 'drag',
  keydown: 'press',
  keyup: 'press',
  keypress: 'press',
  input: 'press',
};

/**
 * 用于开始跟踪当前页面上的 INP 事件
 * 返回一个函数，通常用于在后续需要时停止跟踪
 */
function _trackINP(): () => void {
  return addInpInstrumentationHandler(({ metric }) => {
    if (metric.value == undefined) {
      return;
    }

    // 查找匹配的条目,其持续时间等于 metric.value 并且存在于 INP_ENTRY_MAP 中
    const entry = metric.entries.find(
      (entry) => entry.duration === metric.value && INP_ENTRY_MAP[entry.name],
    );

    // 没有找到直接返回
    if (!entry) {
      return;
    }

    // 获取当前条目的 interactionId 和相应的交互类型。
    const { interactionId } = entry;
    const interactionType = INP_ENTRY_MAP[entry.name];

    // 计算时间
    const startTime = msToSec(
      (browserPerformanceTimeOrigin as number) + entry.startTime,
    );
    const duration = msToSec(metric.value);

    // 获取当前活跃的 span
    const activeSpan = getActiveSpan();
    // 获取当前活跃 span 的 根span
    const rootSpan = activeSpan ? getRootSpan(activeSpan) : undefined;

    // 首先尝试从缓存中获取 span，如果没有，则使用根 Span
    const cachedSpan =
      interactionId != null
        ? INTERACTIONS_SPAN_MAP.get(interactionId)
        : undefined;

    const spanToUse = cachedSpan || rootSpan;

    // 如果存在可用的 Span，则获取其描述，否则使用当前作用域中的事务名称
    const routeName = spanToUse
      ? spanToJSON(spanToUse).description
      : getCurrentScope().getScopeData().transactionName;

    // 构建 Span 属性
    const name = htmlTreeAsString(entry.target);
    const attributes: SpanAttributes = dropUndefinedKeys({
      [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.http.browser.inp',
      [SEMANTIC_ATTRIBUTE_SENTRY_OP]: `ui.interaction.${interactionType}`,
      [SEMANTIC_ATTRIBUTE_EXCLUSIVE_TIME]: entry.duration,
    });

    // 创建一个新的、独立的 Span
    const span = startStandaloneWebVitalSpan({
      name,
      transaction: routeName,
      attributes,
      startTime,
    });

    // 添加 inp 事件
    span?.addEvent('inp', {
      [SEMANTIC_ATTRIBUTE_SENTRY_MEASUREMENT_UNIT]: 'millisecond',
      [SEMANTIC_ATTRIBUTE_SENTRY_MEASUREMENT_VALUE]: metric.value,
    });

    // 这里手动去结束 span
    span?.end(startTime + duration);
  });
}

/**
 * 韩式核心功能是监听与 INP （Interaction to Next Paint）相关的性能事件，并缓存最多 10 个交互信息，以便后续分析和报告。
 *
 * TODO(v9): `latestRoute` no longer needs to be passed in and will be removed in v9.
 * _latestRoute 是一个可选参数，在当前版本中未使用，计划在 v9 中删除
 */
export function registerInpInteractionListener(_latestRoute?: unknown): void {
  // 定义处理函数
  const handleEntries = ({
    entries,
  }: {
    entries: PerformanceEntry[];
  }): void => {
    const activeSpan = getActiveSpan();
    const activeRootSpan = activeSpan && getRootSpan(activeSpan);

    // 遍历每个性能条目
    entries.forEach((entry) => {
      // 检查条目是否为性能事件时机 是否存在根 span
      if (!isPerformanceEventTiming(entry) || !activeRootSpan) {
        return;
      }

      // 如果 interactionId 为 null，则返回，表示没有有效的交互 ID
      const interactionId = entry.interactionId;
      if (interactionId == null) {
        return;
      }

      // 检查是否已记录该交互 ID，防止重复记录
      if (INTERACTIONS_SPAN_MAP.has(interactionId)) {
        // 如果已记录，则返回
        return;
      }

      // 限制缓存的交互数量为 10。当超出时，删除最旧的交互 ID 及其关联的 Span
      if (LAST_INTERACTIONS.length > 10) {
        const last = LAST_INTERACTIONS.shift() as number;
        INTERACTIONS_SPAN_MAP.delete(last);
      }

      // 添加交互信息
      LAST_INTERACTIONS.push(interactionId);
      INTERACTIONS_SPAN_MAP.set(interactionId, activeRootSpan);
    });
  };

  // 监听 event 和 first-input 事件
  addPerformanceInstrumentationHandler('event', handleEntries);
  addPerformanceInstrumentationHandler('first-input', handleEntries);
}
