import type { Client, ClientOptions } from '@xigua-monitor/types';
import { consoleSandbox, logger } from '@xigua-monitor/utils';
import { getCurrentScope } from './currentScopes';

import { DEBUG_BUILD } from './debug-build';

/** A class object that can instantiate Client objects. */
export type ClientClass<F extends Client, O extends ClientOptions> = new (
  options: O,
) => F;

/**
 * 这个函数用于创建一个新的 SDK 客户端实例，配置并绑定到当前的作用域中
 *
 * @param clientClass 用于创建客户端实例的类
 * @param options 用于初始化客户端的配置选项
 * @returns 返回一个新的客户端实例
 */
export function initAndBind<F extends Client, O extends ClientOptions>(
  clientClass: ClientClass<F, O>,
  options: O,
): Client {
  if (options.debug === true) {
    //
    if (DEBUG_BUILD) {
      // 代码是在 DEBUG_BUILD 环境下编译的，那么启用 logger
      logger.enable();
    } else {
      // 如果不在调试环境中，但 debug 选项被设置为 true，
      // 则使用 console.warn 输出警告信息，提示无法在非调试版本中使用调试功能。
      // 使用 consoleSandbox 包装 console.warn，以确保在沙盒环境中安全执行
      consoleSandbox(() => {
        // eslint-disable-next-line no-console
        console.warn(
          '[Sentry] Cannot initialize SDK with `debug` option using a non-debug bundle.',
        );
      });
    }
  }

  // 获取当前作用域 scope
  const scope = getCurrentScope();
  // 更新其状态,这通常包括初始化状态，如用户信息、标签、上下文等。
  scope.update(options.initialScope);

  // 使用传入的 clientClass 创建客户端实例，传入 options 进行配置
  const client = new clientClass(options);
  // 将新创建的客户端实例绑定到当前作用域中
  setCurrentClient(client);
  // 调用客户端的 init 方法，完成初始化过程
  client.init();

  // 返回客户端实例
  return client;
}

/**
 * 函数用于将给定的客户端实例设置为当前作用域的客户端。
 * 这一步确保了 SDK 在整个应用程序的上下文中使用正确的客户端。
 */
export function setCurrentClient(client: Client): void {
  getCurrentScope().setClient(client);
}
