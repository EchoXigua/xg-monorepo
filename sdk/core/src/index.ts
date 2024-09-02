export * from './tracing';
export * from './semanticAttributes';

export { defineIntegration } from './integration';
export { hasTracingEnabled } from './utils/hasTracingEnabled';
export {
  // captureCheckIn,
  // withMonitor,
  captureException,
  // captureEvent,
  // captureMessage,
  // lastEventId,
  // close,
  // flush,
  // setContext,
  // setExtra,
  // setExtras,
  // setTag,
  // setTags,
  // setUser,
  // isInitialized,
  // isEnabled,
  // startSession,
  // endSession,
  // captureSession,
  // addEventProcessor,
} from './exports';

export {
  // spanToTraceHeader,
  // spanToJSON,
  // spanIsSampled,
  // spanToTraceContext,
  // getSpanDescendants,
  // getStatusMessage,
  // getRootSpan,
  getActiveSpan,
  // addChildSpanToSpan,
  // spanTimeInputToSeconds,
} from './utils/spanUtils';

export { SDK_VERSION } from '@xigua-monitor/utils';
