/** 定义了一个请求的相关信息 */
export interface Request {
  // 请求的 URL
  url?: string;
  // 请求的方法
  method?: string;
  // 请求体中的数据，通常用于 POST 或 PUT 请求
  data?: any;
  // 查询参数，可以是字符串、对象或数组。表示 URL 中 ? 后面的部分，包含键值对形式的参数。
  query_string?: QueryParams;
  // 请求中包含的 cookies
  cookies?: { [key: string]: string };
  // 环境变量，可以用于存储请求处理中的环境信息，格式为键值对
  env?: { [key: string]: string };
  /**
   *  请求的头部信息，表示附加在请求中的元数据，例如 Content-Type、Authorization 等，格式为键值对
   */
  headers?: { [key: string]: string };
}

// 用于定义查询参数的格式
export type QueryParams =
  | string
  | { [key: string]: string }
  // 元组
  | Array<[string, string]>;

/**
 * 用于表示一些经过清洗的请求数据，通常用于 HTTP 客户端的跨度数据（span.data）和 HTTP 面包屑（breadcrumbs）
 *
 * 1. 安全请求数据: 该请求数据被认为是安全的，适合用于 http.client 的跨度（span）数据和 HTTP 面包屑（breadcrumbs）
 * 2. span.data 和 http.client:
 *    - 在 Sentry 的上下文中，跨度是用于跟踪和记录某个操作（例如 HTTP 请求）的时间和性能数据的结构
 *    - http.client 是一个表示客户端 HTTP 请求的跨度类型
 *    - span.data 是用于存储与该请求相关的额外信息的字段
 *
 * 3. HTTP 面包屑（breadcrumbs）: 面包屑是 Sentry 中用于记录用户操作和事件的机制，
 * 帮助开发人员理解在错误发生之前的上下文。面包屑可以包括 HTTP 请求、用户交互、系统事件等信息
 *
 * See https://develop.sentry.dev/sdk/data-handling/#structuring-data
 */
export type SanitizedRequestData = {
  // 请求的 URL
  url: string;
  // 请求的方法
  'http.method': string;
  // 请求的片段标识符（如果存在），即 URL 中 # 后的部分
  'http.fragment'?: string;
  // 请求的查询字符串，通常是 URL 中 ? 后的参数部分
  'http.query'?: string;
};
