import type { SeverityLevel } from './severity';

/**
 * Sentry 使用面包屑来创建一条事件轨迹，这些事件是在某个问题发生之前发生的。
 * 换句话说，面包屑记录了导致错误或异常发生的相关操作和状态，这样可以帮助开发者回溯并分析问题的根源。
 *
 * 面包屑与传统日志记录非常相似，都是记录应用程序中的事件或操作。但与传统的日志记录相比，面包屑可以捕获更丰富、结构化的数据。
 * 传统的日志通常只是文本或简单的消息，而面包屑可以包括更详细的信息，例如事件的类型、严重性、类别、时间戳以及与事件相关的上下文数据等。
 *
 * @link https://develop.sentry.dev/sdk/event-payloads/breadcrumbs/
 */
export interface Breadcrumb {
  /**
   * 默认情况下，所有面包屑都会被记录为 default 类型，这意味着它们在 Sentry 的用户界面中会显示为 Debug（调试）条目
   *
   * Sentry 提供了其他类型的面包屑，这些类型会影响面包屑在 Sentry 中的呈现方式。
   * 例如，不同的类型可能会在用户界面中使用不同的颜色、图标或布局来显示。
   * 通过设置不同的类型，可以使特定类型的事件在调试或错误分析时更加突出。
   *
   *
   * @summary The type of breadcrumb.
   * @link https://develop.sentry.dev/sdk/event-payloads/breadcrumbs/#breadcrumb-types
   */
  type?: string;

  /**
   * 是面包屑的严重性级别，允许的值从高到低依次是：fatal、error、warning、info 和 debug
   * 级别用于在 UI 中强调或减弱面包屑的显示。默认值是 info
   *
   * @summary This defines the severity level of the breadcrumb.
   */
  level?: SeverityLevel;

  event_id?: string;

  /**
   *
   * category 属性通常用于描述面包屑的来源或类型。它通常是一个模块名或者描述性字符串。
   * 例如，ui.click 可以表示用户界面中的一次点击事件，或者 flask 可以表示事件源自 Flask 框架。
   *
   * 在 Sentry 内部，根据提供的 category 值，某些面包屑的颜色和图标可能会有所不同。
   * 这意味着 Sentry 会根据类别在用户界面中以不同方式显示这些事件，从而帮助开发者更直观地了解事件的性质和来源。
   *
   * @private Internally we render some crumbs' color and icon based on the provided category.
   *          For more information, see the description of recognized breadcrumb types.
   * @summary A dotted string indicating what the crumb is or from where it comes.
   * @link    https://develop.sentry.dev/sdk/event-payloads/breadcrumbs/#breadcrumb-types
   */
  category?: string;

  /**
   * 面包屑的可读消息，作为文本呈现，保留所有空白字符
   *
   * @summary Human-readable message for the breadcrumb.
   */
  message?: string;

  /**
   * data 属性包含了与面包屑相关的任意数据。数据的内容依赖于面包屑的类型。每种面包屑类型可能会需要不同的额外参数
   *
   * 对于不受面包屑类型支持的附加参数，这些数据会以键值对的形式在 Sentry 中呈现，方便开发者查看相关信息。
   * 这允许开发者记录与面包屑事件相关的详细上下文信息，从而在事件发生时捕获更完整的背景。
   *
   * @summary Arbitrary data associated with this breadcrumb.
   */
  data?: { [key: string]: any };

  /**
   * 属性用于记录面包屑发生的时间。其格式为自 Unix 纪元以来经过的秒数（可以是整数或浮点数）。
   * 这个时间戳非常重要，因为它可以创建一个事件时间线，帮助开发者理解错误或异常发生之前的事件顺序。
   *
   * @note The API supports a string as defined in RFC 3339, but the SDKs only support a numeric value for now.
   *
   * @summary A timestamp representing when the breadcrumb occurred.
   * @link https://develop.sentry.dev/sdk/event-payloads/breadcrumbs/#:~:text=is%20info.-,timestamp,-(recommended)
   */
  timestamp?: number;
}

/**
 * 一个通用的接口，它允许使用任意键值对的形式存储数据。
 * 其目的是在创建或处理面包屑（Breadcrumb）时，传递额外的上下文或元数据。
 *
 * 当记录某些操作的面包屑时，如果需要携带额外的自定义数据，可以通过这个接口进行传递。
 * 由于它是一个开放的类型，开发者可以根据需求添加任何键值对
 */
export interface BreadcrumbHint {
  [key: string]: any;
}

/**
 * 定义了与 fetch 请求相关的数据结构
 * 当使用 fetch 进行网络请求时，可以将这些数据记录为面包屑，以便在错误发生时有更多上下文信息用于分析问题。
 */
export interface FetchBreadcrumbData {
  method: string;
  url: string;
  /**
   * 请求响应的状态码（如 200, 404）
   */
  status_code?: number;
  /**
   * 请求体的大小（以字节为单位）
   */
  request_body_size?: number;
  /**
   * 响应体的大小（以字节为单位）
   */
  response_body_size?: number;
}

/**
 * 定义了与 XMLHttpRequest (XHR) 请求相关的数据结构。
 * 当使用 XMLHttpRequest 进行网络请求时，可以记录这些信息以便在发生问题时进行诊断。
 */
export interface XhrBreadcrumbData {
  method?: string;
  url?: string;
  status_code?: number;
  request_body_size?: number;
  response_body_size?: number;
}

/**
 * 用于记录与 fetch 请求相关的详细信息。
 * 通过记录请求的输入、响应和时间戳，开发者可以在发生错误时更轻松地进行分析。
 */
export interface FetchBreadcrumbHint {
  /**
   * 通常用于存储与 fetch 请求相关的输入数据。例如，它可以包含请求的 URL、请求选项（如请求头、请求体等）。
   */
  input: any[];
  /**
   * 表示与请求相关的任意数据。这个字段可以用于存储请求过程中附加的元数据。
   */
  data?: unknown;
  /**
   * 表示与请求的响应相关的数据。可以是响应体、状态码等信息。
   */
  response?: unknown;
  /**
   *  请求开始时的时间戳
   */
  startTimestamp: number;
  /**
   * 请求结束时的时间戳
   */
  endTimestamp: number;
}

/**
 * 用于记录与 XMLHttpRequest 请求相关的详细信息。
 * 通过记录 XHR 实例、请求输入和时间戳，开发者可以在发生问题时获取更具体的上下文。
 */
export interface XhrBreadcrumbHint {
  /**
   * 表示与 XMLHttpRequest 请求相关的对象，通常是 XHR 实例本身
   */
  xhr: unknown;
  /**
   * 表示请求的输入信息，可以是请求的 URL 或请求的选项
   */
  input: unknown;
  /**
   * 请求开始时的时间戳
   */
  startTimestamp: number;
  /**
   * 请求结束时的时间戳
   */
  endTimestamp: number;
}
