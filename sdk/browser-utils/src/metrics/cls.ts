import {
  SEMANTIC_ATTRIBUTE_EXCLUSIVE_TIME,
  SEMANTIC_ATTRIBUTE_SENTRY_MEASUREMENT_UNIT,
  SEMANTIC_ATTRIBUTE_SENTRY_MEASUREMENT_VALUE,
  SEMANTIC_ATTRIBUTE_SENTRY_OP,
  SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN,
  getActiveSpan,
  getClient,
  getCurrentScope,
  getRootSpan,
  spanToJSON,
} from '@xigua-monitor/core';
import type { SpanAttributes } from '@xigua-monitor/types';
import {
  browserPerformanceTimeOrigin,
  dropUndefinedKeys,
  htmlTreeAsString,
  logger,
} from '@xigua-monitor/utils';
import { DEBUG_BUILD } from '../debug-build';
import { addClsInstrumentationHandler } from './instrument';
import { msToSec, startStandaloneWebVitalSpan } from './utils';
import { onHidden } from './web-vitals/lib/onHidden';

/**
 * 这个函数的主要功能是监测页面的Cumulative Layout Shift (CLS)，并在特定的情况下记录并发送CLS的数值
 *  - 在页面的可见性变为 hidden 时
 *  - 当发生SPA（单页面应用）内部的软导航时（通过“导航跨度”标识）停止 CLS 的测量并记录数据
 *
 * 当页面的可见性状态变为 hidden（用户离开页面或关闭页面时）或者发生一次软导航时，
 * 就会停止 CLS 的测量，并将 CLS 的值作为独立的跨度发送。
 */

export function trackClsAsStandaloneSpan(): void {
  /** 保存 CLS 的累积值 */
  let standaloneCLsValue = 0;
  /** 存储最新的 LayoutShift 事件条目 */
  let standaloneClsEntry: LayoutShift | undefined;
  /** 保存页面加载的跨度 ID */
  let pageloadSpanId: string | undefined;

  // 检查当前浏览器是否支持 LayoutShift（布局偏移）事件，不支持直接返回
  if (!supportsLayoutShift()) {
    return;
  }

  // 防止多次发送 CLS 数据，确保 CLS 数据只被发送一次
  let sentSpan = false;

  /**
   * 一旦触发（页面隐藏或者软导航）该函数会：
   *  - 发送 CLS 数据
   *  - 停止 CLS 的监听
   * @returns
   */
  function _collectClsOnce() {
    // 如果已经发送过了 直接返回
    if (sentSpan) {
      return;
    }

    // 还没发送,标记为已发送
    sentSpan = true;

    /**
     * pageloadSpanId 是页面加载期间生成的唯一标识符，用于关联页面的加载过程。
     * 如果 pageloadSpanId 存在，意味着我们正在处理一个有效的页面加载过程，因此可以将相关的 CLS 数据发送出去。
     */
    if (pageloadSpanId) {
      // 发送 cls 数据
      sendStandaloneClsSpan(
        standaloneCLsValue, // 累积布局偏移的具体值，表示页面元素在加载过程中偏移的程度
        standaloneClsEntry, // 包含 CLS 事件的相关信息（如发生的时间、偏移的元素等）
        pageloadSpanId, // 页面加载的唯一标识符，用于追踪 CLS 数据与特定页面加载流程的关联
      );
    }

    // 在 CLS 数据发送完毕后，调用该函数来解除之前可能注册的监听器或回调函数，避免不必要的资源占用或多次触发
    cleanupClsHandler();
  }

  // 监听 LayoutShift 事件
  const cleanupClsHandler = addClsInstrumentationHandler(({ metric }) => {
    // 每次有新的布局偏移时，获取最后一个 LayoutShift 事件条目，
    const entry = metric.entries[metric.entries.length - 1] as
      | LayoutShift
      | undefined;
    if (!entry) {
      return;
    }
    // 更新值
    standaloneCLsValue = metric.value;
    standaloneClsEntry = entry;
  }, true);

  // 当页面变为不可见（例如用户切换标签页或关闭页面）时，触发回调
  onHidden(() => {
    _collectClsOnce();
  });

  /**
   * 这里会将逻辑推到下一个事件循环中去执行,为什么要这样做呢?
   *
   * 1. 调用链同步问题：
   *  - 当前函数的执行是同步的。这意味着在执行过程中，所有代码会按顺序在同一事件循环中运行
   *  - 如果函数同步执行时 SDK 客户端 还没有被初始化，那么立即尝试访问客户端相关的功能（如事件订阅）将会失败或返回 undefined
   *
   * 2. 延迟执行的必要性：
   *  - 我们需要等待 SDK 客户端完全创建和初始化之后，再去注册事件监听器
   *  - 使用 setTimeout 将事件监听的逻辑推迟到下一次 事件循环。这样可以确保在客户端完成初始化后，才去订阅相关的事件
   */
  setTimeout(() => {
    // 获取 SDK 客户端实例
    const client = getClient();

    // 监听 startNavigationSpan 事件
    const unsubscribeStartNavigation = client?.on('startNavigationSpan', () => {
      // 一旦软导航发生，调用 _collectClsOnce() 函数停止 CLS 数据收集，并发送收集到的 CLS 值
      _collectClsOnce();

      // 取消导航事件的监听
      unsubscribeStartNavigation && unsubscribeStartNavigation();
    });

    // 获取当前活跃的 span
    const activeSpan = getActiveSpan();
    // 获取当前活跃的 span 的 根span
    const rootSpan = activeSpan && getRootSpan(activeSpan);
    // 将根 span JSON化
    const spanJSON = rootSpan && spanToJSON(rootSpan);
    // 检查根 span 的操作类型是否为 pageload(页面加载)
    if (spanJSON && spanJSON.op === 'pageload') {
      // 如果是，说明这是一次新的页面加载操作，CLS 数据应该与此关联
      // 保存该根跨度的 spanId，用于后续发送 CLS 数据时的标识。
      pageloadSpanId = rootSpan.spanContext().spanId;
    }
  }, 0);
}

