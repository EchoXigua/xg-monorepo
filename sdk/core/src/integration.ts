import type {
  //   Client,
  //   Event,
  //   EventHint,
  Integration,
  IntegrationFn,
  //   Options,
} from '@xigua-monitor/types';

/**
 * Define an integration function that can be used to create an integration instance.
 * Note that this by design hides the implementation details of the integration, as they are considered internal.
 */
export function defineIntegration<Fn extends IntegrationFn>(
  fn: Fn,
): (...args: Parameters<Fn>) => Integration {
  return fn;
}
