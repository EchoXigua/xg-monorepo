import { getFunctionName, logger } from '@xigua-monitor/utils';

import { DEBUG_BUILD } from '../debug-build';
import { observe } from './web-vitals/lib/observe';
import { onCLS } from './web-vitals/getCLS';
import { onLCP } from './web-vitals/getLCP';

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

/**
 * 这个接口定义了 Web Vitals 指标的结构
 * 如：CLS（Cumulative Layout Shift）、FID（First Input Delay）、LCP（Largest Contentful Paint）等
 */
interface Metric {
  /**
   * 指标的名称，使用缩写形式。表示不同的性能指标
   *
   * @example
   * CLS: Cumulative Layout Shift，累计布局偏移
   * FCP: First Contentful Paint，首次内容绘制
   * FID: First Input Delay，首次输入延迟
   * INP: Interaction to Next Paint，交互到下一次绘制
   * LCP: Largest Contentful Paint，最大内容绘制
   * TTFB: Time to First Byte，从请求到接收第一个字节的时间
   */
  name: 'CLS' | 'FCP' | 'FID' | 'INP' | 'LCP' | 'TTFB';

  /**
   * 指标的当前数值，表示对应性能指标的度量值
   * 例如 CLS 值、FID 延迟时间等
   */
  value: number;

  /**
   * 指标数值的评级，用于评估页面的用户体验
   *
   * good（表现良好），needs-improvement（需要改进），poor（表现较差）
   */
  rating: 'good' | 'needs-improvement' | 'poor';

  /**
   * 该指标相对于上次报告时的变化量，首次报告时，delta 等于 value
   * 在某些性能指标如 CLS 中，这个 delta 表示最新的变化。
   */
  delta: number;

  /**
   * 唯一标识符，用来区分此指标实例
   *
   * 可以用于去重（例如，避免同一指标重复发送），或者用于将多个变化量（delta）进行分组计算总值
   * 当页面从缓存恢复时，新的指标对象会被创建，这个 id 可以用于识别不同的实例
   */
  id: string;

  /**
   * 与该指标值计算相关的性能条目
   *
   * 该指标是基于某些性能条目计算得出的，条目会存储在这个数组中。
   * 如果没有相关条目（例如，CLS 值为 0 且没有布局偏移），该数组可能为空。
   */
  entries: PerformanceEntry[];

  /**
   * 页面导航的类型
   *
   * 这个属性基于 Navigation Timing API 获取，提供了与网页导航相关的性能信息，帮助开发者分析页面的加载性能
   *
   *  - 如果浏览器不支持该 API，则 navigationType 的值会是 undefined
   *
   *  - 当页面从 bfcache 恢复时，navigationType 的值会设置为 'back-forward-cache'，
   *  以表明这是一次从缓存中恢复的导航。这有助于开发者区别这种导航与正常的页面加载或重新加载
   *  - bfcache: 指的是 Back/Forward Cache，浏览器用于缓存完整的页面状态，
   *  以便用户使用浏览器的 "前进" 或 "后退" 按钮时能够快速恢复页面
   *
   * navigate: 通过正常导航（如点击链接）进入
   * reload: 页面是通过刷新加载的
   * back-forward: 页面通过浏览器的前进或后退按钮加载
   * back-forward-cache: 页面是从后退/前进缓存中恢复的
   * prerender: 页面是预渲染的
   * restore: 恢复页面状态
   */
  navigationType:
    | 'navigate'
    | 'reload'
    | 'back-forward'
    | 'back-forward-cache'
    | 'prerender'
    | 'restore';
}

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

/**
 * 用于存储最近一次 Cumulative Layout Shift (CLS) 指标的值
 * CLS 衡量的是网页内容的视觉稳定性，主要关注布局移动带来的用户体验问题。
 */
let _previousCls: Metric | undefined;
/**
 * 用于存储最近一次 First Input Delay (FID) 指标的值
 * FID 衡量的是用户第一次与页面交互（例如点击按钮、输入等）与浏览器响应之间的延迟时间。
 */
