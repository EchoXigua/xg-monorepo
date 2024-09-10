export { registerSpanErrorInstrumentation } from './errors';

export {
  // startSpan,
  startInactiveSpan,
  // startSpanManual,
  // continueTrace,
  // withActiveSpan,
  // suppressTracing,
  // startNewTrace,
} from './trace';

export { startIdleSpan, TRACING_DEFAULTS } from './idleSpan';

export {
  getDynamicSamplingContextFromClient,
  getDynamicSamplingContextFromSpan,
  // spanToBaggageHeader,
} from './dynamicSamplingContext';
