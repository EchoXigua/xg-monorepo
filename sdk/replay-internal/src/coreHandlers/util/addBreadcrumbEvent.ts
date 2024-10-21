import { EventType } from '@sentry-internal/rrweb';
import type { Breadcrumb } from '@xigua-monitor/types';
import { normalize } from '@xigua-monitor/utils';

import type { ReplayContainer } from '../../types';

/**
 * 将生成的面包屑事件，加入到回放系统中
 */
export function addBreadcrumbEvent(
  replay: ReplayContainer,
  breadcrumb: Breadcrumb,
): void {
  // 这类事件（事务）不作为用户交互的面包屑记录
  if (breadcrumb.category === 'sentry.transaction') {
    return;
  }

  // 用户界面的点击和输入事件
  if (['ui.click', 'ui.input'].includes(breadcrumb.category as string)) {
    // 表示这些交互属于用户活动，并更新用户活动状态
    replay.triggerUserActivity();
  } else {
    // 检查当前回放会话是否已经过期，并根据结果执行处理（例如结束当前会话或重新启动）
    replay.checkAndHandleExpiredSession();
  }

  // 将生成的事件加入到回放系统的更新队列中
  replay.addUpdate(() => {
    // This should never reject
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    replay.throttledAddEvent({
      type: EventType.Custom,
      // 将秒转为毫秒
      timestamp: (breadcrumb.timestamp || 0) * 1000,
      data: {
        tag: 'breadcrumb',
        // 标准化到最大值。每个对象10个深度和1_000个属性
        payload: normalize(breadcrumb, 10, 1_000),
      },
    });

    // 如果面包屑的 category 是 'console'，则不会立即刷新（推送数据），而是将其暂时缓存，直到满足其他刷新条件。
    return breadcrumb.category === 'console';
  });
}
