import { isNodeEnv } from './node';
import { GLOBAL_OBJ } from './worldwide';

/**
 * 用于检测当前的运行环境是否在浏览器中
 */
export function isBrowser(): boolean {
  // eslint-disable-next-line no-restricted-globals
  return (
    // 是否存在全局 window 对象
    // 如果当前环境不是 Node.js 环境或者 是 Electron 的渲染进程（即 Electron 环境）仍然认为是浏览器环境
    typeof window !== 'undefined' && (!isNodeEnv() || isElectronNodeRenderer())
  );
}

type ElectronProcess = { type?: string };

/**
 * 用于检测当前环境是否为 Electron 的渲染进程（renderer 进程）
 * @returns
 */
function isElectronNodeRenderer(): boolean {
  return (
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
    // 检测是否存在全局的 process 对象，这是 Node.js 和 Electron 环境中才有的
    (GLOBAL_OBJ as any).process !== undefined &&
    // 如果 process 对象的 type 属性为 'renderer'，则表示这是 Electron 的渲染进程
    ((GLOBAL_OBJ as any).process as ElectronProcess).type === 'renderer'
  );
}
