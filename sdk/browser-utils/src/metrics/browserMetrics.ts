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

interface AddPerformanceEntriesOptions {
  /**
   * Flag to determine if CLS should be recorded as a measurement on the span or
   * sent as a standalone span instead.
   */
  recordClsOnPageloadSpan: boolean;
}

/** Add performance related spans to a transaction */
export function addPerformanceEntries(
  span: Span,
  options: AddPerformanceEntriesOptions,
): void {
  const performance = getBrowserPerformanceAPI();
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
  const timeOrigin = msToSec(browserPerformanceTimeOrigin);

  const performanceEntries = performance.getEntries();

  const { op, start_timestamp: transactionStartTime } = spanToJSON(span);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  performanceEntries
    .slice(_performanceCursor)
    .forEach((entry: Record<string, any>) => {
      const startTime = msToSec(entry.startTime);
      const duration = msToSec(
        // Inexplicably, Chrome sometimes emits a negative duration. We need to work around this.
        // There is a SO post attempting to explain this, but it leaves one with open questions: https://stackoverflow.com/questions/23191918/peformance-getentries-and-negative-duration-display
        // The way we clamp the value is probably not accurate, since we have observed this happen for things that may take a while to load, like for example the replay worker.
        // TODO: Investigate why this happens and how to properly mitigate. For now, this is a workaround to prevent transactions being dropped due to negative duration spans.
        Math.max(0, entry.duration),
      );

      if (
        op === 'navigation' &&
        transactionStartTime &&
        timeOrigin + startTime < transactionStartTime
      ) {
        return;
      }

      switch (entry.entryType) {
        case 'navigation': {
          _addNavigationSpans(span, entry, timeOrigin);
          break;
        }
        case 'mark':
        case 'paint':
        case 'measure': {
          _addMeasureSpans(span, entry, startTime, duration, timeOrigin);

          // capture web vitals
          const firstHidden = getVisibilityWatcher();
          // Only report if the page wasn't hidden prior to the web vital.
          const shouldRecord = entry.startTime < firstHidden.firstHiddenTime;

          if (entry.name === 'first-paint' && shouldRecord) {
            DEBUG_BUILD && logger.log('[Measurements] Adding FP');
            _measurements['fp'] = {
              value: entry.startTime,
              unit: 'millisecond',
            };
          }
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
        // Ignore other entry types.
      }
    });

  _performanceCursor = Math.max(performanceEntries.length - 1, 0);

  _trackNavigator(span);

  // Measurements are only available for pageload transactions
  if (op === 'pageload') {
    _addTtfbRequestTimeToMeasurements(_measurements);

    ['fcp', 'fp', 'lcp'].forEach((name) => {
      const measurement = _measurements[name];
      if (
        !measurement ||
        !transactionStartTime ||
        timeOrigin >= transactionStartTime
      ) {
        return;
      }
      // The web vitals, fcp, fp, lcp, and ttfb, all measure relative to timeOrigin.
      // Unfortunately, timeOrigin is not captured within the span span data, so these web vitals will need
      // to be adjusted to be relative to span.startTimestamp.
      const oldValue = measurement.value;
      const measurementTimestamp = timeOrigin + msToSec(oldValue);

      // normalizedValue should be in milliseconds
      const normalizedValue = Math.abs(
        (measurementTimestamp - transactionStartTime) * 1000,
      );
      const delta = normalizedValue - oldValue;

      DEBUG_BUILD &&
        logger.log(
          `[Measurements] Normalized ${name} from ${oldValue} to ${normalizedValue} (${delta})`,
        );
      measurement.value = normalizedValue;
    });

    const fidMark = _measurements['mark.fid'];
    if (fidMark && _measurements['fid']) {
      // create span for FID
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

      // Delete mark.fid as we don't want it to be part of final payload
      delete _measurements['mark.fid'];
    }

    // If FCP is not recorded we should not record the cls value
    // according to the new definition of CLS.
    // TODO: Check if the first condition is still necessary: `onCLS` already only fires once `onFCP` was called.
    if (!('fcp' in _measurements) || !options.recordClsOnPageloadSpan) {
      delete _measurements.cls;
    }

    Object.entries(_measurements).forEach(([measurementName, measurement]) => {
      setMeasurement(measurementName, measurement.value, measurement.unit);
    });

    _tagMetricInfo(span);
  }

  _lcpEntry = undefined;
  _clsEntry = undefined;
  _measurements = {};
}

/** Create measure related spans */
export function _addMeasureSpans(
  span: Span,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entry: Record<string, any>,
  startTime: number,
  duration: number,
  timeOrigin: number,
): number {
  const navEntry = getNavigationEntry();
  const requestTime = msToSec(navEntry ? navEntry.requestStart : 0);
  // Because performance.measure accepts arbitrary timestamps it can produce
  // spans that happen before the browser even makes a request for the page.
  //
  // An example of this is the automatically generated Next.js-before-hydration
  // spans created by the Next.js framework.
  //
  // To prevent this we will pin the start timestamp to the request start time
  // This does make duration inaccruate, so if this does happen, we will add
  // an attribute to the span
  const measureStartTimestamp = timeOrigin + Math.max(startTime, requestTime);
  const startTimeStamp = timeOrigin + startTime;
  const measureEndTimestamp = startTimeStamp + duration;

  const attributes: SpanAttributes = {
    [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.resource.browser.metrics',
  };

  if (measureStartTimestamp !== startTimeStamp) {
    attributes['sentry.browser.measure_happened_before_request'] = true;
    attributes['sentry.browser.measure_start_time'] = measureStartTimestamp;
  }

  startAndEndSpan(span, measureStartTimestamp, measureEndTimestamp, {
    name: entry.name as string,
    op: entry.entryType as string,
    attributes,
  });

  return measureStartTimestamp;
}

/** Instrument navigation entries */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _addNavigationSpans(
  span: Span,
  entry: Record<string, any>,
  timeOrigin: number,
): void {
  [
    'unloadEvent',
    'redirect',
    'domContentLoadedEvent',
    'loadEvent',
    'connect',
  ].forEach((event) => {
    _addPerformanceNavigationTiming(span, entry, event, timeOrigin);
  });
  _addPerformanceNavigationTiming(
    span,
    entry,
    'secureConnection',
    timeOrigin,
    'TLS/SSL',
    'connectEnd',
  );
  _addPerformanceNavigationTiming(
    span,
    entry,
    'fetch',
    timeOrigin,
    'cache',
    'domainLookupStart',
  );
  _addPerformanceNavigationTiming(
    span,
    entry,
    'domainLookup',
    timeOrigin,
    'DNS',
  );
  _addRequest(span, entry, timeOrigin);
}

/** Create performance navigation related spans */
function _addPerformanceNavigationTiming(
  span: Span,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entry: Record<string, any>,
  event: string,
  timeOrigin: number,
  name?: string,
  eventEnd?: string,
): void {
  const end = eventEnd
    ? (entry[eventEnd] as number | undefined)
    : (entry[`${event}End`] as number | undefined);
  const start = entry[`${event}Start`] as number | undefined;
  if (!start || !end) {
    return;
  }
  startAndEndSpan(
    span,
    timeOrigin + msToSec(start),
    timeOrigin + msToSec(end),
    {
      op: 'browser',
      name: name || event,
      attributes: {
        [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.ui.browser.metrics',
      },
    },
  );
}

/** Create resource-related spans */
export function _addResourceSpans(
  span: Span,
  entry: ResourceEntry,
  resourceUrl: string,
  startTime: number,
  duration: number,
  timeOrigin: number,
): void {
  // we already instrument based on fetch and xhr, so we don't need to
  // duplicate spans here.
  if (
    entry.initiatorType === 'xmlhttprequest' ||
    entry.initiatorType === 'fetch'
  ) {
    return;
  }

  const parsedUrl = parseUrl(resourceUrl);

  const attributes: SpanAttributes = {
    [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.resource.browser.metrics',
  };
  setResourceEntrySizeData(
    attributes,
    entry,
    'transferSize',
    'http.response_transfer_size',
  );
  setResourceEntrySizeData(
    attributes,
    entry,
    'encodedBodySize',
    'http.response_content_length',
  );
  setResourceEntrySizeData(
    attributes,
    entry,
    'decodedBodySize',
    'http.decoded_response_content_length',
  );

  if ('renderBlockingStatus' in entry) {
    attributes['resource.render_blocking_status'] = entry.renderBlockingStatus;
  }
  if (parsedUrl.protocol) {
    attributes['url.scheme'] = parsedUrl.protocol.split(':').pop(); // the protocol returned by parseUrl includes a :, but OTEL spec does not, so we remove it.
  }

  if (parsedUrl.host) {
    attributes['server.address'] = parsedUrl.host;
  }

  attributes['url.same_origin'] = resourceUrl.includes(WINDOW.location.origin);

  const startTimestamp = timeOrigin + startTime;
  const endTimestamp = startTimestamp + duration;

  startAndEndSpan(span, startTimestamp, endTimestamp, {
    name: resourceUrl.replace(WINDOW.location.origin, ''),
    op: entry.initiatorType
      ? `resource.${entry.initiatorType}`
      : 'resource.other',
    attributes,
  });
}

/**
 * Capture the information of the user agent.
 */
function _trackNavigator(span: Span): void {
  const navigator = WINDOW.navigator as
    | null
    | (Navigator & NavigatorNetworkInformation & NavigatorDeviceMemory);
  if (!navigator) {
    return;
  }

  // track network connectivity
  const connection = navigator.connection;
  if (connection) {
    if (connection.effectiveType) {
      span.setAttribute('effectiveConnectionType', connection.effectiveType);
    }

    if (connection.type) {
      span.setAttribute('connectionType', connection.type);
    }

    if (isMeasurementValue(connection.rtt)) {
      _measurements['connection.rtt'] = {
        value: connection.rtt,
        unit: 'millisecond',
      };
    }
  }

  if (isMeasurementValue(navigator.deviceMemory)) {
    span.setAttribute('deviceMemory', `${navigator.deviceMemory} GB`);
  }

  if (isMeasurementValue(navigator.hardwareConcurrency)) {
    span.setAttribute(
      'hardwareConcurrency',
      String(navigator.hardwareConcurrency),
    );
  }
}

/** Add LCP / CLS data to span to allow debugging */
function _tagMetricInfo(span: Span): void {
  if (_lcpEntry) {
    DEBUG_BUILD && logger.log('[Measurements] Adding LCP Data');

    // Capture Properties of the LCP element that contributes to the LCP.

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
    _clsEntry.sources.forEach((source, index) =>
      span.setAttribute(
        `cls.source.${index + 1}`,
        htmlTreeAsString(source.node),
      ),
    );
  }
}

/**
 * Add ttfb request time information to measurements.
 *
 * ttfb information is added via vendored web vitals library.
 */
function _addTtfbRequestTimeToMeasurements(_measurements: Measurements): void {
  const navEntry = getNavigationEntry();
  if (!navEntry) {
    return;
  }

  const { responseStart, requestStart } = navEntry;

  if (requestStart <= responseStart) {
    DEBUG_BUILD && logger.log('[Measurements] Adding TTFB Request Time');
    _measurements['ttfb.requestTime'] = {
      value: responseStart - requestStart,
      unit: 'millisecond',
    };
  }
}

/**
 * Starts tracking the Cumulative Layout Shift on the current page and collects the value and last entry
 * to the `_measurements` object which ultimately is applied to the pageload span's measurements.
 */
function _trackCLS(): () => void {
  return addClsInstrumentationHandler(({ metric }) => {
    const entry = metric.entries[metric.entries.length - 1] as
      | LayoutShift
      | undefined;
    if (!entry) {
      return;
    }
    DEBUG_BUILD && logger.log(`[Measurements] Adding CLS ${metric.value}`);
    _measurements['cls'] = { value: metric.value, unit: '' };
    _clsEntry = entry;
  }, true);
}

/** Starts tracking the Largest Contentful Paint on the current page. */
function _trackLCP(): () => void {
  return addLcpInstrumentationHandler(({ metric }) => {
    const entry = metric.entries[metric.entries.length - 1];
    if (!entry) {
      return;
    }

    DEBUG_BUILD && logger.log('[Measurements] Adding LCP');
    _measurements['lcp'] = { value: metric.value, unit: 'millisecond' };
    _lcpEntry = entry as LargestContentfulPaint;
  }, true);
}

/** Starts tracking the First Input Delay on the current page. */
function _trackFID(): () => void {
  return addFidInstrumentationHandler(({ metric }) => {
    const entry = metric.entries[metric.entries.length - 1];
    if (!entry) {
      return;
    }

    const timeOrigin = msToSec(browserPerformanceTimeOrigin as number);
    const startTime = msToSec(entry.startTime);
    DEBUG_BUILD && logger.log('[Measurements] Adding FID');
    _measurements['fid'] = { value: metric.value, unit: 'millisecond' };
    _measurements['mark.fid'] = {
      value: timeOrigin + startTime,
      unit: 'second',
    };
  });
}

function _trackTtfb(): () => void {
  return addTtfbInstrumentationHandler(({ metric }) => {
    const entry = metric.entries[metric.entries.length - 1];
    if (!entry) {
      return;
    }

    DEBUG_BUILD && logger.log('[Measurements] Adding TTFB');
    _measurements['ttfb'] = { value: metric.value, unit: 'millisecond' };
  });
}
