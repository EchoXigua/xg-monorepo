import type { Sampled, Session, SessionOptions } from '../types';
import { isSampled } from '../util/isSampled';
import { makeSession } from './Session';
import { saveSession } from './saveSession';

/**
 * 根据传入的采样率和缓冲状态，决定当前会话的采样类型
 */
export function getSessionSampleType(
  sessionSampleRate: number,
  allowBuffering: boolean,
): Sampled {
  return isSampled(sessionSampleRate)
    ? // 采样率满足条件，当前会话被采样为会话事件
      'session'
    : allowBuffering
      ? // 不满足采样条件,但会话将被缓冲（尽管没有立即采样）
        'buffer'
      : // 该会话既不被采样也不被缓冲
        false;
}

/**
 * 用于创建一个新会话，会根据采样类型生成一个 Session 对象
 *
 * - Sentry 事件：新会话被视为 Sentry 事件，所有的回放都会作为该事件的附件保存。
 * 这样，Sentry 可以将回放数据与具体的错误事件联系起来，帮助开发者进行调试。
 *
 * - 单一事件：每个回放会话只会生成一个 Sentry 事件，这样可以集中保存所有相关的回放数据，避免事件泛滥。
 *    - 在同一个会话中，用户的多次操作会被记录为同一个事件的附件，而不是为每个操作单独生成事件。
 *    - 避免过多的事件生成，同时保证所有的相关操作都保存在一个集中的位置，便于后续分析。
 */
export function createSession(
  { sessionSampleRate, allowBuffering, stickySession = false }: SessionOptions,
  { previousSessionId }: { previousSessionId?: string } = {},
): Session {
  // 获取会话的采样类型
  const sampled = getSessionSampleType(sessionSampleRate, allowBuffering);

  // 创建会话对象
  const session = makeSession({
    sampled,
    previousSessionId,
  });

  // 将会话持久化存储
  if (stickySession) {
    saveSession(session);
  }

  // 返回会话对象
  return session;
}
