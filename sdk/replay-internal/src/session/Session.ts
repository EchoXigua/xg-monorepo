import { uuid4 } from '@xigua-monitor/utils';

import type { Sampled, Session } from '../types';

/**
 * 用于创建并返回一个带有默认值的 Session 对象
 * 强制要求传入的 session 对象中包含 sampled 字段
 */
export function makeSession(
  session: Partial<Session> & { sampled: Sampled },
): Session {
  const now = Date.now();
  const id = session.id || uuid4();
  // 注意：started 和 lastActivity 的值不会是 0（因为 0 会被视为无效值并替换为当前时间），但这在生产环境之外应该不成问题。
  // 会话的开始时间
  const started = session.started || now;
  // 会话的最后活动时间
  const lastActivity = session.lastActivity || now;

  // 会话的段编号,用于标识同一会话的不同段，通常用于处理长时间会话的分段回放
  const segmentId = session.segmentId || 0;
  // 会话的采样状态
  const sampled = session.sampled;
  // 前一个会话的 ID（如果存在）
  const previousSessionId = session.previousSessionId;

  return {
    id,
    started,
    lastActivity,
    segmentId,
    sampled,
    previousSessionId,
  };
}
