import { getFunctionName, logger } from '@xigua-monitor/utils';

import { DEBUG_BUILD } from '../debug-build';
import { observe } from './web-vitals/lib/observe';

/**
 * 定义了与浏览器性能相关的事件类型
 *
 * longtask  记录浏览器主线程中执行时间较长的任务
 * event  用于记录与用户交互事件（如点击、键盘输入等）相关的性能指标,了解用户触发的事件如何影响页面的响应时间
 * navigation 记录页面的导航事件
 * paint     录页面绘制相关的性能指标（如首次内容绘制）
 * resource   记录资源加载性能（如图片、脚本等）
 * first-input  记录用户首次输入的延迟（首次输入延迟FID）
 */
type InstrumentHandlerTypePerformanceObserver =
  | 'longtask'
  | 'event'
  | 'navigation'
  | 'paint'
  | 'resource'
  | 'first-input';

/**
 * 定义了与性能度量相关的事件类型
 *
 * cls (Cumulative Layout Shift)：页面布局的累积变化，用于衡量视觉稳定性。
 * lcp (Largest Contentful Paint)：最大内容绘制时间，用于衡量页面加载性能。
 * fid (First Input Delay)：首次输入延迟，衡量用户交互的响应速度。
 * ttfb (Time to First Byte)：接收到首字节数据的时间。
 * inp (Interaction to Next Paint)：交互后的下次页面绘制时间。
 */
type InstrumentHandlerTypeMetric = 'cls' | 'lcp' | 'fid' | 'ttfb' | 'inp';

/** 清理函数类型 */
type CleanupHandlerCallback = () => void;

/** 监控函数的类型 */
type InstrumentHandlerCallback = (data: any) => void;

type StopListening = undefined | void | (() => void);

/** 表示可以处理的所有类型事件。 */
type InstrumentHandlerType =
  | InstrumentHandlerTypeMetric
  | InstrumentHandlerTypePerformanceObserver;

/** 存储事件处理程序的字典 */
const handlers: {
  [key in InstrumentHandlerType]?: InstrumentHandlerCallback[];
} = {};
/** 用于记录某个事件类型是否已经被监听，避免重复监听 */
const instrumented: { [key in InstrumentHandlerType]?: boolean } = {};

export function addPerformanceInstrumentationHandler(
  type: 'event',
  callback: (data: {
    entries: (
      | (PerformanceEntry & { target?: unknown | null })
      | PerformanceEventTiming
    )[];
  }) => void,
): CleanupHandlerCallback;
export function addPerformanceInstrumentationHandler(
  type: InstrumentHandlerTypePerformanceObserver,
  callback: (data: { entries: PerformanceEntry[] }) => void,
): CleanupHandlerCallback;

/**
 * 添加一个回调函数，当性能观察器触发时回调会被执行，并且接收到性能条目（PerformanceEntry）数组
 * 返回一个清理函数，用于移除对应的性能监听
 *
 * 该函数定义了两种不同的重载签名，以支持多种性能类型处理
 * 第一个签名用于 event 类型，第二个签名用于常规的性能观察类型
 *
 * 使用场景：
 * 适用于对浏览器中性能事件（如网络资源加载、事件持续时间等）进行自动化监控。
 * 当某类性能事件（如 resource 加载或 event 事件）触发时，收集数据并将其传递到监控系统中，用于后续分析或展示
 * 例如在 event 类型监控中，它可以追踪页面上的用户交互事件（点击、输入等）的性能表现，
 * 并在事件持续时间超过某个阈值时进行告警或优化建议。
 */
export function addPerformanceInstrumentationHandler(
  type: InstrumentHandlerTypePerformanceObserver,
  callback: (data: { entries: PerformanceEntry[] }) => void,
): CleanupHandlerCallback {
  // 订阅事件
  addHandler(type, callback);

  // 检查是否已经对该类型的性能事件进行了监控，避免重复初始化
  if (!instrumented[type]) {
    // 对该类型进行监控
    instrumentPerformanceObserver(type);
    // 标记该类型已被监控
    instrumented[type] = true;
  }

  // 返回一个清理回调函数
  return getCleanupCallback(type, callback);
}

/**
 * 这个函数用于创建并启动 PerformanceObserver，观察指定类型的性能数据。
 * @param type
 */
function instrumentPerformanceObserver(
  type: InstrumentHandlerTypePerformanceObserver,
): void {
  const options: PerformanceObserverInit = {};

  // 'event' 类型设置 durationThreshold = 0，确保每个 event 事件都能被捕获
  if (type === 'event') {
    options.durationThreshold = 0;
  }

  // 实际创建并启动 PerformanceObserver 的函数。
  observe(
    type,
    (entries) => {
      // 触发事件，传入对应的性能条目
      triggerHandlers(type, { entries });
    },
    options,
  );
}

/** 触发指定类型的所有事件处理程序 */
function triggerHandlers(type: InstrumentHandlerType, data: unknown): void {
  // 获取对应的处理函数
  const typeHandlers = handlers[type];

  // 对应类型的处理函数不存在或者为空，直接返回
  if (!typeHandlers || !typeHandlers.length) {
    return;
  }

  // 依次调用所有的处理函数，传入data
  for (const handler of typeHandlers) {
    try {
      handler(data);
    } catch (e) {
      // 在 DEBUG 模式下，捕获并记录处理程序执行时的异常信息，以便调试
      DEBUG_BUILD &&
        logger.error(
          `Error while triggering instrumentation handler.\nType: ${type}\nName: ${getFunctionName(handler)}\nError:`,
          e,
        );
    }
  }
}

/** 为某一类型的事件添加处理程序 */
function addHandler(
  type: InstrumentHandlerType,
  handler: InstrumentHandlerCallback,
): void {
  handlers[type] = handlers[type] || [];
  (handlers[type] as InstrumentHandlerCallback[]).push(handler);
}

/**
 * 返回一个清理回调，用于移除特定的事件处理程序，当需要移除处理程序时，调用这个清理函数
 * @param type
 * @param callback
 * @param stopListening
 * @returns
 */
function getCleanupCallback(
  type: InstrumentHandlerType,
  callback: InstrumentHandlerCallback,
  stopListening: StopListening,
): CleanupHandlerCallback {
  return () => {
    // 停止监听器（如果存在）
    if (stopListening) {
      stopListening();
    }

    // 获取对应类型的处理函数
    const typeHandlers = handlers[type];

    // 不存在直接返回
    if (!typeHandlers) {
      return;
    }

    // 存在的话，删除对应的处理函数
    const index = typeHandlers.indexOf(callback);
    if (index !== -1) {
      typeHandlers.splice(index, 1);
    }
  };
}
