/**
 * 这个属性用于表示跨度的来源。
 * 它可以帮助开发者了解该跨度是如何生成的，从而进行更好的监控和故障排除。
 *
 * Should be one of: custom, url, route, view, component, task, unknown
 * custom: 自定义生成的跨度
 * url: 与某个 URL 相关的请求。
 * route: 表示路由处理的跨度。
 * view: 代表视图的跨度，通常与前端框架相关。
 * component: 代表特定组件的跨度，可能与 UI 组件相关。
 * task: 表示后台任务或工作单元的跨度。
 * unknown: 无法确定来源的跨度。
 *
 */
export const SEMANTIC_ATTRIBUTE_SENTRY_SOURCE = 'sentry.source';

/**
 * 这个属性用于表示在创建跨度时所使用的采样率（sample rate）
 * 采样率通常用于控制收集的数据量，从而在性能和数据可用性之间取得平衡。
 *
 * 在监控应用程序的性能时，开发者可以选择根据采样率来决定是否记录某些跨度。
 * 例如，如果采样率设置为 0.1，则只有 10% 的请求将被记录
 */
export const SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE = 'sentry.sample_rate';

/**
 * 这个属性用于表示跨度的操作类型。
 * 它可以描述当前跨度所执行的操作，这有助于分类和分析不同类型的操作。
 *
 * 例如，可以使用此属性记录 HTTP 请求、数据库查询或文件 I/O 操作等。
 * 不同的操作类型可以帮助开发者识别性能瓶颈和优化机会。
 */
export const SEMANTIC_ATTRIBUTE_SENTRY_OP = 'sentry.op';

/**
 * 用于在 Span（通常用于分布式追踪和性能监控）中标识某个 span 的来源或起源。
 * 这种标识帮助系统或开发人员了解和追踪特定 span 是从哪里产生的，以及它在整个追踪或事务链条中的角色和位置。
 */
export const SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN = 'sentry.origin';

/**
 * 此属性用于表示一个空闲（idle）跨度结束的原因。
 * 这对于理解和分析在某些条件下为何跨度未能持续至完成非常有用。
 *
 * 空闲跨度的结束可能与应用程序的行为（例如用户不再活动或应用程序逻辑条件）有关，
 * 这可以帮助开发者分析应用程序在空闲状态下的性能和资源使用。
 */
export const SEMANTIC_ATTRIBUTE_SENTRY_IDLE_SPAN_FINISH_REASON =
  'sentry.idle_span_finish_reason';

/**
 * 此属性表示测量的单位。
 * 这可以帮助在记录测量值时提供上下文，使得分析和理解这些值更加明确。
 *
 * 例如，单位可以是秒（s）、毫秒（ms）、字节（bytes）等。不同单位的使用有助于理解不同测量值的上下文。
 */
export const SEMANTIC_ATTRIBUTE_SENTRY_MEASUREMENT_UNIT =
  'sentry.measurement_unit';

/**
 * 此属性用于表示测量的具体值。
 * 它与测量单位一起使用，可以帮助开发者获得有关应用程序性能或操作的具体数据。
 *
 * 例如，记录一次请求的处理时间（例如 150ms），或者记录数据库查询返回的数据大小（例如 2000 bytes）。
 */
export const SEMANTIC_ATTRIBUTE_SENTRY_MEASUREMENT_VALUE =
  'sentry.measurement_value';

/**
 * 此属性用于表示发生该跨度的配置文件 ID。
 * 这在性能分析和用户行为分析中非常有用。
 *
 * 在性能分析中，能够识别某个配置文件的跨度可以帮助开发者了解特定用户或会话的性能表现。
 */
export const SEMANTIC_ATTRIBUTE_PROFILE_ID = 'sentry.profile_id';

/**
 * 此属性用于表示某个操作的专属时间，即在执行该操作期间，没有其他操作被执行的时间。
 * 这有助于理解某些操作的独占性和资源占用情况。
 *
 * 开发者可以通过此属性评估特定操作的性能，识别出性能瓶颈或高资源消耗的操作。
 */
export const SEMANTIC_ATTRIBUTE_EXCLUSIVE_TIME = 'sentry.exclusive_time';

/**
 * 此属性用于指示缓存命中情况，标识请求的数据是否是从缓存中获取的。
 *
 * 通过记录缓存命中与未命中，可以帮助开发者分析缓存的有效性，进而优化缓存策略。
 */
export const SEMANTIC_ATTRIBUTE_CACHE_HIT = 'cache.hit';

/**
 * 此属性用于表示与缓存相关的键。它是用于检索缓存数据的标识符
 *
 * 开发者可以通过此属性追踪特定缓存条目的使用情况，分析不同请求的缓存效果。
 */
export const SEMANTIC_ATTRIBUTE_CACHE_KEY = 'cache.key';

/**
 * 此属性用于表示缓存项的大小。它有助于理解缓存使用的空间和效率。
 *
 * 记录缓存项大小可以帮助开发者优化缓存设计，了解不同缓存条目的内存占用情况。
 */
export const SEMANTIC_ATTRIBUTE_CACHE_ITEM_SIZE = 'cache.item_size';