/**
 * 函数的作用是创建并发送一个独立的 CLS（Cumulative Layout Shift，累积布局偏移）性能监控数据，
 * 包含了页面元素布局变化的详细信息，并将其与页面加载过程关联。
 * @param clsValue
 * @param entry
 * @param pageloadSpanId
 */
function sendStandaloneClsSpan(
  clsValue: number,
  entry: LayoutShift | undefined,
  pageloadSpanId: string,
) {
  DEBUG_BUILD && logger.log(`Sending CLS span (${clsValue})`);

  // 计算 cls 的起始时间(秒)
  const startTime =
    msToSec(browserPerformanceTimeOrigin as number) + (entry?.startTime || 0);

  // 布局偏移事件的持续时间(秒)
  const duration = msToSec(entry?.duration || 0);

  // 获取当前作用域的数据,从中提取 事务名称（页面路由名称），用来标识当前页面在哪个路由下发生的 CLS 事件
  const routeName = getCurrentScope().getScopeData().transactionName;

  // 如果存在 entry 将其与第一个源节点关联,转化为 html 字符串表示
  const name = entry
    ? htmlTreeAsString(entry.sources[0]?.node)
    : 'Layout shift';

  // 构建 cls 事件相关的元数据
  const attributes: SpanAttributes = dropUndefinedKeys({
    [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.http.browser.cls',
    [SEMANTIC_ATTRIBUTE_SENTRY_OP]: 'ui.webvital.cls',
    [SEMANTIC_ATTRIBUTE_EXCLUSIVE_TIME]: entry?.duration || 0,
    // 页面加载过程中生成的 spanId，用于关联 CLS 事件和页面加载过程
    'sentry.pageload.span_id': pageloadSpanId,
  });

  // 创建一个独立的 Web Vital 监控 span
  const span = startStandaloneWebVitalSpan({
    name, //  CLS 事件的名称
    transaction: routeName, // 事务名
    attributes, // 属性
    startTime, // 起始时间
  });

  // 添加一个名为 cls 的事件
  span?.addEvent('cls', {
    [SEMANTIC_ATTRIBUTE_SENTRY_MEASUREMENT_UNIT]: '',
    [SEMANTIC_ATTRIBUTE_SENTRY_MEASUREMENT_VALUE]: clsValue,
  });

  // 标记 span 的结束时间
  span?.end(startTime + duration);
}

/**
 * 是否支持 layout-shift 事件
 * @returns
 */
function supportsLayoutShift(): boolean {
  try {
    return PerformanceObserver.supportedEntryTypes?.includes('layout-shift');
  } catch {
    return false;
  }
}
