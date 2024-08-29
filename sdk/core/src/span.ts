/**
 * 该类型表示跨度的起源类型，可能是手动（manual）或自动（auto）。
 * 这区分了由用户显式创建的跨度和由系统自动生成的跨度。
 */
type SpanOriginType = 'manual' | 'auto';
/**
 * 该类型用于表示跨度的分类，通常是一个字符串，例如 http、db、ui 等
 */
type SpanOriginCategory = string; // e.g. http, db, ui, ....
/**
 * 该类型表示与跨度相关的集成名称，例如第三方库或框架的名称。
 */
type SpanOriginIntegrationName = string;
/**
 * 该类型表示集成中的某一部分，可能是模块或功能的名称。
 */
type SpanOriginIntegrationPart = string;

/**
 * 这个设计非常灵活，可以用于追踪和监控系统中不同来源和类型的跨度。
 * 这样的结构在分布式追踪中尤为重要，帮助开发者了解不同请求的起源和类别，有助于性能监控和故障排查。
 * 
 * @example
 * 'manual': 表示手动创建的跨度。
   'auto.http': 表示自动生成的 HTTP 请求跨度。
   'manual.db.someIntegration': 表示手动创建的数据库操作，使用某个集成。
   'auto.ui.someIntegration.somePart': 表示自动生成的 UI 交互跨度，来自某个集成的特定部分。
 */
export type SpanOrigin =
  | SpanOriginType
  | `${SpanOriginType}.${SpanOriginCategory}`
  | `${SpanOriginType}.${SpanOriginCategory}.${SpanOriginIntegrationName}`
  | `${SpanOriginType}.${SpanOriginCategory}.${SpanOriginIntegrationName}.${SpanOriginIntegrationPart}`;
