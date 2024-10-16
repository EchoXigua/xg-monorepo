import { getWorkerURL } from '@xigua-monitor/replay-worker';

import { DEBUG_BUILD } from '../debug-build';
import type { EventBuffer } from '../types';
import { logger } from '../util/logger';
import { EventBufferArray } from './EventBufferArray';
import { EventBufferProxy } from './EventBufferProxy';

interface CreateEventBufferParams {
  /** 是否启用压缩功能 */
  useCompression: boolean;
  /** 自定义的 Worker URL */
  workerUrl?: string;
}

/**
 * 用于树摇（tree-shaking）的保护常量，用于决定是否排除压缩 Worker 的代码。
 * 如果在构建时设置为 true，则压缩 Worker 的代码不会被包含在最终的构建中
 */
declare const __SENTRY_EXCLUDE_REPLAY_WORKER__: boolean;

/**
 * 创建事件缓冲区的功能，用于支持回放的事件捕获
 * 通过使用 Web Worker，可以在后台处理数据，从而提高性能
 */
export function createEventBuffer({
  useCompression,
  workerUrl: customWorkerUrl,
}: CreateEventBufferParams): EventBuffer {
  if (
    useCompression &&
    // eslint-disable-next-line no-restricted-globals
    // 浏览器支持 Web Worker
    window.Worker
  ) {
    const worker = _loadWorker(customWorkerUrl);

    // 如果成功加载 Worker，返回 Worker 实例
    if (worker) {
      return worker;
    }
  }

  DEBUG_BUILD && logger.info('Using simple buffer');
  // 返回事件缓冲区实例
  return new EventBufferArray();
}

function _loadWorker(customWorkerUrl?: string): EventBufferProxy | void {
  try {
    // 获取 Worker 的 URL，优先使用 customWorkerUrl，如果没有提供，则调用 _getWorkerUrl()获取
    const workerUrl = customWorkerUrl || _getWorkerUrl();

    if (!workerUrl) {
      return;
    }

    DEBUG_BUILD &&
      logger.info(
        `Using compression worker${customWorkerUrl ? ` from ${customWorkerUrl}` : ''}`,
      );
    // 创建 worker实例
    const worker = new Worker(workerUrl);
    // 将其封装在 EventBufferProxy 中返回
    return new EventBufferProxy(worker);
  } catch (error) {
    DEBUG_BUILD &&
      logger.exception(error, 'Failed to create compression worker');
    // Fall back to use simple event buffer array
  }
}

function _getWorkerUrl(): string {
  if (
    typeof __SENTRY_EXCLUDE_REPLAY_WORKER__ === 'undefined' ||
    !__SENTRY_EXCLUDE_REPLAY_WORKER__
  ) {
    return getWorkerURL();
  }

  // 不使用worker
  return '';
}
