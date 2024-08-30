import { captureException } from '@xigua-monitor/core';
import { consoleSandbox } from '@xigua-monitor/utils';

import type { ViewModel, Vue, VueOptions } from './types';
import {
  formatComponentName,
  generateComponentTrace,
} from './vendor/components';

type UnknownFunc = (...args: unknown[]) => void;

/**
 * 为 Vue 应用程序添加一个全局的错误处理器，以便在 Vue 组件中发生错误时，能够捕获错误并进行处理。
 * 这个错误处理器还会根据配置项决定是否记录错误并在控制台中输出警告信息。
 * @param app  Vue 实例，表示当前 Vue 应用程序
 * @param options 一个配置对象，用于控制错误处理器的行为
 */
export const attachErrorHandler = (app: Vue, options: VueOptions): void => {
  // 提取原始的错误处理和警告处理函数
  // silent 用于控制 Vue 是否在控制台中输出警告 在v3中没看见有暴露这个
  const { errorHandler, warnHandler, silent } = app.config;

  /**
   * 重写vue 的 错误处理函数, 这个函数会替代 Vue 应用的默认错误处理器。
   * 当 Vue 中的组件生命周期钩子、方法或其他操作中发生错误时，errorHandler 会被调用
   *
   * @param error 发生的错误对象
   * @param vm 触发错误的 Vue 组件实例
   * @param lifecycleHook 当前正在执行的生命周期钩子名称
   */
  app.config.errorHandler = (
    error: Error,
    vm: ViewModel,
    lifecycleHook: string,
  ): void => {
    // 获取组件的名称
    const componentName = formatComponentName(vm, false);
    // 获取组件的追踪信息
    const trace = vm ? generateComponentTrace(vm) : '';
    // 保存了与错误相关的上下文信息，包括组件名称、生命周期钩子和组件追踪信息。
    const metadata: Record<string, unknown> = {
      componentName,
      lifecycleHook,
      trace,
    };

    if (options.attachProps && vm) {
      // 试从组件实例中获取 props 数据，并将其附加到 metadata 中
      // Vue 2 中的 props 数据存储在 vm.$options.propsData
      // Vue 3 中的 props 数据存储在 vm.$props

      if (vm.$options && vm.$options.propsData) {
        metadata.propsData = vm.$options.propsData;
      } else if (vm.$props) {
        metadata.propsData = vm.$props;
      }
    }

    // 将错误的捕获延迟到下一个事件循环中。
    // 这么做的原因是为了确保所有面包屑（breadcrumbs）记录在捕获错误之前已经完成。
    setTimeout(() => {
      // 一个捕获异常的函数，用于将错误报告到错误监控系统（如 Sentry）。
      // 这里还提供了上下文信息 metadata，将其作为 vue 的上下文附加在 captureContext 中。
      captureException(error, {
        captureContext: { contexts: { vue: metadata } },
        mechanism: { handled: false },
      });
    });

    if (typeof errorHandler === 'function') {
      // 如果用户在 Vue 配置中自定义了 errorHandler，那么在捕获错误后，
      // 调用原始的 errorHandler，以便继续执行用户定义的错误处理逻辑。
      (errorHandler as UnknownFunc).call(app, error, vm, lifecycleHook);
    }

    // 决定是否将错误信息输出到控制台
    if (options.logErrors) {
      // 存在 console 对象
      const hasConsole = typeof console !== 'undefined';
      const message = `Error in ${lifecycleHook}: "${error && error.toString()}"`;

      // 存在自定义的 warnHandler，则使用它来记录警告信息。
      if (warnHandler) {
        (warnHandler as UnknownFunc).call(null, message, vm, trace);
      } else if (hasConsole && !silent) {
        // 存在控制台 且silent 为false

        // 来确保错误信息可以安全地输出到控制台中
        consoleSandbox(() => {
          // eslint-disable-next-line no-console
          console.error(`[Vue warn]: ${message}${trace}`);
        });
      }
    }
  };
};
