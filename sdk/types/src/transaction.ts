/**
 * 这里定义的类型通常用于 Sentry 的性能监控和跟踪功能，帮助开发者理解事务和追踪信息
 */

/**
 * 这个接口用于描述从 sentry-trace 头部提取的数据
 */
export interface TraceparentData {
  /**
   * 追踪 ID，用于唯一标识一个追踪
   * 它可以在分布式系统中跟踪请求的流动，帮助开发者了解请求的完整路径。
   */
  traceId?: string | undefined;

  /**
   * 父级跨度 ID，表示当前跨度的直接父级跨度 ID
   * 跨度（span）是表示操作的时间范围的单位，通常用于描述执行的特定任务或操作。
   */
  parentSpanId?: string | undefined;

  /**
   * 如果当前事务有一个父级事务，这个属性指示父级的采样决策。
   * 它用于确定当前事务是否应被采样，用于收集和记录性能数据。
   */
  parentSampled?: boolean | undefined;
}

/**
 * 这个类型用于描述事务名称的来源，有助于 Sentry 决定是否应对事务名称进行处理（如清理标识符或替换为占位符）
 */
export type TransactionSource =
  /** 用户自定义名称。这表示开发者在代码中手动指定的事务名称 */
  | 'custom'
  /** 原始 URL，可能包含标识符 */
  | 'url'
  /** 参数化的 URL 或路由。这通常指的是定义在路由配置中的路径，可能会替换 URL 中的动态参数 */
  | 'route'
  /** 处理请求的视图名称 */
  | 'view'
  /** Named after a software component, such as a function or class name. */
  | 'component'
  /** 后台任务的名称（例如，Celery 任务）。表示异步或后台执行的任务名称 */
  | 'task';
