import { WINDOW } from '../constants';

/** 检查浏览器是否支持 sessionStorage  */
export function hasSessionStorage(): boolean {
  try {
    // This can throw, e.g. when being accessed in a sandboxed iframe
    return 'sessionStorage' in WINDOW && !!WINDOW.sessionStorage;
  } catch {
    return false;
  }
}
