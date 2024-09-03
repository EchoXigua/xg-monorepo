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
import { addGlobalErrorInstrumentationHandler } from './globalError';
import { addGlobalUnhandledRejectionInstrumentationHandler } from './globalUnhandledRejection';

export {
  addConsoleInstrumentationHandler,
  addFetchInstrumentationHandler,
  addGlobalErrorInstrumentationHandler,
  addGlobalUnhandledRejectionInstrumentationHandler,
  addHandler,
  maybeInstrument,
  triggerHandlers,
  // Only exported for tests
  resetInstrumentationHandlers,
  addFetchEndInstrumentationHandler,
};
