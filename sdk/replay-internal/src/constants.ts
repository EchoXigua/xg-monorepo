import { GLOBAL_OBJ } from '@xigua-monitor/utils';

/**
 * 这段注释解释了为什么在代码中导出 WINDOW 的副本，而不是直接从 @sentry/browser 导出 WINDOW
 *
 * 1. 防止浏览器包被包含进 CDN 包中：通过单独导出 WINDOW，可以避免将整个 @sentry/browser 包含进 CDN 中使用的包中。
 * 这有助于减少打包体积，提高性能，特别是在使用 CDN 的情况下。
 *
 * 2. 避免循环依赖：假如将来 @sentry/browser 从 @sentry/replay 导入某些内容，这样的做法可以避免在 browser 和 replay 包之间出现循环依赖问题。
 * 循环依赖会导致代码结构复杂化，甚至引发错误或使构建过程失败
 */
export const WINDOW = GLOBAL_OBJ as typeof GLOBAL_OBJ & Window;

/** 存储 Replay 会话信息的键名 */
export const REPLAY_SESSION_KEY = 'sentryReplaySession';
/** 定义 Replay 的名称 */
export const REPLAY_EVENT_NAME = 'replay_event';
/** 定义录制事件的名称 */
export const RECORDING_EVENT_NAME = 'replay_recording';
/** 表示发送 Replay 失败时使用的错误消息 */
export const UNABLE_TO_SEND_REPLAY = 'Unable to send Replay';

/**
 * 下面是一些replay 的默认配置
 */

/** 在用户闲置 5 分钟（300,000 毫秒）后会暂停录制 */
export const SESSION_IDLE_PAUSE_DURATION = 300_000; // 5 minutes in ms

/** 如果用户闲置超过 15 分钟（900,000 毫秒），会话将过期，意味着回放会话会终止。 */
export const SESSION_IDLE_EXPIRE_DURATION = 900_000; // 15 minutes in ms

/** 最小和最大回放数据刷新时间间隔。通常用于控制数据缓存发送的时间 */
export const DEFAULT_FLUSH_MIN_DELAY = 5_000;
// XXX: Temp fix for our debounce logic where `maxWait` would never occur if it
// was the same as `wait`
export const DEFAULT_FLUSH_MAX_DELAY = 5_500;

/** 在 60 秒后，系统会检查错误并决定是否清除缓存 */
export const BUFFER_CHECKOUT_TIME = 60_000;

/** 重试的基础时间间隔 */
export const RETRY_BASE_INTERVAL = 5000;
/** 最大重试次数，用于发送 Replay 数据失败时的重试机制 */
export const RETRY_MAX_COUNT = 3;

/** 网络请求体的最大字节数（150,000字节）。超过此大小的请求体会被截断。 */
export const NETWORK_BODY_MAX_SIZE = 150_000;

/** 控制台日志中的每个参数的最大字节数（5,000字节），超过此大小的参数会被截断。 */
export const CONSOLE_ARG_MAX_SIZE = 5_000;

/**
 *
 * "慢点击" 的时间阈值
 * 如果用户点击的持续时间超过 3 秒，那么系统会认为这是一次慢点击，并可能会进行一些特殊处理，
 * 比如记录这个操作或将其标记为异常行为。这在用户体验监控中很有用，因为它可能反映了用户的犹豫或操作上的困难。
 */
export const SLOW_CLICK_THRESHOLD = 3_000;
/**
 * 在点击之后检测滚动事件的时间窗口（300 毫秒）
 * 在一些场景中，当用户点击某个元素后可能会伴随滚动操作，这段时间用于检测这种滚动行为
 * 如果在这段时间内发生了滚动，可能会被视为编程触发的滚动操作，而不是用户手动滚动的行为
 */
export const SLOW_CLICK_SCROLL_TIMEOUT = 300;

/** 定义了回放事件的最大缓存大小（20MB），如果缓存大小超过此值，Replay 将停止。 */
export const REPLAY_MAX_EVENT_BUFFER_SIZE = 20_000_000; // ~20MB

/** 回放的最短持续时间（5 秒），低于此时长的回放不会被发送 */
export const MIN_REPLAY_DURATION = 4_999;
/**
 * 最小回放时长能够设置的上限，即回放的最小时长不能超过 15 秒
 * 确保系统不会将最小回放时长设定得过高，这样可以保证足够多的用户操作被捕获和记录
 * 过长的最小回放时长可能会导致重要的交互被忽略或无法及时记录
 */
export const MIN_REPLAY_DURATION_LIMIT = 15_000;

/** 回放的最长持续时间（60 分钟） */
export const MAX_REPLAY_DURATION = 3_600_000; // 60 minutes in ms;

/**
 * 当启用了 maskAllText 功能时，这里数组定义中的 HTML 属性将不会被遮盖
 * 这些属性通常是界面中的一些提示性文字（如 title 或 placeholder），它们对隐私的影响较小，因此可以被忽略，减少不必要的数据掩盖
 */
export const DEFAULT_IGNORED_ATTRIBUTES = ['title', 'placeholder'];
