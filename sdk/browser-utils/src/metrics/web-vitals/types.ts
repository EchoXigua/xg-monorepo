export * from './types/polyfills';
export * from './types/base';

export * from './types/cls';
export * from './types/fcp';
export * from './types/fid';
export * from './types/inp';
export * from './types/lcp';
export * from './types/ttfb';

declare global {
  interface Document {
    // https://wicg.github.io/nav-speculation/prerendering.html#document-prerendering
    prerendering?: boolean;
    // https://wicg.github.io/page-lifecycle/#sec-api
    wasDiscarded?: boolean;
  }

  interface PerformanceObserverInit {
    durationThreshold?: number;
  }

  // https://wicg.github.io/event-timing/#sec-performance-event-timing
  interface PerformanceEventTiming extends PerformanceEntry {
    duration: DOMHighResTimeStamp;
    interactionId?: number;
  }

  interface LayoutShiftAttribution {
    node?: Node;
    previousRect: DOMRectReadOnly;
    currentRect: DOMRectReadOnly;
  }

  interface LayoutShift extends PerformanceEntry {
    value: number;
    sources: LayoutShiftAttribution[];
    hadRecentInput: boolean;
  }
}
