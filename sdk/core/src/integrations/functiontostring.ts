import type {
  Client,
  IntegrationFn,
  WrappedFunction,
} from '@xigua-monitor/types';
import { getOriginalFunction } from '@xigua-monitor/utils';
import { getClient } from '../currentScopes';
import { defineIntegration } from '../integration';

let originalFunctionToString: () => void;

const INTEGRATION_NAME = 'FunctionToString';

const SETUP_CLIENTS = new WeakMap<Client, boolean>();

const _functionToStringIntegration = (() => {
  return {
    name: INTEGRATION_NAME,
    setupOnce() {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      // 保存一份原始的 toString 方法
      originalFunctionToString = Function.prototype.toString;

      // 处理潜在的错误，例如在某些环境中，内置对象（如 Function.prototype）可能是不可变的。
      try {
        // 重写 toString 方法
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Function.prototype.toString = function (
          this: WrappedFunction,
          ...args: any[]
        ): string {
          // this 关键字指向当前调用 toString 的函数（即被包装的函数）
          // 尝试获取当前函数的原始实现
          const originalFunction = getOriginalFunction(this);

          // 目的是确保在调用原始的 toString 方法时，能够使用未包装的函数
          const context =
            SETUP_CLIENTS.has(getClient() as Client) &&
            originalFunction !== undefined
              ? originalFunction
              : this;

          // 使用 apply 方法来调用原始的 toString 方法，将 context 作为 this 上下文传入
          return originalFunctionToString.apply(context, args);
        };
      } catch {
        // ignore errors here, just don't patch this
      }
    },
    setup(client) {
      // 用于将传入的客户端注册到 SETUP_CLIENTS 中，表明此客户端已被设置
      SETUP_CLIENTS.set(client, true);
    },
  };
}) satisfies IntegrationFn;

/**
 * 修补toString调用以返回包装函数的正确名称
 * 在初始化 Sentry 时，将此集成添加到集成数组中
 *
 * ```js
 * Sentry.init({
 *   integrations: [
 *     functionToStringIntegration(),
 *   ],
 * });
 * ```
 *
 * 这个集成确保了当调用 toString 时，可以正确返回被包装函数的字符串表示，
 * 而不是默认的 "[native code]" 或其他不具描述性的字符串。
 * 这种处理方式增强了调试信息的准确性，使得开发者能够更容易地识别和定位问题。
 */
export const functionToStringIntegration = defineIntegration(
  _functionToStringIntegration,
);
