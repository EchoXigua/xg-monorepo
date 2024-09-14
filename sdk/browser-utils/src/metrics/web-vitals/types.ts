export * from './types/polyfills';
export * from './types/base';

export * from './types/cls';
export * from './types/fcp';
export * from './types/fid';
export * from './types/inp';
export * from './types/lcp';
export * from './types/ttfb';

declare global {
  interface PerformanceObserverInit {
    durationThreshold?: number;
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