let _previousFid: Metric | undefined;
/**
 * 用于存储最近一次 Largest Contentful Paint (LCP) 指标的值。
 * LCP 测量的是页面主要内容的加载时间，通常用于衡量页面的感知加载速度。
 */
let _previousLcp: Metric | undefined;
/**
 * 用于存储最近一次 Time to First Byte (TTFB) 指标的值。
 * TTFB 测量的是从用户请求到浏览器接收到第一个字节响应所用的时间，通常用于衡量网络响应速度。
 */
let _previousTtfb: Metric | undefined;
/**
 * 用于存储最近一次 Interaction to Next Paint (INP) 指标的值。
 * INP 是衡量用户交互的延迟情况，比如点击或输入时与页面渲染之间的延迟，提供更全面的交互延迟指标
 */
let _previousInp: Metric | undefined;

/**
 * 这个函数主要作用是监听 CLS（Cumulative Layout Shift） 指标，并在 CLS 数据可用时触发回调函数
 *
 * 函数会返回一个清理回调，这个回调函数可以用于移除当前的 CLS 监听器（或处理器）。
 * 当不再需要监听 CLS 指标时，可以调用这个清理回调函数来停止监听。
 *
 * 如果在调用该函数时传入 stopOnCallback = true，则在回调函数触发后，CLS 监听会自动停止。
 * 这意味着 CLS 监听器在第一次获取到指标后就不再继续监听。
 * 此时 CLS 指标会被固定下来，不再更新。这个过程称为 "CLS being finalized and frozen"，即固定并冻结了当前的 CLS 值
 * 导致CLS最终确定并冻结
 *
 *
 * @param callback 回调函数
 * @param stopOnCallback 是否在回调函数执行后停止监听 CLS
 * @returns 返回一个清理回调函数
 */
export function addClsInstrumentationHandler(
  callback: (data: { metric: Metric }) => void,
  stopOnCallback = false,
): CleanupHandlerCallback {
  // 添加对 CLS 指标的观察
  return addMetricObserver(
    'cls', // 指定要观察的性能指标是 CLS
    callback, // 当 CLS 数据可用时，执行这个回调函数
    instrumentCls, // 一个负责启动 CLS 监听的函数
    _previousCls, // 这个保存了之前 CLS 的状态，用来对比和更新
    stopOnCallback, // 如果为 true，则当回调触发后停止监听
  );
}

/**
 * 添加一个回调，当LCP度量可用时将触发该回调
 * LCP 是衡量页面加载性能的重要指标，表示视口中最大的可见内容元素的渲染时间
 * 返回一个清理回调，允许停止监听
 *
 * 如果参数 stopOnCallback 设置为 true，在清理回调被调用时，将停止对 LCP（Largest Contentful Paint） 指标的监听
 * 会导致当前的 LCP 值被“最终确定”和“冻结”，也就是说之后不会再更新或改变该值
 */
export function addLcpInstrumentationHandler(
  callback: (data: { metric: Metric }) => void,
  stopOnCallback = false,
): CleanupHandlerCallback {
  return addMetricObserver(
    'lcp',
    callback,
    instrumentLcp,
    _previousLcp,
    stopOnCallback,
  );
}

/**
 * 这个函数实现了 FID（First Input Delay） 指标的监控和回调机制
 * 当 FID 数据可用时，注册的回调函数将被调用。同时，返回一个清理函数，允许用户在不需要时移除监听器
 */
export function addFidInstrumentationHandler(
  callback: (data: { metric: Metric }) => void,
): CleanupHandlerCallback {
  return addMetricObserver('fid', callback, instrumentFid, _previousFid);
}

/**
 * Add a callback that will be triggered when a FID metric is available.
 */
export function addTtfbInstrumentationHandler(
  callback: (data: { metric: Metric }) => void,
): CleanupHandlerCallback {
  return addMetricObserver('ttfb', callback, instrumentTtfb, _previousTtfb);
}

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

