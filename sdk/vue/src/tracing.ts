import {
  SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN,
  getActiveSpan,
  startInactiveSpan,
} from '@xigua-monitor/browser';
import type { Span } from '@xigua-monitor/types';
import { logger, timestampInSeconds } from '@xigua-monitor/utils';

import { DEFAULT_HOOKS } from './constants';
import { DEBUG_BUILD } from './debug-build';
import type { Hook, Operation, TracingOptions, ViewModel, Vue } from './types';
import { formatComponentName } from './vendor/components';

/** 用于标识 Vue 操作 */
const VUE_OP = 'ui.vue';

/** 提取 Vue 的 mixin 方法的参数类型，这样可以在后续代码中方便地使用 */
type Mixins = Parameters<Vue['mixin']>[0];

interface VueSentry extends ViewModel {
  readonly $root: VueSentry;
  // 存储与当前组件相关的 Sentry spans
  $_sentrySpans?: {
    [key: string]: Span | undefined;
  };
  // 表示根 span，可能用于跟踪整个组件树的活动
  $_sentryRootSpan?: Span;
  // 用于存储 setTimeout 的返回值，方便在后续操作中清除定时器
  $_sentryRootSpanTimer?: ReturnType<typeof setTimeout>;
}

/**
 * 定义了 Vue 生命周期钩子的名称，这些钩子与 Sentry 监控的操作（Operation）相对应
 */
const HOOKS: { [key in Operation]: Hook[] } = {
  activate: ['activated', 'deactivated'],
  create: ['beforeCreate', 'created'],
  // Vue 3
  unmount: ['beforeUnmount', 'unmounted'],
  // Vue 2
  destroy: ['beforeDestroy', 'destroyed'],
  mount: ['beforeMount', 'mounted'],
  update: ['beforeUpdate', 'updated'],
};

/**
 * 该函数用于结束根 span
 *
 * @param vm 当前 Vue 组件实例
 * @param timestamp  用于结束 span 的时间戳
 * @param timeout 延迟时间，用于防抖行为
 */
function finishRootSpan(
  vm: VueSentry,
  timestamp: number,
  timeout: number,
): void {
  // 如果存在之前的定时器,则清除掉
  if (vm.$_sentryRootSpanTimer) {
    clearTimeout(vm.$_sentryRootSpanTimer);
  }

  // 设置新的定时器(防抖)
  vm.$_sentryRootSpanTimer = setTimeout(() => {
    // 检查根实例 $root 是否存,以及是否有 $_sentryRootSpan
    if (vm.$root && vm.$root.$_sentryRootSpan) {
      // 结束这个 span，并将其重置为 undefined
      vm.$root.$_sentryRootSpan.end(timestamp);
      vm.$root.$_sentryRootSpan = undefined;
    }
  }, timeout);
}

/**
 * 这个函数用于创建与 Sentry 监控系统集成的 Vue.js mixins
 * 目的是在 Vue 组件的生命周期中实现跟踪，以便收集性能和错误数据
 *
 * @param options
 * @returns
 */
