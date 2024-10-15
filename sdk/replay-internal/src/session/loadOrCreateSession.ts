import { DEBUG_BUILD } from '../debug-build';
import type { Session, SessionOptions } from '../types';
import { logger } from '../util/logger';
import { createSession } from './createSession';
import { fetchSession } from './fetchSession';
import { shouldRefreshSession } from './shouldRefreshSession';

/**
 * 用于在初始化回放时获取或创建会话
 * 检查现有会话的状态来决定是使用现有的会话还是创建新的会话，并处理会话的刷新逻辑
 * 返回一个可能未采样的会话
 */
export function loadOrCreateSession(
  {
    sessionIdleExpire, // 会话空闲过期时间
    maxReplayDuration, // 最大回放持续时间
    previousSessionId, // 上一个会话的 ID
  }: {
    sessionIdleExpire: number;
    maxReplayDuration: number;
    previousSessionId?: string;
  },
  sessionOptions: SessionOptions, // 包含与会话行为相关的配置
): Session {
  // stickySession 为 false，则不会获取现有会话，表示不需要保持持久会话
  // 为 true，表示应该尝试从存储中获取现有的会话
  const existingSession = sessionOptions.stickySession && fetchSession();

  // 如果没有现有会话，创建新的会话
  if (!existingSession) {
    DEBUG_BUILD && logger.infoTick('Creating new session');
    return createSession(sessionOptions, { previousSessionId });
  }

  // 检查是否需要刷新现有会话
  // shouldRefreshSession 返回 false，意味着会话还没有过期或满足其他刷新条件，
  // 此时直接返回现有的会话 existingSession，无需创建新会话
  if (
    !shouldRefreshSession(existingSession, {
      sessionIdleExpire,
      maxReplayDuration,
    })
  ) {
    return existingSession;
  }

  DEBUG_BUILD &&
    logger.infoTick(
      'Session in sessionStorage is expired, creating new one...',
    );

  // 创建新会话,传递现有会话的 id，这样可以保持某种会话的连续性或相关性
  return createSession(sessionOptions, {
    previousSessionId: existingSession.id,
  });
}
