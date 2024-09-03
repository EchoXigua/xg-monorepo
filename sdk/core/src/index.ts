export * from './tracing';
export * from './semanticAttributes';

export { getIntegrationsToSetup, defineIntegration } from './integration';
export { hasTracingEnabled } from './utils/hasTracingEnabled';
export {
  // captureCheckIn,
  // withMonitor,
  captureException,
  captureEvent,
  // captureMessage,
  lastEventId,
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
  startSession,
  // endSession,
  captureSession,
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

export {
  getCurrentScope,
  getIsolationScope,
  // getGlobalScope,
  withScope,
  // withIsolationScope,
  getClient,
} from './currentScopes';

export { initAndBind, setCurrentClient } from './sdk';
export { inboundFiltersIntegration } from './integrations/inboundfilters';
export { functionToStringIntegration } from './integrations/functiontostring';
export { dedupeIntegration } from './integrations/dedupe';
export { applySdkMetadata } from './utils/sdkMetadata';
export { BaseClient } from './baseclient';
export { addBreadcrumb } from './breadcrumbs';
export {
  getEnvelopeEndpointWithUrlEncodedAuth,
  getReportDialogEndpoint,
} from './api';
export { createTransport } from './transports/base';

export { SDK_VERSION } from '@xigua-monitor/utils';
