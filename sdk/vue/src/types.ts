/* eslint-disable @typescript-eslint/no-explicit-any */
import type { BrowserOptions } from '@sentry/browser';

/**
 * 定义了一个 Vue 接口，以便能够同时兼容 Vue 2 和 Vue 3
 * Vue 2 和 Vue 3 是两个主要版本，虽然它们的核心思想相似，但在 API 和内部实现上有一些差异。
 * 为了确保 Sentry 能够在这两个版本中都正常工作，需要对这两个版本的一些关键特性进行抽象和统一。
 */
export interface Vue {
  config: {
    errorHandler?: any;
    warnHandler?: any;
    silent?: boolean;
  };

  /**
   * mixin 是 Vue 提供的一个全局 API，允许开发者将一些通用的功能混入（mixin）到所有的 Vue 组件中。
   * 这在 Sentry 中可能被用来为所有组件注入一些全局的追踪或错误处理逻辑。
   * @param mixins
   * @returns
   */
  mixin: (mixins: Partial<Record<Hook, any>>) => void;
}

export type ViewModel = {
  _isVue?: boolean;
  __isVue?: boolean;
  $root: ViewModel;
  $parent?: ViewModel;
  $props: { [key: string]: any };
  $options?: {
    name?: string;
    propsData?: { [key: string]: any };
    _componentTag?: string;
    __file?: string;
  };
};

export interface VueOptions extends TracingOptions {
  /** 在 Vue 2 中，这个选项表示 Vue 构造函数，通常通过 import Vue from 'vue' 引入。
   *  在集成过程中，可能需要直接访问这个构造函数。
   */
  Vue?: Vue;

  /**
   * 在 Vue 3 中，应用实例是通过 createApp 创建的。
   * 这个选项允许你传递一个或多个 Vue 应用实例，Sentry 会在这些实例中进行错误跟踪和追踪
   */
  app?: Vue | Vue[];

  /**
   * 当设为 false 时，Sentry 会抑制报告来自 Vue 组件的所有 props 数据。
   * 这是出于隐私保护的考虑。默认情况下，可能是 true，这意味着 Sentry 会将这些数据包括在内
   */
  attachProps: boolean;

  /**
   * 当设为 true 时，Sentry 会在捕获到错误时调用原始的 Vue logError 方法。
   * 这样做可以保留 Vue 内部错误日志的记录，同时确保错误被报告给 Sentry
   * https://github.com/vuejs/vue/blob/c2b1cfe9ccd08835f2d99f6ce60f67b4de55187f/src/core/util/error.js#L38-L48
   */
  logErrors: boolean;

  /**
   * 这是 TracingOptions 的部分配置，用于配置与 Vue 组件生命周期相关的追踪功能
   * {@link TracingOptions}
   */
  tracingOptions?: Partial<TracingOptions>;
}

export interface Options extends BrowserOptions, VueOptions {}

/**
 * TracingOptions 是与 Vue 组件的追踪功能相关的配置。
 * 这个接口让开发者可以控制 Sentry 如何追踪 Vue 组件的生命周期。
 */
export interface TracingOptions {
  /**
   * 这个选项决定是否通过 Vue 组件的生命周期方法来追踪组件。
   * 如果设为 boolean，可以全局启用或禁用所有组件的追踪；如果设为 string[]，则只追踪特定名称的组件
   */
  trackComponents: boolean | string[];

  /**
   * 这是一个等待时间设置。在根活动（root activity）被标记为完成并发送到 Sentry 之前，Sentry 会等待指定的时间。
   * 如果超时，Sentry 会认为活动已经完成并发送数据
   */
  timeout: number;

  /**
   * 这个选项定义了哪些 Vue 生命周期钩子会被追踪
   * 可用的钩子包括：activate、create、destroy、mount、unmount 和 update
   * 这些钩子基于 Vue 的生命周期方法，可以帮助 Sentry 在组件的特定阶段进行性能和错误的追踪。
   * Based on https://vuejs.org/v2/api/#Options-Lifecycle-Hooks
   */
  hooks: Operation[];
}

export type Hook =
  | 'activated'
  | 'beforeCreate'
  | 'beforeDestroy'
  | 'beforeUnmount'
  | 'beforeMount'
  | 'beforeUpdate'
  | 'created'
  | 'deactivated'
  | 'destroyed'
  | 'unmounted'
  | 'mounted'
  | 'updated';

export type Operation =
  | 'activate'
  | 'create'
  | 'destroy'
  | 'mount'
  | 'update'
  | 'unmount';
