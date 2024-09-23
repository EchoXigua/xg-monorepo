import type {
  Measurements,
  Span,
  SpanAttributes,
  StartSpanOptions,
} from '@xigua-monitor/types';
import {
  SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN,
  getActiveSpan,
  startInactiveSpan,
  setMeasurement,
  spanToJSON,
} from '@xigua-monitor/core';

import {
  browserPerformanceTimeOrigin,
  getComponentName,
  htmlTreeAsString,
  logger,
  parseUrl,
} from '@xigua-monitor/utils';

import {
  getBrowserPerformanceAPI,
  isMeasurementValue,
  msToSec,
  startAndEndSpan,
} from './utils';

import {
  type PerformanceLongAnimationFrameTiming,
  addClsInstrumentationHandler,
  addFidInstrumentationHandler,
  addLcpInstrumentationHandler,
  addPerformanceInstrumentationHandler,
  addTtfbInstrumentationHandler,
} from './instrument';
import { trackClsAsStandaloneSpan } from './cls';

import { WINDOW } from '../types';
import { DEBUG_BUILD } from '../debug-build';
import { getNavigationEntry } from './web-vitals/lib/getNavigationEntry';
import { getVisibilityWatcher } from './web-vitals/lib/getVisibilityWatcher';

// https://w3c.github.io/device-memory/#sec-device-memory-js-api
/** 用于表示设备的内存信息（以 GB 为单位） */
interface NavigatorDeviceMemory {
  readonly deviceMemory?: number;
}

/** 表示最大整数值，通常用于限制字节数的计算，特别是在处理性能数据时，避免超出可用的最大值 */
const MAX_INT_AS_BYTES = 2147483647;

/** 用于跟踪当前的性能测量位置，可能在后续的性能数据处理中用于索引或标记 */
let _performanceCursor: number = 0;

/**
 * 用于存储测量结果，可以包含多个性能指标的相关数据
 */
let _measurements: Measurements = {};
let _lcpEntry: LargestContentfulPaint | undefined;
let _clsEntry: LayoutShift | undefined;

interface StartTrackingWebVitalsOptions {
  recordClsStandaloneSpans: boolean;
}

/**
 * 该函数用于开始追踪 Web Vitals（Web 性能指标），
 * 包括诸如首次输入延迟（FID）、最大内容绘制（LCP）、首次字节到达（TTFB）和累积布局偏移（CLS）等指标。
 *
 * 返回的回调函数可以用于停止监控并确保所有测量结果最终被捕获
 *
 * @returns 函数返回一个无参数、无返回值的函数
 */
export function startTrackingWebVitals({
  recordClsStandaloneSpans,
}: StartTrackingWebVitalsOptions): () => void {
  // 获取浏览器的性能 API。
  const performance = getBrowserPerformanceAPI();

  // 检查性能 API 是否存在
  if (performance && browserPerformanceTimeOrigin) {
    // @ts-expect-error we want to make sure all of these are available, even if TS is sure they are
    // 在性能 API 中标记一个初始化点，方便后续性能分析
    if (performance.mark) {
      WINDOW.performance.mark('sentry-tracing-init');
    }

    // 启动对首次输入延迟（FID）的监控，并返回清理函数
    const fidCleanupCallback = _trackFID();
    // 启动对最大内容绘制（LCP）的监控，并返回清理函数
    const lcpCleanupCallback = _trackLCP();
    // 启动对首次字节到达（TTFB）的监控，并返回清理函数
    const ttfbCleanupCallback = _trackTtfb();

    // 根据 recordClsStandaloneSpans 决定是否以独立 span 记录 CLS
    const clsCleanupCallback = recordClsStandaloneSpans
      ? trackClsAsStandaloneSpan()
      : _trackCLS();

    // 这个返回函数用于执行之前启动监控时返回的清理回调，确保停止监控并处理相关的测量数据
    return (): void => {
      fidCleanupCallback();
      lcpCleanupCallback();
      ttfbCleanupCallback();
      clsCleanupCallback && clsCleanupCallback();
    };
  }

  return () => undefined;
}

/**
 * 监控浏览器主线程上的长任务，帮助开发者识别可能导致 UI 卡顿的代码
 * 通过跟踪长任务，开发者可以更好地理解应用程序性能，并作出相应的优化
 */