/**
 * 这个函数的主要作用是为某种性能指标添加观察器，并在指标更新时执行回调
 * 它还提供了一个清理机制，可以在不需要观察该指标时移除处理器
 *
 * @param type 要观察的性能指标类型（比如 'cls' 或 'lcp' 等）
 * @param callback 当指标数据可用时，执行的回调函数
 * @param instrumentFn 启动监听该指标的函数，返回一个停止监听的函数
 * @param previousValue 如果有之前的指标数据，会立即调用回调并传递该数据
 * @param stopOnCallback 表示是否在回调执行后停止监听 默认false
 * @returns 返回一个清理回调函数，用于停止监听该指标
 */
function addMetricObserver(
  type: InstrumentHandlerTypeMetric,
  callback: InstrumentHandlerCallback,
  instrumentFn: () => StopListening,
  previousValue: Metric | undefined,
  stopOnCallback = false,
): CleanupHandlerCallback {
  // 为指定的类型 注册处理函数
  addHandler(type, callback);

  // 存储监听停止的函数
  let stopListening: StopListening | undefined;

  // 检查是否已经为该类型的指标添加了监听器
  if (!instrumented[type]) {
    // 如果还没有监听器，调用 instrumentFn() 来开始监听，并将返回的停止监听函数赋值给 stopListening
    stopListening = instrumentFn();
    // 标记该类型的指标已经被监听，避免重复添加监听
    instrumented[type] = true;
  }

  // 如果有之前保存的 previousValue，立即调用回调函数 callback 并传递之前的指标数据
  // 这种情况下，即使是之前发生的事件，也能让回调函数立即处理
  if (previousValue) {
    callback({ metric: previousValue });
  }

  // 获取清理函数。这个清理函数可以在不需要观察该指标时调用，用于移除处理器。
  return getCleanupCallback(
    type,
    callback,
    stopOnCallback ? stopListening : undefined,
  );
}

/**
 * 这个函数的作用是启动对 Cumulative Layout Shift (CLS) 指标的监听，并在 CLS 值更新时触发回调处理器
 * 使用了 onCLS 函数来监听 CLS 的变化，并将 CLS 的最新指标传递给处理器函数，还提供了清理机制，用于停止监听
 * @returns
 */
function instrumentCls(): StopListening {
  // 这里才是真正的 cls 监听处理
  return onCLS(
    (metric) => {
      // 触发 cls 事件，所有注册过 cls 相关的处理函数，都会被执行
      triggerHandlers('cls', {
        metric,
      });
      // 将当前的 CLS 指标对象 metric 存储在全局变量 _previousCls 中，以便后续使用
      _previousCls = metric;
    },
    // 第二个参数是传递给 onCLS 的配置项，默认情况下，CLS 的更新只会在浏览器标签页进入后台时触发回调
    // 通过设置 reportAllChanges: true，我们强制回调函数在每次 CLS 值变化时都被调用，而不只是标签页切换到后台时
    // 这确保了每当页面布局发生变化导致 CLS 更新时，我们的回调都会及时执行，而不是延迟到页面不再活动。
    { reportAllChanges: true },
  );
}

/**
 * 负责真正的 LCP 监控逻辑，使用 onLCP 来监听 LCP 数据的变化，
 * 并在每次 LCP 值更新时触发回调，传递最新的 metric 数据
 * @returns
 */
function instrumentLcp(): StopListening {
  return onLCP(
    (metric) => {
      triggerHandlers('lcp', {
        metric,
      });
      _previousLcp = metric;
    },
    // 我们希望每次 LCP 值更新时都调用回调函数。默认情况下，回调只在选项卡进入后台时调用
    { reportAllChanges: true },
  );
}

/**
 * 负责真正的 FID 监控逻辑，使用 onFID 进行指标监听，
 * 并在指标产生时，调用回调函数 triggerHandlers 触发相关事件
 *
 * @returns
 */
function instrumentFid(): void {
  return onFID((metric) => {
    triggerHandlers('fid', {
      metric,
    });
    _previousFid = metric;
  });
}

function instrumentTtfb(): StopListening {
  return onTTFB((metric) => {
    triggerHandlers('ttfb', {
      metric,
    });
    _previousTtfb = metric;
  });
}
