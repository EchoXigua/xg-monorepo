import type { Session } from '../types';
import { isExpired } from './isExpired';

/**
 * 判断一个会话是否已经过期
 * 同时考虑会话的最大持续时长和会话的空闲过期时间,以决定当前会话是否仍然有效
 */
export function isSessionExpired(
  session: Session,
  {
    maxReplayDuration,
    sessionIdleExpire,
    targetTime = Date.now(),
  }: {
    maxReplayDuration: number;
    sessionIdleExpire: number;
    targetTime?: number;
  },
): boolean {
  return (
    // 首先检查会话的最大时长是否已经超过
    isExpired(session.started, maxReplayDuration, targetTime) ||
    // 检查空闲过期时间是否已经超过,lastActivity 是会话的最后活动时间
    // sessionIdleExpire 表示如果用户在这段时间内没有活动，视为会话过期
    isExpired(session.lastActivity, sessionIdleExpire, targetTime)
  );
}
