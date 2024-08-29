import type { Primitive } from './misc';
import type { SpanOrigin } from './span';

/**
 * 一个通用的键值对对象，键是字符串，值的类型是 unknown。
 * 这意味着可以在上下文中包含任何类型的数据，但具体的数据结构不作限制。
 *
 * 用于存储任意的上下文信息，例如用户行为、请求参数等
 */
export type Context = Record<string, unknown>;

/**
 * 接口扩展了一个记录类型,可以添加任意上下文信息。
 */
export interface Contexts extends Record<string, Context | undefined> {
  /**
   * 表示应用上下文
   */
  app?: AppContext;
  /**
   * 表示设备上下文
   */
  device?: DeviceContext;
  /**
   * 表示操作系统上下文
   */
  os?: OsContext;
  /**
   * 表示文化或地区上下文
   */
  culture?: CultureContext;
  /**
   * 表示响应上下文
   */
  response?: ResponseContext;
  /**
   * 表示追踪上下文
   */
  trace?: TraceContext;
  /**
   * 表示云资源上下文
   */
  cloud_resource?: CloudResourceContext;
  /**
   * 表示状态上下文
   */
  state?: StateContext;
  /**
   * 表示用户配置文件上下文
   */
  profile?: ProfileContext;
}

/**
 * 可以用于表示应用程序中的某个状态，例如用户的登录状态、表单状态等，提供额外的信息以供分析和调试。
 */
export interface StateContext extends Record<string, unknown> {
  state: {
    // 表示状态的类型
    type: string;
    // 存储与状态相关的具体值
    value: Record<string, unknown>;
  };
}

/**
 * 用于监控应用程序的运行状态和资源使用情况，帮助开发者优化性能和解决内存问题。
 */
export interface AppContext extends Record<string, unknown> {
  /**
   *  应用程序的名称
   */
  app_name?: string;
  /**
   *  应用程序的启动时间
   */
  app_start_time?: string;
  /**
   * 应用程序的版本号
   */
  app_version?: string;
  /**
   *  应用程序的唯一标识符
   */
  app_identifier?: string;
  /**
   * 应用程序的构建类型（例如，开发、生产等）
   */
  build_type?: string;
  /**
   * 应用程序当前使用的内存
   */
  app_memory?: number;
  /**
   * 应用程序可用的内存
   */
  free_memory?: number;
}

/**
 * Sentry 能够收集到设备的丰富上下文信息，这对于问题诊断和性能监控至关重要。
 * 了解设备的型号、状态、存储和内存等信息，可以帮助开发者更好地理解错误发生的环境，从而更有效地优化应用程序和提升用户体验。
 */
export interface DeviceContext extends Record<string, unknown> {
  /** 设备基本信息 --------------------------------------------------------------*/
  // 设备的名称（例如，iPhone、Galaxy S10）
  name?: string;
  // 设备系列（例如，iPhone、Android）
  family?: string;
  // 设备模型（例如，iPhone 12、Pixel 5）
  model?: string;
  // 设备模型的唯一标识符
  model_id?: string;
  // 设备的体系结构（例如，arm、x86）
  arch?: string;

  /** 电池信息 --------------------------------------------------------------*/
  // 当前电池电量（0 到 100 的数字）
  battery_level?: number;
  // 电池状态（例如，充电中、放电中）
  battery_status?: string;
  // 设备是否正在充电（布尔值）
  charging?: boolean;

  manufacturer?: string;
  brand?: string;

  /** 屏幕信息 --------------------------------------------------------------*/
  // 当前屏幕方向（portrait 或 landscape）
  orientation?: 'portrait' | 'landscape';
  // 屏幕分辨率（例如，1920x1080）
  screen_resolution?: string;
  // 屏幕高度（以像素为单位）
  screen_height_pixels?: number;
  // 屏幕宽度（以像素为单位）
  screen_width_pixels?: number;
  // 屏幕密度（例如，160、320）
  screen_density?: number;
  // 屏幕每英寸的点数（DPI）
  screen_dpi?: number;

  /** 存储和内存信息 --------------------------------------------------------------*/
  // 设备的总内存大小（以字节为单位）
  memory_size?: number;
  // 可用内存
  free_memory?: number;
  // 可用内存
  usable_memory?: number;
  // 设备的总存储大小
  storage_size?: number;
  // 可用存储大小
  free_storage?: number;
  // 外部存储总大小
  external_storage_size?: number;
  // 外部存储可用大小
  external_free_storage?: number;

  /** 处理器信息 --------------------------------------------------------------*/
  // 设备的处理器数量
  processor_count?: number;
  // 处理器的描述（例如，Intel Core i7）
  cpu_description?: string;
  // 处理器频率（以 GHz 为单位）
  processor_frequency?: number;