export const createTracingMixins = (options: TracingOptions): Mixins => {
  // 配置项中的自定义钩子与默认钩子函数合并,然后过滤掉重复的钩子
  const hooks = (options.hooks || [])
    .concat(DEFAULT_HOOKS)
    .filter((value, index, self) => self.indexOf(value) === index);

  // 用于存放 Vue 生命周期钩子的实现
  const mixins: Mixins = {};

  // 遍历每个操作钩子
  for (const operation of hooks) {
    // eg. mount => ['beforeMount', 'mounted']
    // 查找对应的 Vue 生命周期钩子
    const internalHooks = HOOKS[operation];
    if (!internalHooks) {
      // 如果找不到对应的内部钩子，则记录警告并跳过
      DEBUG_BUILD && logger.warn(`Unknown hook: ${operation}`);
      continue;
    }

    // 对于每个内部钩子，创建一个函数实现并赋值给 mixins。
    for (const internalHook of internalHooks) {
      mixins[internalHook] = function (this: VueSentry) {
        // 判断当前 Vue 实例是否为根实例
        const isRoot = this.$root === this;

        if (isRoot) {
          // 当前是根组件

          // 获取当前活跃的 span
          const activeSpan = getActiveSpan();
          if (activeSpan) {
            // 存在活跃的 span
            // 初始化根 span，记录应用渲染
            this.$_sentryRootSpan =
              this.$_sentryRootSpan ||
              startInactiveSpan({
                name: 'Application Render',
                op: `${VUE_OP}.render`,
                attributes: {
                  [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.ui.vue',
                },
              });
          }
        }

        // 跳过我们不想跟踪的组件，以最小化噪声，并给用户更细粒度的控制
        // 获取当前组件的名称
        const name = formatComponentName(this, false);
        // 根据配置项 options.trackComponents 决定是否跟踪当前组件
        const shouldTrack = Array.isArray(options.trackComponents)
          ? options.trackComponents.indexOf(name) > -1
          : options.trackComponents;

        // 如果当前实例不是根实例且不需要跟踪，则直接返回
        if (!isRoot && !shouldTrack) {
          return;
        }

        // 初始化 $_sentrySpans 对象，存储与当前组件相关的 spans
        this.$_sentrySpans = this.$_sentrySpans || {};

        // 如果当前钩子是“before”钩子，说明这是开始一个新的操作的时机，则开始一个新的span
        // 否则，检索当前span并完成它。
        if (internalHook == internalHooks[0]) {
          // 从根 Vue 实例或当前活动的 span 中获取
          // 目的是确认是否有正在进行的活动 span，以便进行新的 span 管理
          const activeSpan =
            (this.$root && this.$root.$_sentryRootSpan) || getActiveSpan();

          if (activeSpan) {
            // 如果存在活动的 span，接下来检查是否已经有与当前操作相关的旧 span
            // 这一步非常重要，因为如果前一个钩子没有正常结束其 span，可能会导致 spans 重复或未被正确记录。
            // 为避免这种情况，我们主动结束这个旧的 span。

            // 实际上这里不确定是否会有清理钩子没有被调用的情况
            // 所以我们在开始一个新的span之前去主动结束这个旧的span，只是为了确保
            const oldSpan = this.$_sentrySpans[operation];
            if (oldSpan) {
              oldSpan.end();
            }

            // 在结束旧 span 后，启动一个新的 span，使用 startInactiveSpan 函数
            this.$_sentrySpans[operation] = startInactiveSpan({
              name: `Vue <${name}>`, // 当前组件的名称
              op: `${VUE_OP}.${operation}`, // 操作的类型（例如 ui.vue.mount）
              attributes: {
                [SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN]: 'auto.ui.vue',
              },
            });
          }
        } else {
          // 如果当前钩子不是前置钩子，意味着它是对应的“后置”钩子（如 mounted）

          // 这种情况下，我们首先尝试从 this.$_sentrySpans[operation] 中获取当前操作的 span。
          const span = this.$_sentrySpans[operation];
          // 如果没有找到 span（即可能在前置钩子中没有开始跟踪），则直接返回，不执行后续逻辑
          if (!span) return;
          // 如果找到了 span，则调用 span.end() 来结束这个 span
          span.end();

          // 调用 finishRootSpan 来结束根 span，这样做是为了确保根 span 在所有子 span 结束后被正确地处理。
          finishRootSpan(this, timestampInSeconds(), options.timeout);
        }
      };
    }
  }

  return mixins;

  // 函数创建了 Vue 组件的生命周期钩子，以便与 Sentry 进行性能跟踪和监控。
  // 它允许开发者自定义跟踪的钩子，提供了组件跟踪的灵活性，并确保在组件的生命周期中有效地启动和结束 spans。
  // 这种集成有助于捕获和分析 Vue 应用的性能问题和错误，为开发者提供了重要的可观测性。
};
