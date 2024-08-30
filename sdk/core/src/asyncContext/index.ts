import type { Carrier } from './../carrier';
import { getMainCarrier, getSentryCarrier } from './../carrier';
import { getStackAsyncContextStrategy } from './stackStrategy';
import type { AsyncContextStrategy } from './types';

/**
 * 在异步环境中，保持错误、日志等上下文信息的一致性尤为重要。这就是 异步上下文策略
 * 该函数是用来设置一个全局的异步上下文策略。这个策略会影响到整个应用在异步操作中如何处理上下文。
 *
 * @param strategy  如果是 undefined，表示取消当前的策略。
 *
 * @private Private API with no semver guarantees!
 *
 */
export function setAsyncContextStrategy(
  strategy: AsyncContextStrategy | undefined,
): void {
  // 获取一个全局的 Carrier 对象，这个对象在所有环境中都是全局可访问的
  // 用于存储和共享 Sentry 的一些重要状态信息。
  const registry = getMainCarrier();

  // 确保 Carrier 对象中有一个 Sentry 专用的载体（SentryCarrier），这个载体包含了 Sentry SDK 的一些全局信息和状态。
  const sentry = getSentryCarrier(registry);

  // 将传入的 strategy 赋值给 sentry.acs，这个 acs 就是 Sentry 专用载体中的异步上下文策略
  // 这意味着接下来 Sentry 在处理异步操作时，将使用这个策略来管理上下文
  sentry.acs = strategy;
}

/**
 * 该函数用于获取当前的异步上下文策略。如果之前已经设置了策略，它就会返回这个策略；
 * 如果没有设置，就返回一个默认的策略。
 */
export function getAsyncContextStrategy(
  carrier: Carrier,
): AsyncContextStrategy {
  // 获取或初始化 Sentry 的载体
  const sentry = getSentryCarrier(carrier);

  // 如果载体中已经存在一个异步上下文策略（sentry.acs），那么直接返回这个策略。
  if (sentry.acs) {
    return sentry.acs;
  }

  // 返回一个默认的异步上下文策略。
  // 这个默认的通常是基于堆栈的上下文管理策略。这个策略适用于大多数情况，因为它能够很好地管理和维护异步操作中的上下文堆栈。
  return getStackAsyncContextStrategy();
}
