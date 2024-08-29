export type AttachmentType =
  // 一般性的事件附件
  | 'event.attachment'
  // 通常用于原生崩溃报告
  | 'event.minidump'
  // 表示苹果崩溃报告的附件
  | 'event.applecrashreport'
  // 用于 Unreal Engine 上下文的附件
  | 'unreal.context'
  // 用于 Unreal Engine 日志的附件
  | 'unreal.logs'
  // 表示事件的视图层次结构的附件，可能用于 UI 的调试
  | 'event.view_hierarchy';

/**
 * An attachment to an event. This is used to upload arbitrary data to Sentry.
 *
 * 请注意不要在附件中添加敏感信息
 *
 * https://develop.sentry.dev/sdk/envelopes/#attachment
 */
export interface Attachment {
  /**
   *  附件的数据，可以是字符串或者二进制数据（字节数组）。这允许在附件中存储各种形式的内容。
   */
  data: string | Uint8Array;
  /**
   *  附件文件的名称，不包含路径部分。这是上传到 Sentry 后显示的文件名。
   */
  filename: string;
  /**
   * 附件内容的 MIME 类型，可选。如果未指定，默认为 application/octet-stream。
   * 这决定了 Sentry 如何处理和显示附件的数据。任何有效的 媒体类型 都是允许的。
   *
   * Any valid [media type](https://www.iana.org/assignments/media-types/media-types.xhtml) is allowed.
   */
  contentType?: string;
  /**
   *  附件的类型，可选。如果未指定，默认为 event.attachment。该类型帮助 Sentry 知道如何处理附件的数据。
   */
  attachmentType?: AttachmentType;
}
