export {
  addPerformanceInstrumentationHandler,
  // addClsInstrumentationHandler,
  // addFidInstrumentationHandler,
  // addTtfbInstrumentationHandler,
  // addLcpInstrumentationHandler,
  // addInpInstrumentationHandler,
} from './metrics/instrument';

export { addHistoryInstrumentationHandler } from './instrument/history';
export {
  addXhrInstrumentationHandler,
  SENTRY_XHR_DATA_KEY,
} from './instrument/xhr';
export { addClickKeypressInstrumentationHandler } from './instrument/dom';

export {
  // fetch,
  // setTimeout,
  clearCachedImplementation,
  getNativeImplementation,
} from './getNativeImplementation';