export function startTrackingLongTasks(): void {
  // 监听 longtask 类型的性能事件
  addPerformanceInstrumentationHandler('longtask', ({ entries }) => {
    // 确保存在活跃的 span
    if (!getActiveSpan()) {
      return;
    }

    for (const entry of entries) {
      // 计算时间
      const startTime = msToSec(
        (browserPerformanceTimeOrigin as number) + entry.startTime,
      );
      const duration = msToSec(entry.duration);

      // 创建一个不活跃的 span
      const span = startInactiveSpan({
        name: 'Main UI thread blocked',
        op: 'ui.long-task',
        startTime,
        attributes: {
          [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.ui.browser.metrics',
        },
      });
      if (span) {
        // 如果成功创建了就结束它
        span.end(startTime + duration);
      }
    }
  });
}

/**
 * 监控浏览器主线程上的长动画帧，帮助开发者识别可能导致动画卡顿的代码
 */
export function startTrackingLongAnimationFrames(): void {
  /**
   * 当前使用的 web-vitals 版本不支持 long-animation-frame，因此直接观察 long-animation-frame 事件
   */
  const observer = new PerformanceObserver((list) => {
    // 确保存在活跃的 span
    if (!getActiveSpan()) {
      return;
    }

    for (const entry of list.getEntries() as PerformanceLongAnimationFrameTiming[]) {
      // 如果没有脚本信息，则跳过该条目。entry.scripts 数组的第一个元素用于获取动画帧的执行上下文
      if (!entry.scripts[0]) {
        continue;
      }

      // 计算时间
      const startTime = msToSec(
        (browserPerformanceTimeOrigin as number) + entry.startTime,
      );
      const duration = msToSec(entry.duration);

      // 构建属性
      const attributes: SpanAttributes = {
        [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.ui.browser.metrics',
      };

      // 获取脚本信息
      const initialScript = entry.scripts[0];
      // 从脚本信息提取信息
      const {
        invoker, // 调用者的名称
        invokerType, // 调用者的类型
        sourceURL, //  脚本的源 URL
        sourceFunctionName, // 源函数的名称
        sourceCharPosition, // 源代码中的字符位置
      } = initialScript;

      // 将提取到的信息添加到 attributes 对象中
      attributes['browser.script.invoker'] = invoker;
      attributes['browser.script.invoker_type'] = invokerType;
      if (sourceURL) {
        attributes['code.filepath'] = sourceURL;
      }
      if (sourceFunctionName) {
        attributes['code.function'] = sourceFunctionName;
      }
      if (sourceCharPosition !== -1) {
        attributes['browser.script.source_char_position'] = sourceCharPosition;
      }

      // 创建一个不活跃的 span
      const span = startInactiveSpan({
        name: 'Main UI thread blocked',
        op: 'ui.long-animation-frame',
        startTime,
        attributes,
      });
      if (span) {
        // 成功创建后结束它 记录动画帧的完成时间
        span.end(startTime + duration);
      }
    }
  });

  // 开始观察  long-animation-frame 类型的事件
  // buffered: true 以便接收缓冲的条目
  observer.observe({ type: 'long-animation-frame', buffered: true });
}

/**
 * 用于跟踪用户交互事件，特别是点击事件
 */
export function startTrackingInteractions(): void {
  // 监听 event 类型的性能条目
  addPerformanceInstrumentationHandler('event', ({ entries }) => {
    // 确保有活跃的 Span
    if (!getActiveSpan()) {
      return;
    }

    for (const entry of entries) {
      // 处理点击事件
      if (entry.name === 'click') {
        // 计算时间
        const startTime = msToSec(
          (browserPerformanceTimeOrigin as number) + entry.startTime,
        );
        const duration = msToSec(entry.duration);

        // 创建一个 span 配置对象
        const spanOptions: StartSpanOptions &
          Required<Pick<StartSpanOptions, 'attributes'>> = {
          name: htmlTreeAsString(entry.target),
          op: `ui.interaction.${entry.name}`,
          startTime: startTime,
          attributes: {
            [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.ui.browser.metrics',
          },
        };

        // 数获取事件目标的组件名称
        const componentName = getComponentName(entry.target);
        if (componentName) {
          // 如果存在，将其添加到属性中
          spanOptions.attributes['ui.component_name'] = componentName;
        }

        // 创建一个 不活跃的 span，传入配置对象
        const span = startInactiveSpan(spanOptions);
        if (span) {
          // 如果成功创建 Span，则调用 span.end 方法结束该 Span
          span.end(startTime + duration);
        }
      }
    }
  });
}

export { startTrackingINP, registerInpInteractionListener } from './inp';

interface AddPerformanceEntriesOptions {
  /**
   * Flag to determine if CLS should be recorded as a measurement on the span or
   * sent as a standalone span instead.
   */
  recordClsOnPageloadSpan: boolean;
}

/**
 * 在事务中添加性能相关的跨度
 *
 * 通过浏览器的 Performance API 获取性能指标，
 * 并将相关的性能信息转化为 Sentry 的性能跟踪 span，从而为性能监控提供数据支持
 *
 * @param span 当前的性能跟踪 span，这是一个表示事务或操作的对象
 * @param options :包含一些控制是否记录某些性能指标的配置
 * @returns
 */
export function addPerformanceEntries(
  span: Span,
  options: AddPerformanceEntriesOptions,
): void {
  // 获取性能 api
  const performance = getBrowserPerformanceAPI();
  // 如果不支持 性能 api 直接返回
  if (
    !performance ||
    !WINDOW.performance.getEntries ||
    !browserPerformanceTimeOrigin
  ) {
    // Gatekeeper if performance API not available
    return;
  }

  DEBUG_BUILD &&
    logger.log('[Tracing] Adding & adjusting spans using Performance API');

  // 获取性能时间原点，将其转为秒
  const timeOrigin = msToSec(browserPerformanceTimeOrigin);

  // 获取浏览器的所有性能条目
  const performanceEntries = performance.getEntries();

  // 将 span JSON化，提取 操作类型 和 开始时间
  const { op, start_timestamp: transactionStartTime } = spanToJSON(span);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  // 根据每个条目的类型（navigation、mark、paint、measure、resource 等）
  // 处理相应的性能数据，并生成相应的 Sentry 性能跟踪 span。
  performanceEntries
    // 只获取那些还没有被处理的性能条目
    // _performanceCursor 是一个指针，用于标记已经处理过的性能条目的位置，避免重复处理。
    .slice(_performanceCursor)
    // 遍历获取的性能条目
    .forEach((entry: Record<string, any>) => {
      // 获取每个性能条目的开始时间，将其转为秒
      const startTime = msToSec(entry.startTime);
      // 计算持续时间，如果持续时间为负值，这里为修正为 0
      // Chrome 有时会产生负持续时间，这是一个已知问题，为了避免因此丢失事务数据，做了这样的处理。
      const duration = msToSec(
        /**
         * 在某些情况下，Chrome 浏览器 的 Performance API 可能会返回负数的持续时间（duration），
         * 不清楚具体原因是什么，但这种情况确实偶尔会发生。
         * 在 StackOverflow 中有一篇帖子讨论了这个问题
         * https://stackoverflow.com/questions/23191918/peformance-getentries-and-negative-duration-display
         *
         * 为了避免负持续时间导致的一些问题（例如 Sentry 事务被丢弃），开发者在这段代码中对 duration 进行了修正处理（即将负值修正为 0）
         * 这种处理方法不是最准确的解决方案，但可以暂时解决由于负持续时间而导致事务丢失的问题。
         * 某些需要较长时间加载的内容（例如 Replay Worker）会有负持续时间
         *
         * sentry 开发团队将来需要进一步调查为何 Chrome 会返回负的持续时间，以及寻找更恰当的方式来处理这些负值。
         * 目前的方案只是一种防止事务因负持续时间而被丢弃的解决方案。
         */
        Math.max(0, entry.duration),
      );

      // 如果当前事务类型是 navigation 且事务的 startTime 大于当前性能条目的开始时间，则跳过该条目
      // 这意味着如果条目的时间早于导航事务的开始时间，它不应该被记录为该事务的部分
      if (
        op === 'navigation' &&
        transactionStartTime &&
        timeOrigin + startTime < transactionStartTime
      ) {
        return;
      }

      // 根据性能条目的类型进行不同的处理
      switch (entry.entryType) {
        case 'navigation': {
          // 页面加载或导航的性能条目

          // 创建相应导航 span
          _addNavigationSpans(span, entry, timeOrigin);
          break;
        }
        case 'mark':
        case 'paint':
        case 'measure': {
          // 页面的标记、绘制或测量点

          // 创建相应的 span，同时会记录一些关键的 Web Vitals 数据（如 FP、FCP 等）
          _addMeasureSpans(span, entry, startTime, duration, timeOrigin);

          // 这里的代码主要作用是捕获和记录网页加载过程中关键的 Web Vitals 指标
          // 具体为 FP（First Paint，首次绘制） 和 FCP（First Contentful Paint，首次内容绘制）

          // 页面可见性状态(firstHiddenTime 页面第一次被隐藏的时间点)
          const firstHidden = getVisibilityWatcher();
          // 只有在页面没有被隐藏的情况下才会报告 Web Vitals,因为页面被隐藏后，绘制操作对用户已经没有意义
          const shouldRecord = entry.startTime < firstHidden.firstHiddenTime;

          // 捕获FP
          if (entry.name === 'first-paint' && shouldRecord) {
            DEBUG_BUILD && logger.log('[Measurements] Adding FP');
            _measurements['fp'] = {
              value: entry.startTime,
              unit: 'millisecond',
            };
          }
          // 捕获FCP
          if (entry.name === 'first-contentful-paint' && shouldRecord) {
            DEBUG_BUILD && logger.log('[Measurements] Adding FCP');
            _measurements['fcp'] = {
              value: entry.startTime,
              unit: 'millisecond',
            };
          }
          break;
        }
        case 'resource': {
          // 资源加载的条目

          // 创建与资源加载相关的 span
          _addResourceSpans(
            span,
            entry,
            entry.name as string,
            startTime,
            duration,
            timeOrigin,
          );
          break;
        }
        default:
        // 忽略其他不需要处理的条目类型
        // Ignore other entry types.
      }
    });

  // 更新指针
  _performanceCursor = Math.max(performanceEntries.length - 1, 0);

  _trackNavigator(span);

  // 只有在页面加载时，才会进行性能测量指标的记录与处理。
  if (op === 'pageload') {
    // 添加 TTFB（Time to First Byte，首字节到达时间）,TTFB 是衡量服务器响应速度的重要指标
    _addTtfbRequestTimeToMeasurements(_measurements);

    // 对这三个指标进行处理
    ['fcp', 'fp', 'lcp'].forEach((name) => {
      const measurement = _measurements[name];
      // 当前测量值不存在 或者 事务的开始时间也不存在 或者 事务的开始时间早于 时间原点 直接返回 不处理
      if (
        !measurement ||
        !transactionStartTime ||
        timeOrigin >= transactionStartTime
      ) {
        return;
      }
      /**
       * 这些 web vitals（FCP、FP、LCP 和 TTFB）都是相对于 timeOrigin 进行测量的，
       * 但 timeOrigin 并未在 span 数据中捕获，因此需要将这些值调整为相对于 span.startTimestamp
       */
      const oldValue = measurement.value;
      const measurementTimestamp = timeOrigin + msToSec(oldValue);

      // 计算标准化值
      const normalizedValue = Math.abs(
        (measurementTimestamp - transactionStartTime) * 1000,
      );

      // 计算标准化值与旧值之间的差异
      const delta = normalizedValue - oldValue;

      DEBUG_BUILD &&
        logger.log(
          `[Measurements] Normalized ${name} from ${oldValue} to ${normalizedValue} (${delta})`,
        );

      // 更新测量的值为标准化后的值
      measurement.value = normalizedValue;
    });

    // 获取 mark.fid 的测量值并检查 fid 是否存在
    const fidMark = _measurements['mark.fid'];
    if (fidMark && _measurements['fid']) {
      // 创建 FID span
      startAndEndSpan(
        span,
        fidMark.value,
        fidMark.value + msToSec(_measurements['fid'].value),
        {
          name: 'first input delay',
          op: 'ui.action',
          attributes: {
            [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.ui.browser.metrics',
          },
        },
      );

      // 删除 mark.fid，因为它不需要包含在最终的负载中
      delete _measurements['mark.fid'];
    }

    /**
     * 如果 FCP 没有被记录，按照新的 CLS 定义不应该记录 CLS 值
     * TODO，表示未来可能需要检查这个条件是否依然必要
     */
    if (!('fcp' in _measurements) || !options.recordClsOnPageloadSpan) {
      delete _measurements.cls;
    }

    // 遍历所有测量值,将测量名称、值和单位设置到适当的位置
    Object.entries(_measurements).forEach(([measurementName, measurement]) => {
      setMeasurement(measurementName, measurement.value, measurement.unit);
    });

    // 为当前的 span 标记度量信息
    _tagMetricInfo(span);
  }

  // 重置数据
  _lcpEntry = undefined;
  _clsEntry = undefined;
  _measurements = {};
}

/**
 * 根据浏览器性能 API 的 measure 类型条目，创建与页面加载性能相关的 span（即追踪片段）
 * 还会调整 span 的时间戳以确保它们是合理的，并处理一些特殊情况，例如 measure 的时间戳在页面请求之前的情况
 *
 * @param span 当前追踪事务的根 span
 * @param entry 传入的性能条目
 * @param startTime 性能条目的开始时间
 * @param duration 性能条目的持续时间
 * @param timeOrigin 浏览器时间起点
 * @returns
 */
export function _addMeasureSpans(
  span: Span,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entry: Record<string, any>,
  startTime: number,
  duration: number,
  timeOrigin: number,
): number {
  // 获取页面导航条目
  const navEntry = getNavigationEntry();
  // 获取浏览器开始发出请求的时间点
  const requestTime = msToSec(navEntry ? navEntry.requestStart : 0);
  /**
   * 这里解释了为什么要对 performance.measure 生成的 span 的开始时间进行调整
   *
   * 1. 性能测量中的时间戳问题
   *  - performance.measure 方法允许使用任意的时间戳（即它不强制要求时间戳必须在页面请求之后）
   *  意味着，它可能会生成一些 span（追踪片段），这些 span 的时间点是在浏览器开始请求页面之前的
   *  - 比如 Next.js 框架会自动生成一些 Next.js-before-hydration 的 span
   *  这些 span 表示的是在浏览器真正加载页面内容（hydration）之前的时间点
   *  由于这些 span 在页面请求之前，直接使用这些时间戳可能会导致追踪数据不准确
   *
   * 2. 防止问题发生的解决方法
   *  - 为了避免生成的 span 出现这种异常情况，代码会强制将 span 的开始时间与页面请求的开始时间（requestStart）对齐
   *  如果 span 的原始开始时间早于 requestStart，就会使用 requestStart 作为新的开始时间
   *  - 这种对齐方式确保了所有的 span 都是在页面请求之后生成的，避免了时间顺序上的问题
   *
   * 3. 对持续时间的影响
   *  - 将开始时间对齐到 requestStart 可能会导致 span 的持续时间不准确
   *  因为实际开始时间被强制推后了，持续时间可能比真实的要短
   *  - 为了应对这种不准确性，代码会在 span 中添加一个属性，明确标识该 span 的开始时间是经过调整的
   *  用于表明该测量条目原本是在页面请求之前发生的
   */

  // 修正测量的开始时间,确保生成的 span 不会在页面请求之前发生
  // （例如，在 Next.js 中可能会生成“页面加载之前”的 span，但这些 span的开始时间实际上是在浏览器发出请求之前）
  const measureStartTimestamp = timeOrigin + Math.max(startTime, requestTime);
  // 开始时间
  const startTimeStamp = timeOrigin + startTime;
  // 测量的结束时间
  const measureEndTimestamp = startTimeStamp + duration;

  // 设置自定义属性
  const attributes: SpanAttributes = {
    // 来源为浏览器的测量
    [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.resource.browser.metrics',
  };

  // 不相等，说明 span 的开始时间被调整过了（即，实际的 startTime 发生在页面请求之前）
  // 会给 span 加上两个自定义属
  if (measureStartTimestamp !== startTimeStamp) {
    // 标记该 span 发生在页面请求之前
    attributes['sentry.browser.measure_happened_before_request'] = true;
    // 记录调整后的开始时间
    attributes['sentry.browser.measure_start_time'] = measureStartTimestamp;
  }

  startAndEndSpan(span, measureStartTimestamp, measureEndTimestamp, {
    name: entry.name as string,
    op: entry.entryType as string,
    attributes,
  });

  // 返回测量的开始时间
  return measureStartTimestamp;
}

/**
 * 通过 Performance API 对导航性能事件进行监控，
 * 并为这些事件创建 span（追踪片段），以帮助分析页面导航的性能表现
 *
 * @param span 表示当前追踪事务的根 span
 * @param entry Performance API 返回的导航条目对象
 * @param timeOrigin 时间原点，用来将时间对齐为绝对时间
 */
function _addNavigationSpans(
  span: Span,
  entry: Record<string, any>,
  timeOrigin: number,
): void {
  [
    'unloadEvent', // 前一个页面的 unload 事件时间
    'redirect', // 重定向时间（如果有重定向）
    'domContentLoadedEvent', // DOM 完全加载并解析的时间
    'loadEvent', // 页面完全加载（包括所有资源）的时间
    'connect', // 浏览器与服务器建立连接的时间
  ].forEach((event) => {
    _addPerformanceNavigationTiming(span, entry, event, timeOrigin);
  });

  // 特殊的性能事件处理

  // TLS/SSL (握手)安全连接，明确了 secureConnection 事件，并将其类型设为 'TLS/SSL'，
  // 连接结束的时间点为 connectEnd
  _addPerformanceNavigationTiming(
    span,
    entry,
    'secureConnection',
    timeOrigin,
    'TLS/SSL',
    'connectEnd',
  );

  // 处理从缓存或其他源获取资源的时间，资源获取被称为 fetch，
  // 其时间区间为从缓存获取开始到域名查找开始（domainLookupStart）
  _addPerformanceNavigationTiming(
    span,
    entry,
    'fetch',
    timeOrigin,
    'cache',
    'domainLookupStart',
  );

  // DNS 解析阶段，类型设为 'DNS'，用于测量域名解析所花费的时间
  _addPerformanceNavigationTiming(
    span,
    entry,
    'domainLookup',
    timeOrigin,
    'DNS',
  );

  // 记录整个请求的性能，包括请求发出、服务器响应等
  // 这部分对于导航性能的关键是了解页面加载涉及的网络请求及其耗时
  _addRequest(span, entry, timeOrigin);
}

/**
 * 这个函数的作用是根据传入的 Performance API 导航条目，为页面导航的相关性能事件创建 span（追踪片段）
 * 会记录事件的开始和结束时间，并将这些时间差生成 span，以帮助监控和分析性能
 *
 * @param span 根 span，用于关联这些事件的追踪片段
 * @param entry Performance API 导航条目，包含性能数据
 * @param event 导航事件名称，例如 'unloadEvent', 'redirect' 等
 * @param timeOrigin 时间原点，用于将时间对齐为绝对时间
 * @param name 事件的自定义名称，默认为 event 名称
 * @param eventEnd 结束时间的自定义字段名，默认为 eventEnd
 * @returns
 */
function _addPerformanceNavigationTiming(
  span: Span,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entry: Record<string, any>,
  event: string,
  timeOrigin: number,
  name?: string,
  eventEnd?: string,
): void {
  // 获取指定事件的开始时间（start）和结束时间（end）
  const end = eventEnd
    ? (entry[eventEnd] as number | undefined)
    : (entry[`${event}End`] as number | undefined);
  const start = entry[`${event}Start`] as number | undefined;

  // 如果有一个时间不存在，直接返回
  if (!start || !end) {
    return;
  }

  // 创建 子span
  startAndEndSpan(
    span,
    timeOrigin + msToSec(start), // 计算绝对的开始时间
    timeOrigin + msToSec(end), // 计算绝对的结束时间
    {
      op: 'browser', // 操作类型为 'browser'
      name: name || event, // 使用自定义名称或事件名称
      attributes: {
        // 附加属性，标明是浏览器性能事件
        [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.ui.browser.metrics',
      },
    },
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
/**
 * 这个函数的目的是为请求和响应阶段创建与之相关的性能追踪片段（span）
 * 通过 Performance API 获取相关的时间信息，并根据请求和响应的开始和结束时间创建 span
 * 这样可以帮助跟踪浏览器中 HTTP 请求的性能，包括请求发送和响应接收的时间段
 *
 * @param span 根 span，用于关联这些事件的追踪片段
 * @param entry Performance API 导航条目，包含性能数据
 * @param timeOrigin 时间原点，用于将时间对齐为绝对时间
 */
function _addRequest(
  span: Span,
  entry: Record<string, any>,
  timeOrigin: number,
): void {
  // 请求的开始时间
  const requestStartTimestamp =
    timeOrigin + msToSec(entry.requestStart as number);
  // 响应的结束时间
  const responseEndTimestamp =
    timeOrigin + msToSec(entry.responseEnd as number);

  // 响应的开始时间
  const responseStartTimestamp =
    timeOrigin + msToSec(entry.responseStart as number);

  // 确保 responseEnd 有效（即页面的请求已经完成）
  if (entry.responseEnd) {
    /**
     * 这里的注释解释了代码潜在的一个问题，如何避免生成无效的追踪片段（spans），并介绍了采取的预防措施
     *
     * 1. 延迟加载的情况
     *  - 在页面尚未完全加载时（例如，HTML 内容以流式方式逐渐加载），可能会出现性能数据还未完全收集的情况
     *  在这种情况下，性能条目中的 responseEnd（表示响应结束的时间）可能会是 0，因为请求尚未完成
     *
     * 2. responseEnd 为 0 的情况
     *  - 当 responseEnd 为 0 时，意味着页面请求还在进行中
     *  如果此时生成一个 span，可能会导致 结束时间早于开始时间 的情况，从而产生不合理的 span
     *
     * 3. 预防措施
     *  - 防止创建出时间不合理的追踪片段，代码只会在 responseEnd 有效
     *  （即不为 0）时，才生成 request 和 response 的 span
     *
     * 4. 后台（Relay）的处理
     *  - 如果生成了一个无效的 span（例如，结束时间在开始时间之前），
     *  后台（Relay）会将整个 span 丢弃。为了避免这种情况，
     *  代码通过检查 responseEnd 的值来确保只有在数据完整时才收集这些 span。
     *
     */

    // 为请求阶段创建一个 span
    startAndEndSpan(span, requestStartTimestamp, responseEndTimestamp, {
      op: 'browser',
      name: 'request',
      attributes: {
        [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.ui.browser.metrics',
      },
    });

    // 为响应阶段创建一个 span
    startAndEndSpan(span, responseStartTimestamp, responseEndTimestamp, {
      op: 'browser',
      name: 'response',
      attributes: {
        [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.ui.browser.metrics',
      },
    });
  }
}

export interface ResourceEntry extends Record<string, unknown> {
  initiatorType?: string;
  transferSize?: number;
  encodedBodySize?: number;
  decodedBodySize?: number;
  renderBlockingStatus?: string;
}

/**
 * 这个函数的作用是创建与资源（如图片、脚本、样式表等）加载相关的性能跨度（spans）
 * 并将其记录到应用程序的性能监控中
 *
 */
export function _addResourceSpans(
  span: Span,
  entry: ResourceEntry,
  resourceUrl: string,
  startTime: number,
  duration: number,
  timeOrigin: number,
): void {
  // 排除了 XMLHttpRequest 和 fetch 类型的资源加载
  // 因为这些请求已经被单独的处理过了,避免重复记录
  if (
    entry.initiatorType === 'xmlhttprequest' ||
    entry.initiatorType === 'fetch'
  ) {
    return;
  }

  // 解析资源的 URL
  const parsedUrl = parseUrl(resourceUrl);

  // 构建属性对象
  const attributes: SpanAttributes = {
    // 来源是 从浏览器资源性能数据中提取的
    [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.resource.browser.metrics',
  };

  // 将资源的大小添加到 属性对象中

  // 传输大小，代表资源从服务器传输到客户端的字节数，包括 HTTP 头部信息和内容
  setResourceEntrySizeData(
    attributes,
    entry,
    'transferSize',
    'http.response_transfer_size',
  );
  // 编码后的资源大小，表示传输前压缩后的资源内容大小
  setResourceEntrySizeData(
    attributes,
    entry,
    'encodedBodySize',
    'http.response_content_length',
  );
  // 解码后的资源大小，表示在客户端解压后的资源内容大小
  setResourceEntrySizeData(
    attributes,
    entry,
    'decodedBodySize',
    'http.decoded_response_content_length',
  );

  // renderBlockingStatus 表示该资源是否是页面渲染的阻塞资源（例如，CSS 文件通常是渲染阻塞的）
  if ('renderBlockingStatus' in entry) {
    attributes['resource.render_blocking_status'] = entry.renderBlockingStatus;
  }

  // 将协议、主机 添加到属性对象中
  if (parsedUrl.protocol) {
    attributes['url.scheme'] = parsedUrl.protocol.split(':').pop(); // the protocol returned by parseUrl includes a :, but OTEL spec does not, so we remove it.
  }

  if (parsedUrl.host) {
    attributes['server.address'] = parsedUrl.host;
  }

  // 检查资源是否与当前页面在同一个来源（same-origin）,标识资源是否跨域加载
  attributes['url.same_origin'] = resourceUrl.includes(WINDOW.location.origin);

  // 计算资源加载的开始时间和结束时间
  const startTimestamp = timeOrigin + startTime;
  const endTimestamp = startTimestamp + duration;

  startAndEndSpan(span, startTimestamp, endTimestamp, {
    name: resourceUrl.replace(WINDOW.location.origin, ''), // 相对路径
    op: entry.initiatorType
      ? `resource.${entry.initiatorType}` // initiatorType 资源加载类型,如script、img
      : 'resource.other',
    attributes,
  });
}

/**
 * 捕获用户代理的信息
 */
function _trackNavigator(span: Span): void {
  // 检查是否存在,不存在直接返回
  const navigator = WINDOW.navigator as
    | null
    | (Navigator & NavigatorNetworkInformation & NavigatorDeviceMemory);
  if (!navigator) {
    return;
  }

  // 追踪网络连接信息
  const connection = navigator.connection;
  if (connection) {
    // 如果有效连接类型（如 4G、3G 等）可用，则将其作为属性添加到 span 中
    if (connection.effectiveType) {
      span.setAttribute('effectiveConnectionType', connection.effectiveType);
    }

    // 如果连接类型（如 wifi、cellular 等）可用，则将其作为属性添加到 span 中
    if (connection.type) {
      span.setAttribute('connectionType', connection.type);
    }

    // 如果 RTT 值可用且有效，将 rtt 记录到 测量对象中
    if (isMeasurementValue(connection.rtt)) {
      _measurements['connection.rtt'] = {
        value: connection.rtt,
        unit: 'millisecond',
      };
    }
  }

  // 如果设备内存信息有效，则将设备内存大小（以 GB 为单位）作为属性记录到 span 中
  if (isMeasurementValue(navigator.deviceMemory)) {
    span.setAttribute('deviceMemory', `${navigator.deviceMemory} GB`);
  }

  // 如果 CPU 的逻辑核心数有效，则将其作为属性记录到 span 中
  if (isMeasurementValue(navigator.hardwareConcurrency)) {
    span.setAttribute(
      'hardwareConcurrency',
      String(navigator.hardwareConcurrency),
    );
  }
}

/**
 * 将与 LCP（Largest Contentful Paint）和 CLS（Cumulative Layout Shift）
 * 相关的数据添加到性能跟踪的 span 对象中
 * @param span
 */
function _tagMetricInfo(span: Span): void {
  if (_lcpEntry) {
    DEBUG_BUILD && logger.log('[Measurements] Adding LCP Data');

    // 捕获LCP元素的属性

    if (_lcpEntry.element) {
      span.setAttribute('lcp.element', htmlTreeAsString(_lcpEntry.element));
    }

    if (_lcpEntry.id) {
      span.setAttribute('lcp.id', _lcpEntry.id);
    }

    if (_lcpEntry.url) {
      // Trim URL to the first 200 characters.
      span.setAttribute('lcp.url', _lcpEntry.url.trim().slice(0, 200));
    }

    span.setAttribute('lcp.size', _lcpEntry.size);
  }

  // See: https://developer.mozilla.org/en-US/docs/Web/API/LayoutShift
  if (_clsEntry && _clsEntry.sources) {
    DEBUG_BUILD && logger.log('[Measurements] Adding CLS Data');

    // 记录 CLS 源节点,每个源节点调用 htmlTreeAsString 函数，将其转换为字符串并设置为 span 的属性 cls.source.index+1
    // 这样可以记录所有导致布局偏移的源节点信息
    _clsEntry.sources.forEach((source, index) =>
      span.setAttribute(
        `cls.source.${index + 1}`,
        htmlTreeAsString(source.node),
      ),
    );
  }
}

/**
 * 主要用于将 资源加载条目中的大小数据（如传输大小、编码和解码后的大小）提取出来，并添加到 attributes 对象中
 * 如果资源大小存在且小于指定的最大值（MAX_INT_AS_BYTES），则将其作为特定的 HTTP 响应属性进行存储
 *
 */
function setResourceEntrySizeData(
  attributes: SpanAttributes,
  entry: ResourceEntry,
  key: keyof Pick<
    ResourceEntry,
    'transferSize' | 'encodedBodySize' | 'decodedBodySize'
  >,
  dataKey:
    | 'http.response_transfer_size'
    | 'http.response_content_length'
    | 'http.decoded_response_content_length',
): void {
  const entryVal = entry[key];
  if (entryVal != null && entryVal < MAX_INT_AS_BYTES) {
    attributes[dataKey] = entryVal;
  }
}

/**
 * 主要用于将 TTFB（Time to First Byte，首字节到达时间）信息添加到性能测量中
 *
 * ttfb information is added via vendored web vitals library.
 */
function _addTtfbRequestTimeToMeasurements(_measurements: Measurements): void {
  // 获取当前的导航条目
  const navEntry = getNavigationEntry();
  if (!navEntry) {
    return;
  }

  // 获取响应开始时间和请求开始时间
  const { responseStart, requestStart } = navEntry;

  // 请求开始时间应该早于或等于响应开始
  if (requestStart <= responseStart) {
    DEBUG_BUILD && logger.log('[Measurements] Adding TTFB Request Time');
    _measurements['ttfb.requestTime'] = {
      value: responseStart - requestStart,
      unit: 'millisecond',
    };
  }
}

/**
 * 这个函数 _trackCLS 用于跟踪 CLS（Cumulative Layout Shift，累计布局偏移），即页面加载过程中布局偏移的累计值。
 * CLS 是衡量用户体验的一个关键性能指标，它描述了页面元素在加载过程中发生视觉位置变化的频率和幅度，
 * 任何非用户主动触发的布局变化都会影响 CLS 的数值。
 *
 * CLS 的数据会应用到与页面加载相关的 span（跟踪事务的一部分）的测量数据中。
 * 这意味着页面加载性能报告中会包含 CLS 相关的信息，以反映用户在页面加载过程中所体验到的视觉稳定性。
 */
function _trackCLS(): () => void {
  // 注册对 CLS 指标的监听器，监控页面中的布局偏移
  return addClsInstrumentationHandler(({ metric }) => {
    // 获取了最后一个布局偏移条目，这个条目反映了页面最近一次发生的布局变化
    const entry = metric.entries[metric.entries.length - 1] as
      | LayoutShift
      | undefined;
    if (!entry) {
      return;
    }

    DEBUG_BUILD && logger.log(`[Measurements] Adding CLS ${metric.value}`);
    // 存储 CLS 的值， CLS 没有具体的时间单位
    _measurements['cls'] = { value: metric.value, unit: '' };
    // 将最后的布局偏移条目保存到全局 _clsEntry 变量中，以便后续可能需要对该条目进行进一步处理或分析
    _clsEntry = entry;
  }, true);
}

/**
 * 该函数用于跟踪 LCP（Largest Contentful Paint，最大内容绘制），即页面上最大的可见内容元素（如图片、块级元素）加载完成的时间
 */
function _trackLCP(): () => void {
  // 这个函数捕获 LCP 事件的性能数据
  return addLcpInstrumentationHandler(({ metric }) => {
    // 获取最近的性能条目entry。
    const entry = metric.entries[metric.entries.length - 1];
    if (!entry) {
      return;
    }

    DEBUG_BUILD && logger.log('[Measurements] Adding LCP');

    // 存储 LCP 的值 metric.value 表示 LCP 的时间，单位为毫秒
    _measurements['lcp'] = { value: metric.value, unit: 'millisecond' };
    // 将 LCP 条目存储为全局变量，以便后续可能的处理
    _lcpEntry = entry as LargestContentfulPaint;
  }, true);
}

/**
 * 该函数用于跟踪网页的 FID（首次输入延迟），即用户首次与页面交互（如点击、按键等）到浏览器实际响应该事件之间的时间
 */
function _trackFID(): () => void {
  // 一个监听器，用来捕获 FID 性能数据
  return addFidInstrumentationHandler(({ metric }) => {
    // 获取最近的性能条目 entry
    const entry = metric.entries[metric.entries.length - 1];
    if (!entry) {
      return;
    }

    // 浏览器加载的起点时间，将其转换为秒
    const timeOrigin = msToSec(browserPerformanceTimeOrigin as number);
    // 表示用户与页面交互的时间，转换为秒
    const startTime = msToSec(entry.startTime);
    DEBUG_BUILD && logger.log('[Measurements] Adding FID');

    // 存储 FID 的值，单位为毫秒
    _measurements['fid'] = { value: metric.value, unit: 'millisecond' };
    // 记录事件的发生时间，单位为秒
    _measurements['mark.fid'] = {
      value: timeOrigin + startTime,
      unit: 'second',
    };
  });
}

/**
 * 该函数用于跟踪 TTFB（Time to First Byte），即浏览器从服务器接收到第一个字节所花费的时间
 * @returns
 */
function _trackTtfb(): () => void {
  // 这个函数用于捕获 TTFB 事件
  return addTtfbInstrumentationHandler(({ metric }) => {
    // 获取最近的性能条目 entry
    const entry = metric.entries[metric.entries.length - 1];
    if (!entry) {
      return;
    }

    DEBUG_BUILD && logger.log('[Measurements] Adding TTFB');
    // 存储 TTFB 的值，单位毫秒
    _measurements['ttfb'] = { value: metric.value, unit: 'millisecond' };
  });
}
