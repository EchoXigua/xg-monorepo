import {
  addGlobalErrorInstrumentationHandler,
  addGlobalUnhandledRejectionInstrumentationHandler,
  logger,
} from '@xigua-monitor/utils';
import { DEBUG_BUILD } from '../debug-build';
import { getActiveSpan, getRootSpan } from '../utils/spanUtils';
import { SPAN_STATUS_ERROR } from './spanstatus';

/**
 * 用于防止重复调用 registerSpanErrorInstrumentation()。它确保错误监听器只会在全局注册一次。
 */
let errorsInstrumented = false;

/**
 * 这个函数主要功能是确保全局错误（例如 JavaScript 执行中的未捕获异常或者未处理的 Promise 拒绝）
 * 能够影响当前活跃的追踪 span，并将其标记为“失败”。这个过程有助于确保当应用程序发生错误时，
 * Sentry 追踪到的性能信息能够正确反映出这些错误，便于进一步调试和问题定位。
 */
export function registerSpanErrorInstrumentation(): void {
  // 说明错误监听器已经被注册过，因此直接返回。
  if (errorsInstrumented) {
    return;
  }

  // 如果没有注册，则标记为已注册
  errorsInstrumented = true;

  // 监听所有的未捕获异常
  addGlobalErrorInstrumentationHandler(errorCallback);
  // 监听所有的未处理的 Promise 拒绝。
  addGlobalUnhandledRejectionInstrumentationHandler(errorCallback);
}

/**
 * 这是一个错误处理回调函数，当发生全局错误时，它会被调用。（错误和 promise.reject）
 */
function errorCallback(): void {
  // 获取当前活跃的 span，即当前正在进行的追踪操作。
  const activeSpan = getActiveSpan();
  // 获取与该 span 相关联的根 span（通常是整个事务的起点）。
  const rootSpan = activeSpan && getRootSpan(activeSpan);

  // 如果存在根 span
  if (rootSpan) {
    const message = 'internal_error';
    DEBUG_BUILD &&
      logger.log(`[Tracing] Root span: ${message} -> Global error occured`);

    // 将其状态标记为 internal_error，并将其状态设置为 SPAN_STATUS_ERROR。
    // 这意味着这个根 span 所追踪的事务因为发生了全局错误而被标记为失败。
    rootSpan.setStatus({ code: SPAN_STATUS_ERROR, message });
  }
}

/**
 * 给 errorCallback 函数添加了一个标记 tag，目的是确保可以在后续的代码中识别到这个特定的回调函数。
 * 这样做的原因是，在打包和压缩代码时，函数名可能会被丢失或更改，
 * 但通过为函数设置一个唯一的标识符（如 tag），依然可以对该函数进行引用和识别
 */
errorCallback.tag = 'sentry_tracingErrorCallback';
