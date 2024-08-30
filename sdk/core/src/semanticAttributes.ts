/**
 * Use this attribute to represent the source of a span.
 * Should be one of: custom, url, route, view, component, task, unknown
 *
 */
export const SEMANTIC_ATTRIBUTE_SENTRY_SOURCE = 'sentry.source';

/**
 * Use this attribute to represent the sample rate used for a span.
 */
export const SEMANTIC_ATTRIBUTE_SENTRY_SAMPLE_RATE = 'sentry.sample_rate';

/**
 * Use this attribute to represent the operation of a span.
 */
export const SEMANTIC_ATTRIBUTE_SENTRY_OP = 'sentry.op';

/**
 * 用于在 Span（通常用于分布式追踪和性能监控）中标识某个 span 的来源或起源。
 * 这种标识帮助系统或开发人员了解和追踪特定 span 是从哪里产生的，以及它在整个追踪或事务链条中的角色和位置。
 */
export const SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN = 'sentry.origin';

/** The reason why an idle span finished. */
export const SEMANTIC_ATTRIBUTE_SENTRY_IDLE_SPAN_FINISH_REASON =
  'sentry.idle_span_finish_reason';

/** The unit of a measurement, which may be stored as a TimedEvent. */
export const SEMANTIC_ATTRIBUTE_SENTRY_MEASUREMENT_UNIT =
  'sentry.measurement_unit';

/** The value of a measurement, which may be stored as a TimedEvent. */
export const SEMANTIC_ATTRIBUTE_SENTRY_MEASUREMENT_VALUE =
  'sentry.measurement_value';

/**
 * The id of the profile that this span occured in.
 */
export const SEMANTIC_ATTRIBUTE_PROFILE_ID = 'sentry.profile_id';

export const SEMANTIC_ATTRIBUTE_EXCLUSIVE_TIME = 'sentry.exclusive_time';

export const SEMANTIC_ATTRIBUTE_CACHE_HIT = 'cache.hit';

export const SEMANTIC_ATTRIBUTE_CACHE_KEY = 'cache.key';

export const SEMANTIC_ATTRIBUTE_CACHE_ITEM_SIZE = 'cache.item_size';
