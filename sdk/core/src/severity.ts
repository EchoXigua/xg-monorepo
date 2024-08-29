/**
 * 表示日志或事件的严重程度。该类型包含了一些常见的严重程度级别，
 * 如致命错误、错误、警告、日志信息、调试信息等。
 *
 * 如果修改了 SeverityLevel 类型中的任何值，开发者还需要同步更新 @sentry/utils 模块中的 validSeverityLevels 数组。
 * 可能因为 validSeverityLevels 在代码中使用了某种特定方式（如硬编码或依赖于特定顺序），导致无法自动从 SeverityLevel 类型派生。
 */
export type SeverityLevel =
  | 'fatal'
  | 'error'
  | 'warning'
  | 'log'
  | 'info'
  | 'debug';
