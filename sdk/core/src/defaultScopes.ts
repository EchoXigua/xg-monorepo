import type { Scope } from '@xigua-monitor/types';
import { getGlobalSingleton } from '@xigua-monitor/utils';
import { Scope as ScopeClass } from './scope';

/**
 * 在应用监控工具（如 Sentry）中，作用域（Scope） 是一个非常重要的概念。
 * 作用域用于在捕获事件时存储上下文信息，如用户信息、标签、上下文等。
 * 每个作用域可以独立维护一组上下文，这使得在不同的异步任务中，能够正确地记录和追踪应用的状态和行为。
 */

/**
 * getGlobalSingleton 是一个通用的单例模式获取函数，它接受两个参数：
 *   - key：全局环境中的键，getGlobalSingleton 会检查这个键是否已经存在。
 *   - initializer：一个初始化函数，当指定的键不存在时，会调用这个初始化函数来创建对象。
 */

/**
 * 获取默认的当前作用域,它记录当前应用状态下的上下文信息。
 *
 * @returns
 */
export function getDefaultCurrentScope(): Scope {
  return getGlobalSingleton('defaultCurrentScope', () => new ScopeClass());
}

/**
 * 表示隔离的作用域，可能用于在特定环境下或者在隔离任务中保存独立的上下文，避免与全局上下文混淆。
 */
export function getDefaultIsolationScope(): Scope {
  return getGlobalSingleton('defaultIsolationScope', () => new ScopeClass());
}
