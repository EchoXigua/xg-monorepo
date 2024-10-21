import type { ReplayBreadcrumbFrame } from '../types/replayFrame';

/**
 * 为重播创建面包屑(标准的面包屑)
 */
export function createBreadcrumb(
  breadcrumb: Omit<ReplayBreadcrumbFrame, 'timestamp' | 'type'> &
    Partial<Pick<ReplayBreadcrumbFrame, 'timestamp'>>,
): ReplayBreadcrumbFrame {
  return {
    // 如果没有传入 timestamp，该函数会自动使用当前时间生成面包屑记录的时间
    timestamp: Date.now() / 1000,
    type: 'default',
    ...breadcrumb,
  };
}
