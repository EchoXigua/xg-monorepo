import { isNativeFunction, logger } from '@xigua-monitor/utils';
import { WINDOW } from './types';
import { DEBUG_BUILD } from './debug-build';

interface CacheableImplementations {
  setTimeout: typeof WINDOW.setTimeout;
  fetch: typeof WINDOW.fetch;
}

const cachedImplementations: Partial<CacheableImplementations> = {};

/**
 * Get the native implementation of a browser function.
 *
 * This can be used to ensure we get an unwrapped version of a function, in cases where a wrapped function can lead to problems.
 *
 * The following methods can be retrieved:
 * - `setTimeout`: This can be wrapped by e.g. Angular, causing change detection to be triggered.
 * - `fetch`: This can be wrapped by e.g. ad-blockers, causing an infinite loop when a request is blocked.
 */
export function getNativeImplementation<
  T extends keyof CacheableImplementations,
>(name: T): CacheableImplementations[T] {
  const cached = cachedImplementations[name];
  if (cached) {
    return cached;
  }

  let impl = WINDOW[name] as CacheableImplementations[T];

  // Fast path to avoid DOM I/O
  if (isNativeFunction(impl)) {
    return (cachedImplementations[name] = impl.bind(
      WINDOW,
    ) as CacheableImplementations[T]);
  }

  const document = WINDOW.document;
  // eslint-disable-next-line deprecation/deprecation
  if (document && typeof document.createElement === 'function') {
    try {
      const sandbox = document.createElement('iframe');
      sandbox.hidden = true;
      document.head.appendChild(sandbox);
      const contentWindow = sandbox.contentWindow;
      if (contentWindow && contentWindow[name]) {
        impl = contentWindow[name] as CacheableImplementations[T];
      }
      document.head.removeChild(sandbox);
    } catch (e) {
      // Could not create sandbox iframe, just use window.xxx
      DEBUG_BUILD &&
        logger.warn(
          `Could not create sandbox iframe for ${name} check, bailing to window.${name}: `,
          e,
        );
    }
  }

  // Sanity check: This _should_ not happen, but if it does, we just skip caching...
  // This can happen e.g. in tests where fetch may not be available in the env, or similar.
  if (!impl) {
    return impl;
  }

  return (cachedImplementations[name] = impl.bind(
    WINDOW,
  ) as CacheableImplementations[T]);
}

/** Clear a cached implementation. */
export function clearCachedImplementation(
  name: keyof CacheableImplementations,
): void {
  cachedImplementations[name] = undefined;
}
