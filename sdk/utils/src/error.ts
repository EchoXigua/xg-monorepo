import type { ConsoleLevel } from '@xigua-monitor/types';

/**
 * 一个自定义的错误类，用于表示由 Sentry SDK 或相关工具发出的错误。它继承自 js 的内置 Error 类，
 * 并添加了一些额外的功能和属性，如 logLevel，用于控制错误的日志级别。
 */
export class SentryError extends Error {
  /** 显示此错误实例的名称,它的值为当前类的名称，即 SentryError */
  public name: string;

  /** 日志级别 */
  public logLevel: ConsoleLevel;

  public constructor(
    public message: string,
    logLevel: ConsoleLevel = 'warn',
  ) {
    super(message);

    this.name = new.target.prototype.constructor.name;

    /**
     * 如果这一行被注释掉，this 的原型不会被正确地设置为 SentryError，而是可能会变成 Error 的原型。
     * 这可能导致一些不一致的行为.注释掉这行代码后，会导致 Playwright 测试超时。虽然原因不明确，
     * 但可能与 js 中的原型链有关。因为原型的正确设置是确保对象正确工作的重要一环，尤其是在涉及到继承和类型检查时。
     * 如果这一行被注释掉，那么 SentryError 的实例将无法通过 instanceof 操作符检查其类型
     * 这是因为 instanceof 检查的是对象的原型链。
     * 如果原型没有正确设置，JavaScript 将无法识别 SentryError 作为实例的类型
     *
     * 在许多情况下，即使注释掉这行代码,instanceof 也能正常工作
     */

    // 这行代码的目的是将当前实例 this 的原型设置为 SentryError 的原型
    Object.setPrototypeOf(this, new.target.prototype);
    this.logLevel = logLevel;
  }
}
