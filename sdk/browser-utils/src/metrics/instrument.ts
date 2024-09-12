import { getFunctionName, logger } from '@xigua-monitor/utils';

import { DEBUG_BUILD } from '../debug-build';
import { observe } from './web-vitals/lib/observe';

type InstrumentHandlerTypePerformanceObserver =
  | 'longtask'
  | 'event'
  | 'navigation'
  | 'paint'
  | 'resource'
  | 'first-input';

type InstrumentHandlerTypeMetric = 'cls' | 'lcp' | 'fid' | 'ttfb' | 'inp';

type CleanupHandlerCallback = () => void;

type InstrumentHandlerCallback = (data: any) => void;

type StopListening = undefined | void | (() => void);

type InstrumentHandlerType =
  | InstrumentHandlerTypeMetric
  | InstrumentHandlerTypePerformanceObserver;

const handlers: {
  [key in InstrumentHandlerType]?: InstrumentHandlerCallback[];
} = {};
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
 * Add a callback that will be triggered when a performance observer is triggered,
 * and receives the entries of the observer.
 * Returns a cleanup callback which can be called to remove the instrumentation handler.
 */
export function addPerformanceInstrumentationHandler(
  type: InstrumentHandlerTypePerformanceObserver,
  callback: (data: { entries: PerformanceEntry[] }) => void,
): CleanupHandlerCallback {
  addHandler(type, callback);

  if (!instrumented[type]) {
    instrumentPerformanceObserver(type);
    instrumented[type] = true;
  }

  return getCleanupCallback(type, callback);
}

function instrumentPerformanceObserver(
  type: InstrumentHandlerTypePerformanceObserver,
): void {
  const options: PerformanceObserverInit = {};

  // Special per-type options we want to use
  if (type === 'event') {
    options.durationThreshold = 0;
  }

  observe(
    type,
    (entries) => {
      triggerHandlers(type, { entries });
    },
    options,
  );
}

/** Trigger all handlers of a given type. */
function triggerHandlers(type: InstrumentHandlerType, data: unknown): void {
  const typeHandlers = handlers[type];

  if (!typeHandlers || !typeHandlers.length) {
    return;
  }

  for (const handler of typeHandlers) {
    try {
      handler(data);
    } catch (e) {
      DEBUG_BUILD &&
        logger.error(
          `Error while triggering instrumentation handler.\nType: ${type}\nName: ${getFunctionName(handler)}\nError:`,
          e,
        );
    }
  }
}

function addHandler(
  type: InstrumentHandlerType,
  handler: InstrumentHandlerCallback,
): void {
  handlers[type] = handlers[type] || [];
  (handlers[type] as InstrumentHandlerCallback[]).push(handler);
}

// Get a callback which can be called to remove the instrumentation handler
function getCleanupCallback(
  type: InstrumentHandlerType,
  callback: InstrumentHandlerCallback,
  stopListening: StopListening,
): CleanupHandlerCallback {
  return () => {
    if (stopListening) {
      stopListening();
    }

    const typeHandlers = handlers[type];

    if (!typeHandlers) {
      return;
    }

    const index = typeHandlers.indexOf(callback);
    if (index !== -1) {
      typeHandlers.splice(index, 1);
    }
  };
}