  /** 设备其他信息 --------------------------------------------------------------*/
  // 设备是否在线
  online?: boolean;
  // 设备是否处于低内存状态
  low_memory?: boolean;
  // 是否在模拟器上运行
  simulator?: boolean;
  // 设备启动时间
  boot_time?: string;
  // 设备类型（例如，手机、平板、桌面）
  device_type?: string;
  // 设备的唯一标识符
  device_unique_identifier?: string;
  // 是否支持震动
  supports_vibration?: boolean;
  // 是否支持加速度计
  supports_accelerometer?: boolean;
  // 是否支持陀螺仪
  supports_gyroscope?: boolean;
  // 是否支持音频
  supports_audio?: boolean;
  // 是否支持定位服务
  supports_location_service?: boolean;
}

/**
 * 可以帮助开发者了解应用程序运行的操作系统环境，方便排查与操作系统相关的问题。
 */
export interface OsContext extends Record<string, unknown> {
  // 操作系统的名称（例如，Windows、Linux等）
  name?: string;
  // 操作系统的版本号
  version?: string;
  // 操作系统的构建号
  build?: string;
  // 操作系统的内核版本
  kernel_version?: string;
}

/**
 * 可用于帮助国际化（i18n）应用程序，确保在不同文化和地区中正确显示时间和日期等信息。
 */
export interface CultureContext extends Record<string, unknown> {
  // 使用的日历系统（例如，公历、农历等）
  calendar?: string;
  // 文化的显示名称（例如，“英语（美国）”）
  display_name?: string;
  //  语言环境标识符（例如，“en-US”）
  locale?: string;
  //  是否使用24小时格式。
  is_24_hour_format?: boolean;
  // 时区信息
  timezone?: string;
}

/**
 * 可以用于监控 API 响应的性能和内容，帮助开发者分析请求和响应的行为。
 */
export interface ResponseContext extends Record<string, unknown> {
  // 响应类型（例如，JSON、HTML等）
  type?: string;
  // 响应中包含的 Cookie，可以是二维数组或对象格式
  cookies?: string[][] | Record<string, string>;
  // 响应头部信息
  headers?: Record<string, string>;
  //  HTTP 状态码（例如，200、404等）
  status_code?: number;
  // 响应体的大小
  body_size?: number; // in bytes
}

/**
 *  对于性能监控和故障排查至关重要，帮助开发者理解请求在系统中的流动，以及各个组件之间的交互情况。
 */
export interface TraceContext extends Record<string, unknown> {
  // 任意数据，键值对形式，存储与跟踪相关的附加信息
  data?: { [key: string]: any };
  // 描述操作的类型（例如，HTTP请求、数据库查询等）
  op?: string;
  // 父级跨度的标识符，用于表示层级关系
  parent_span_id?: string;
  // 当前跨度的标识符，用于唯一标识该操作
  span_id: string;
  // 当前操作的状态（例如，“ok”、“error”等）。
  status?: string;
  // 用于标记和过滤的键值对
  tags?: { [key: string]: Primitive };
  // 唯一的跟踪标识符，用于关联多个操作。
  trace_id: string;
  // 操作的来源，类型为 SpanOrigin。
  origin?: SpanOrigin;
}

/**
 * 可以帮助开发者了解应用程序在云环境中的资源配置，便于优化资源使用和处理云相关的问题。
 */
export interface CloudResourceContext extends Record<string, unknown> {
  // 云服务提供商的名称（例如，AWS、Azure、GCP等）
  ['cloud.provider']?: string;
  // 用户在云服务提供商的账户ID
  ['cloud.account.id']?: string;
  // 应用程序运行所在的地理区域（例如，us-east-1）
  ['cloud.region']?: string;
  // 应用程序运行的可用区（例如，us-east-1a）
  ['cloud.availability_zone']?: string;
  // 云平台的类型（例如，Kubernetes、EC2等）
  ['cloud.platform']?: string;
  // 运行应用程序的主机ID
  ['host.id']?: string;
  // 主机的类型（例如，虚拟机、容器等）
  ['host.type']?: string;
}

/**
 * 可以用于追踪与特定用户配置文件相关的事件，帮助开发者更好地理解用户行为和偏好。
 */
export interface ProfileContext extends Record<string, unknown> {
  // 用户的配置文件唯一标识符。
  profile_id: string;
}

/**
 * 可以帮助开发者识别缺少的监控点，便于增强系统的监控能力，确保所有关键路径都被监控到。
 */
export interface MissingInstrumentationContext extends Record<string, unknown> {
  // 缺失的包名
  package: string;
  //   指示是否为 CommonJS 模块
  ['javascript.is_cjs']?: boolean;
}
