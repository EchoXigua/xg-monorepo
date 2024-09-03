import {
  addHandler,
  maybeInstrument,
  resetInstrumentationHandlers,
  triggerHandlers,
} from './handlers';
import { addConsoleInstrumentationHandler } from './console';
import {
  addFetchEndInstrumentationHandler,
  addFetchInstrumentationHandler,
} from './fetch';

export {
  addConsoleInstrumentationHandler,
  addFetchInstrumentationHandler,
  // addGlobalErrorInstrumentationHandler,
  // addGlobalUnhandledRejectionInstrumentationHandler,
  addHandler,
  maybeInstrument,
  triggerHandlers,
  // Only exported for tests
  resetInstrumentationHandlers,
  addFetchEndInstrumentationHandler,
};
