export { SDK_VERSION } from '@xigua-monitor/core';

export { getDefaultIntegrations, init } from './sdk';

export {
  // addEventProcessor,
  addBreadcrumb,
  // addIntegration,
  captureException,
} from '@xigua-monitor/core';

export {
  SEMANTIC_ATTRIBUTE_SENTRY_OP,
  SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN,
  SEMANTIC_ATTRIBUTE_SENTRY_SOURCE,
  SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE,
} from '@xigua-monitor/core';
