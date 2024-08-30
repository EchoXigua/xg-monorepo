/**
 * 接口为异常的捕获方式提供了详细的元数据，使得 Sentry 能够更好地分类和展示异常。
 * 这对于理解异常是如何以及在何时发生的，以及异常之间的关系（如聚合错误）都非常重要。
 * 这些信息不仅有助于调试，还能帮助开发者更好地追踪和处理异常。
 */
export interface Mechanism {
  /**
   * 描述了异常捕获的方式。目前的值主要包括:
   * - onerror: 通过 window.onerror 捕获的错误
   * - onunhandledrejection: 通过 window.onunhandledrejection 捕获的未处理 Promise 拒绝
   * - instrument: 由自动监控（auto-instrumentation）生成的错误
   * - generic: 其他所有方式捕获的错误
   *
   * 在数据摄取时，此字段会被转换为一个标签。
   */
  type: string;

  /**
   * 指示异常是否已被用户处理或自动监控所处理。这个字段可以帮助判断异常在何时被捕获，如在全局错误处理之前或之后
   *
   * 该字段在 UI 中有多种用途，并在摄取时转换为标签
   */
  handled?: boolean;

  /**
   * 与机制相关的任意数据，通常用于存储一些与异常捕获机制有关的额外信息
   * 例如，事件处理器生成的错误可能会包含处理器名称和事件目标
   */
  data?: {
    [key: string]: string | boolean;
  };

  /**
   * 当 captureException 被调用时，如果传递的不是 Error 实例（或类似的浏览器对象，
   * 如 ErrorEvent, DOMError, DOMException），此字段会被设置为 true。
   * 这表示 Sentry 创建了一个合成的错误，以便重现堆栈追踪信息。
   */
  synthetic?: boolean;

  /**
   * 描述异常的来源，特别是在异常是派生的（例如链接的或聚合的）情况下。
   *
   * 这个字段应包含异常在父异常中的属性名称，如 "cause", "errors[0]", "errors[1]" 等。
   */
  source?: string;

  /**
   * 指示异常是否为 AggregateException，即是否为一组异常的一部分。
   */
  is_exception_group?: boolean;

  /**
   * 在 event.exception.values 数组中的异常标识符。此标识符用于标识和引用特定的异常，特别是在处理聚合或链接错误时。
   */
  exception_id?: number;

  /**
   * 引用另一个异常的 exception_id，用于指示当前异常是该异常的子异常，尤其是在聚合或链接错误的情况下。
   */
  parent_id?: number;
}
