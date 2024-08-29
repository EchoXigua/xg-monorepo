// Based on https://getsentry.github.io/relay/relay_metrics/enum.MetricUnit.html
// For more details, see measurement key in https://develop.sentry.dev/sdk/event-payloads/transaction/

/**
 * 这里的代码定义了一组与测量单位相关的类型，它们主要用于在 Sentry 的事件监控系统中表示测量数据的单位。
 * 这些类型帮助明确在不同上下文中如何表示数据的单位，并确保代码在使用这些单位时具有更好的类型安全性和可读性。
 */

/**
 * 表示时间持续时间的单位，包括从纳秒到周的各种时间单位
 */
export type DurationUnit =
  // 纳秒  10 的 -9 次方
  | 'nanosecond'
  // 微秒  10 的 -6 次方
  | 'microsecond'
  // 毫秒  10 的 -3 次方（千分之一秒）
  | 'millisecond'
  // 秒
  | 'second'
  // 分
  | 'minute'
  // 小时
  | 'hour'
  // 天
  | 'day'
  // 周
  | 'week';

/**
 * 表示信息大小的单位，涵盖比特、字节及其多种倍数
 */
export type InformationUnit =
  // 比特，是信息的最小单位，通常用于表示二进制状态（0或1）
  | 'bit'
  // 字节，等于 8 个比特，是计算机中常用的信息单位，通常表示一个字符
  | 'byte'
  // 千字节（KB），等于 1024 字节  常用于表示文件的大小
  | 'kilobyte'
  // 二进制千字节（KiB），等于 1024 字节，和千字节的定义相同，但严格上使用二进制
  | 'kibibyte'
  // 兆字节（MB）， 等于 1024 千字节
  | 'megabyte'
  // 二进制兆字节(MiB), 等于 1024 千字节
  | 'mebibyte'
  // 千兆字节（GB）
  | 'gigabyte'
  // 太字节（TB），等于 1024 GB
  | 'terabyte'
  // 二进制太字节（TiB），等于 1024 GiB
  | 'tebibyte'
  // 拍字节（PB），等于 1024 TB
  | 'petabyte'
  // 艾字节（EB），等于 1024 PB
  | 'exabyte'
  // 二进制艾字节（EiB），等于 1024PiB
  | 'exbibyte';

/**
 * 表示分数单位，如比率和百分比：
 */
export type FractionUnit = 'ratio' | 'percent';

/**
 * 表示没有特定单位的值，用于未定义单位或没有单位的情况
 */
export type NoneUnit = '' | 'none';

// See https://github.com/microsoft/TypeScript/issues/29729#issuecomment-1082546550
// 这个类型允许你在使用预定义的字符串类型（如上面的 DurationUnit、InformationUnit 等）时，也可以提供自定义的字符串值。
// 这样做的目的是在保持类型安全的同时，允许开发者定义自己的单位。
type LiteralUnion<T extends string> = T | Omit<T, T>;

/**
 * 这个类型结合了所有前面定义的单位类型，表示一个通用的测量单位。
 * 开发者可以使用这些预定义的单位，也可以自定义其他字符串作为单位。
 */
export type MeasurementUnit = LiteralUnion<
  DurationUnit | InformationUnit | FractionUnit | NoneUnit
>;

/**
 * 这个类型表示一个测量值的集合，其中每个测量值都是一个键值对，
 * 键为字符串（表示测量的名称），值为一个对象，该对象包含 value（测量的数值）和 unit（测量的单位）
 */
export type Measurements = Record<
  string,
  { value: number; unit: MeasurementUnit }
>;
