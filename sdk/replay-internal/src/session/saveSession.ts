import { REPLAY_SESSION_KEY, WINDOW } from '../constants';
import type { Session } from '../types';
import { hasSessionStorage } from '../util/hasSessionStorage';

/**
 * Save a session to session storage.
 */
export function saveSession(session: Session): void {
  // 检查浏览器是否支持 sessionStorage
  if (!hasSessionStorage()) {
    return;
  }

  // 尝试将会话保存到 sessionStorage
  try {
    WINDOW.sessionStorage.setItem(REPLAY_SESSION_KEY, JSON.stringify(session));
  } catch {
    // Ignore potential SecurityError exceptions
  }
}
