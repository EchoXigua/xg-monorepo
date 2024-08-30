import type { Mechanism } from './mechanism';
import type { Stacktrace } from './stacktrace';

/**
 * 主要作用是存储和传递关于异常的详细信息，以便在错误报告和日志系统中能够提供丰富的上下文，帮助开发者快速定位和解决问题
 */
export interface Exception {
  /**
   * 表示异常的类型，通常是异常类的名称或错误的标识符
   * 例如，对于 JavaScript 的异常，这个字段可能包含 "TypeError"、"ReferenceError" 等
   */
  type?: string;
  /**
   * 表示异常的具体值或描述信息，通常是抛出错误时提供的消息
   * 例如，"Cannot read property 'x' of undefined" 是一个常见的错误消息
   */
  value?: string;
  /**
   * 表示异常的捕获机制，即解释这个异常是如何被捕获的
   * Mechanism 接口可以包含异常的处理方式、数据来源、是否为合成异常等信息，这对理解异常的上下文和可能的原因非常有帮助
   */
  mechanism?: Mechanism;
  /**
   * 表示异常发生的模块或库的名称
   * 例如，在大型项目中，异常可能来自于某个特定的库或模块，这个字段有助于隔离问题的来源
   */
  module?: string;
  /**
   * 表示异常发生时所在的线程 ID
   * 在多线程或并发环境中，这个信息可以帮助开发者确定异常发生在哪个线程上
   */
  thread_id?: number;
  /**
   * 表示与异常关联的堆栈跟踪信息
   * Stacktrace 详细记录了异常发生时的调用堆栈，帮助开发者追溯到异常的根源。
   */
  stacktrace?: Stacktrace;
}
