import type {
  Client,
  Integration,
  MetricsAggregator,
  Scope,
} from '@xigua-monitor/types';
import { GLOBAL_OBJ, SDK_VERSION } from '@xigua-monitor/utils';
import type { AsyncContextStack } from './asyncContext/stackStrategy';
import type { AsyncContextStrategy } from './asyncContext/types';

/**
 * An object that contains globally accessible properties and maintains a scope stack.
 * @hidden
 */
export interface Carrier {
  __SENTRY__?: VersionedCarrier;
}

/**
 * 包含了一个可选的 version 字段，以及任意数量的 SentryCarrier 实例
 * 这个结构使得可以为每个不同版本的 Sentry SDK 实例存储独立的状态
 */
type VersionedCarrier = {
  version?: string;
} & Record<Exclude<string, 'version'>, SentryCarrier>;

/**
 * 实际保存 Sentry SDK 实例状态的对象
 */
interface SentryCarrier {
  // 存储一个 AsyncContextStrategy 实例，用于管理异步上下文
  acs?: AsyncContextStrategy;
  // 存储 AsyncContextStack，表示上下文堆栈
  stack?: AsyncContextStack;

  // 下面这些字段存储不同级别的作用域信息
  globalScope?: Scope;
  defaultIsolationScope?: Scope;
  defaultCurrentScope?: Scope;

  // 一个 WeakMap，用于聚合全局度量数据
  globalMetricsAggregators?: WeakMap<Client, MetricsAggregator> | undefined;

  // 这些属性在 v8 中曾经使用过，但在 v9 中计划移除
  integrations?: Integration[];
  extensions?: {
    // eslint-disable-next-line @typescript-eslint/ban-types
    [key: string]: Function;
  };
}

/**
 * 在 Sentry 中，Carrier 是一个全局对象，通常是浏览器中的 window 对象或 Node.js 中的 global 对象，
 * 它包含所有与 Sentry 相关的状态和配置信息。载体中会存储 Scope、Hub、Client 等对象，它们共同管理 Sentry 的行为和状态。
 *
 * 因为 __SENTRY__ 属性是可选的，所以在使用它的地方通常需要检查该属性是否存在。
 * 这会导致代码中多处需要进行相同的非必要检查，增加了代码复杂性和冗余性。
 * 既然所有访问 Carrier 的地方都通过 getMainCarrier 函数，
 * 那么这个函数应该确保 __SENTRY__ 属性始终存在，这样可以避免其他地方再进行这些检查。
 **/
export function getMainCarrier(): Carrier {
  //  确保 GLOBAL_OBJ 对象上存在 Sentry 载体属性 __SENTRY__
  // 这个函数会检查全局对象上是否存在 Sentry 的载体，如果不存在，则会创建并初始化它
  getSentryCarrier(GLOBAL_OBJ);

  // 返回全局对象 GLOBAL_OBJ，这个对象在 Sentry 中充当载体，用于在应用程序的各个部分之间传递和共享 Sentry 的状态信息
  return GLOBAL_OBJ;
}

/**
 * 这个函数用于获取现有的 Sentry 载体（Carrier），或者在没有载体时创建一个新的载体对象
 * 这个载体对象保存了与 Sentry SDK 相关的状态和配置信息
 *
 * @param carrier
 * @returns
 */
export function getSentryCarrier(carrier: Carrier): SentryCarrier {
  // 检查传入的 carrier 对象是否有 __SENTRY__ 属性，没有的话会初始化一个空对象
  const __SENTRY__ = (carrier.__SENTRY__ = carrier.__SENTRY__ || {});

  // 这个版本号表示当前 Sentry SDK 的版本。
  // 由于可能存在多个 Sentry SDK 实例在同一环境中运行，这行代码确保最早设置的版本号保留
  // 检查 __SENTRY__ 对象上是否已有 version 属性，如果没有会使用当前版本号
  __SENTRY__.version = __SENTRY__.version || SDK_VERSION;

  // 这行代码确保了不同版本的 Sentry SDK 可以在同一载体上共存，每个 SDK 版本都有自己的存储空间。
  // __SENTRY__[1.0.0] 是 1.0.0 版本的载体对象
  // __SENTRY__[2.0.0] 是 2.0.0 版本的载体对象
  // 通过这种方式，每个 SDK 实例可以安全地存储和访问自己的信息，而不必担心被其他版本的实例影响
  return (__SENTRY__[SDK_VERSION] = __SENTRY__[SDK_VERSION] || {});
}
