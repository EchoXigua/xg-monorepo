import { DEBUG_BUILD } from './debug-build';
import { logger } from './logger';
import { GLOBAL_OBJ } from './worldwide';

const WINDOW = GLOBAL_OBJ as unknown as Window;

export { supportsHistory } from './vendor/supportsHistory';

/**
 *  这个函数旨在确定当前的浏览器环境是否支持 Fetch API
 *
 * {@link supportsFetch}.
 *
 * @returns Answer to the given question.
 */
export function supportsFetch(): boolean {
  // 检查 WINDOW 对象中是否存在 fetch 属性。如果不存在，则返回 false，表示当前环境不支持 Fetch API。
  if (!('fetch' in WINDOW)) {
    return false;
  }

  // 如果 fetch 属性存在，函数继续尝试创建 Headers、Request 和 Response 对象
  // 这是因为 Fetch API 的完整性不仅仅依赖于 fetch 方法本身，还依赖于相关的对象和类的存在
  try {
    new Headers();
    new Request('http://www.example.com');
    new Response();
    // 如果这些对象的构造函数能够成功执行，则函数返回 true，表示支持 Fetch API
    return true;
  } catch (e) {
    // 如果在创建这些对象时抛出任何错误，则函数会捕获异常并返回 false
    return false;
  }
}
