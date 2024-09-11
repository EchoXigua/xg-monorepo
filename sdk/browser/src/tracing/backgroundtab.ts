import {
  SPAN_STATUS_ERROR,
  getActiveSpan,
  getRootSpan,
} from '@xigua-monitor/core';
import { spanToJSON } from '@xigua-monitor/core';
import { logger } from '@xigua-monitor/utils';

import { DEBUG_BUILD } from '../debug-build';
import { WINDOW } from '../helpers';

/**
 *  这个函数用于检测浏览器标签页是否进入后台，并在标签页隐藏时，取消并结束一个事务
 */
export function registerBackgroundTabDetection(): void {
  if (WINDOW && WINDOW.document) {
    // 如果是在浏览器环境下，则监听 visibilitychange，检测当前网页是否进入后台（即标签页隐藏）
    // 切换标签或最小化浏览器窗口时，该事件会被触发
    WINDOW.document.addEventListener('visibilitychange', () => {
      // 获取当前活动的 span
      const activeSpan = getActiveSpan();
      // 没有活动的 span 直接返回
      if (!activeSpan) {
        return;
      }

      // 获取当前活跃span的根span
      const rootSpan = getRootSpan(activeSpan);

      // 如果当前标签页被隐藏且存在根span
      if (WINDOW.document.hidden && rootSpan) {
        const cancelledStatus = 'cancelled';

        // 将根span JSON化，然后提取操作类型和状态
        const { op, status } = spanToJSON(rootSpan);

        if (DEBUG_BUILD) {
          logger.log(
            `[Tracing] Transaction: ${cancelledStatus} -> since tab moved to the background, op: ${op}`,
          );
        }

        // We should not set status if it is already set, this prevent important statuses like
        // error or data loss from being overwritten on transaction.
        // 如果状态不存在，则将其设置为错误 并记录取消原因
        if (!status) {
          rootSpan.setStatus({
            code: SPAN_STATUS_ERROR,
            message: cancelledStatus,
          });
        }

        // 给当前根span 设置一个属性，表示取消的原因是由于 document.hidden
        rootSpan.setAttribute('sentry.cancellation_reason', 'document.hidden');
        // 结束 span 的追踪
        rootSpan.end();
      }
    });
  } else {
    // 说明不是浏览器环境
    DEBUG_BUILD &&
      logger.warn(
        '[Tracing] Could not set up background tab detection due to lack of global document',
      );
  }
}
