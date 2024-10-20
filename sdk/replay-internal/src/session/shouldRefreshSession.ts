import type { Session } from '../types';
import { isSessionExpired } from '../util/isSessionExpired';

/** 判断是否需要刷新当前的会话 */
export function shouldRefreshSession(
  session: Session,
  {
    sessionIdleExpire,
    maxReplayDuration,
  }: { sessionIdleExpire: number; maxReplayDuration: number },
): boolean {
  // 检查会话是否过期,如果会话没有过期,表示会话不需要刷新
  if (!isSessionExpired(session, { sessionIdleExpire, maxReplayDuration })) {
    return false;
  }

  // 检查会话的采样状态是否为 'buffer',并且当前会话的 segmentId 是否为 0
  // 说明这个会话正在进行缓冲，可能是为后续的错误采样准备的
  // 在这种情况下，即使会话被视为过期，它仍然不会被刷新，因为系统还没有决定是否将缓冲的数据发送给 Sentry。
  // 因此，此时返回 false，表示会话不需要刷新
  if (session.sampled === 'buffer' && session.segmentId === 0) {
    return false;
  }

  // 会话需要刷新
  return true;
}
