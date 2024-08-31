/**
 * 这个状态码表示 Span 的状态未设置或未知
 * 这通常意味着 Span 在创建时未明确指定其状态，可能还没有完成或还没有决定其结果
 * 如果 Span 的状态为SPAN_STATUS_UNSET, 通常不会在 JSON 或日志中显示特定的状态信息。
 */
export const SPAN_STATUS_UNSET = 0;

/**
 * 这个状态码表示 Span 的操作成功完成，没有出现任何错误。
 * 在监控系统中，这是最理想的状态，表明操作按照预期执行。
 * Span 的状态为 SPAN_STATUS_OK，在生成 JSON 表示时会使用字符串 'ok' 来描述该状态。
 */
export const SPAN_STATUS_OK = 1;
/**
 * 这个状态码表示 Span 的操作遇到错误或失败
 * 这通常用于标识操作过程中出现的问题，在追踪系统中用于帮助开发者或运维人员识别和修复错误。
 * 对应的 status.message 可能包含更详细的错误信息；
 * 如果没有提供详细信息，可能会使用默认的 'unknown_error' 来表示。
 */
export const SPAN_STATUS_ERROR = 2;
