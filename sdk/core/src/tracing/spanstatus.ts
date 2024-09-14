import type { Span, SpanStatus } from '@xigua-monitor/types';

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

/**
 * 用于将 HTTP 状态码转换为 Sentry 中的 SpanStatus, 这是一个对象，包含状态码和状态信息。
 * 通过对不同的 HTTP 状态码进行分类，可以帮助 Sentry 更好地追踪请求的结果状态
 *
 * @param httpStatus HTTP 响应状态码
 * @returns 该状态码对应的 Sentry 追踪状态
 */
// https://develop.sentry.dev/sdk/event-payloads/span/
export function getSpanStatusFromHttpCode(httpStatus: number): SpanStatus {
  // 如果状态码在 100 到 399 之间，这些状态码表示请求成功（包括 1xx、2xx、3xx），
  // 返回状态 SPAN_STATUS_OK，即请求成功或被重定向。
  if (httpStatus < 400 && httpStatus >= 100) {
    return { code: SPAN_STATUS_OK };
  }

  // 处理 4xx 状态码（客户端错误）
  if (httpStatus >= 400 && httpStatus < 500) {
    switch (httpStatus) {
      case 401:
        // 未授权
        return { code: SPAN_STATUS_ERROR, message: 'unauthenticated' };
      case 403:
        // 无权限
        return { code: SPAN_STATUS_ERROR, message: 'permission_denied' };
      case 404:
        // 资源未找到
        return { code: SPAN_STATUS_ERROR, message: 'not_found' };
      case 409:
        // 冲突
        return { code: SPAN_STATUS_ERROR, message: 'already_exists' };
      case 413:
        // 请求体过大
        return { code: SPAN_STATUS_ERROR, message: 'failed_precondition' };
      case 429:
        // 请求过多
        return { code: SPAN_STATUS_ERROR, message: 'resource_exhausted' };
      case 499:
        // 客户端取消请求
        return { code: SPAN_STATUS_ERROR, message: 'cancelled' };
      default:
        // 其他 4xx 错误默认为 invalid_argument，表示请求参数无效
        return { code: SPAN_STATUS_ERROR, message: 'invalid_argument' };
    }
  }

  // 处理 5xx 状态码（服务器错误）
  if (httpStatus >= 500 && httpStatus < 600) {
    switch (httpStatus) {
      case 501:
        // 功能未实现
        return { code: SPAN_STATUS_ERROR, message: 'unimplemented' };
      case 503:
        // 服务不可用
        return { code: SPAN_STATUS_ERROR, message: 'unavailable' };
      case 504:
        // 网关超时
        return { code: SPAN_STATUS_ERROR, message: 'deadline_exceeded' };
      default:
        // 其他 5xx 错误默认为 internal_error，表示服务器内部错误
        return { code: SPAN_STATUS_ERROR, message: 'internal_error' };
    }
  }

  // 其他的错误默认为 未知错误
  return { code: SPAN_STATUS_ERROR, message: 'unknown_error' };
}

/**
 * Sets the Http status attributes on the current span based on the http code.
 * Additionally, the span's status is updated, depending on the http code.
 */
export function setHttpStatus(span: Span, httpStatus: number): void {
  span.setAttribute('http.response.status_code', httpStatus);

  const spanStatus = getSpanStatusFromHttpCode(httpStatus);
  if (spanStatus.message !== 'unknown_error') {
    span.setStatus(spanStatus);
  }
}
