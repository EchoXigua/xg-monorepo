import type {
  Integration,
  Span,
  SpanAttributes,
  SpanTimeInput,
  StartSpanOptions,
} from '@xigua-monitor/types';
import type { SentrySpan } from '@xigua-monitor/core';

import {
  getClient,
  getCurrentScope,
  spanToJSON,
  startInactiveSpan,
  withActiveSpan,
} from '@xigua-monitor/core';

import { WINDOW } from '../types';

/**
 * 用于检查给定的 value 是否是一个有效的数值，
 * 即该值必须是 number 类型并且是一个有限数值（不是 NaN、Infinity 或 -Infinity）
 *
 * isFinite 是 js 中的一个全局函数,用于检查一个数值是否是有限的数（即排除 NaN、Infinity 和 -Infinity）
 */
export function isMeasurementValue(value: unknown): value is number {
  return typeof value === 'number' && isFinite(value);
}

/**
 * 用于在事务中启动子 Span，并确保该子 Span 使用其创建时的时间戳（如果该时间戳早于父事务的实际开始时间戳）
 *
 * 函数的主要作用是确保在创建子 Span 时，能够根据父 Span 的实际开始时间调整时间戳，从而维护时间序列的准确性。
 * 这样在监控和性能跟踪中，可以更清晰地反映出各个操作的关系和时间消耗，有助于后续的性能分析和故障排查。
 *
 * @param parentSpan 父 Span 对象，代表当前的操作上下文
 * @param startTimeInSeconds 子 Span 的起始时间，以秒为单位
 * @param endTime 子 Span 的结束时间，允许的输入类型（如时间戳、延迟等）
 * @param param3 用于启动 Span 的选
 * @returns
 */
export function startAndEndSpan(
  parentSpan: Span,
  startTimeInSeconds: number,
  endTime: SpanTimeInput,
  { ...ctx }: StartSpanOptions,
): Span | undefined {
  // 将父 Span 转换为 JSON 格式，并提取其开始时间
  const parentStartTime = spanToJSON(parentSpan).start_timestamp;

  // 如果父 Span 的开始时间存在且晚于子 Span 的开始时间，则尝试更新父 Span 的开始时间
  if (parentStartTime && parentStartTime > startTimeInSeconds) {
    // We can only do this for SentrySpans...
    if (
      typeof (parentSpan as Partial<SentrySpan>).updateStartTime === 'function'
    ) {
      (parentSpan as SentrySpan).updateStartTime(startTimeInSeconds);
    }
  }

  // 接受 parentSpan 作为当前活动的 Span
  return withActiveSpan(parentSpan, () => {
    //  创建一个新的子 Span，并传入开始时间和其他上下文选项
    const span = startInactiveSpan({
      startTime: startTimeInSeconds,
      ...ctx,
    });

    // 如果成功创建了子 Span，则调用其 end 方法来结束该 Span，传入结束时间
    if (span) {
      span.end(endTime);
    }

    // 返回创建的子 Span，供测试或其他用途使用
    return span;
  });
}

interface StandaloneWebVitalSpanOptions {
  name: string;
  transaction?: string;
  attributes: SpanAttributes;
  startTime: number;
}

/**
 * 这个函数用于创建一个独立的 Web Vital 监控 span，其中包含性能相关的详细信息
 * （如用户、回放 ID、环境信息等），并将其与用户行为、页面上下文等进行关联。
 *
 * 这里解释了为什么要创建独立的、非活跃的 span ,主要用于将 Web Vital 数据发送到 Sentry，但不应该被用于一般的 span
 *
 * 1. 独立的 Web Vital span：
 *  - 这个 span 是独立的，并且是非活跃的，主要用于收集和发送 Web Vital
 *  （网页关键性能指标，如 LCP、CLS 等）到 Sentry 进行分析
 *  - 它不同于普通的 span，这类 span 需要经过特殊的处理来从中提取性能度量数据
 *
 * 2. 限制和注意事项：
 *  - 不能随意将这个函数用于其他任意的 span，因为这些 span 会在
 *  Sentry 服务器的摄取过程中有不同的处理方式，主要为了提取 Web Vital 性能数据
 *  - 开发者在使用时必须特别注意，只有在与 Web Vital 性能指标相关的场景中才能调用此函数
 *
 * 3. 共享的属性和数据：
 *  - 该函数会为所有 Web Vital span 添加一系列共享属性和数据，
 *  比如一些与用户、设备、环境相关的元数据，但开发者仍需自行添加与具体 Web Vital 指标相关的值
 *  - 例如，开发者需要手动添加 Web Vital 的具体值（例如 LCP 的加载时间、CLS 的累计偏移量）作为事件，附加到该 span 上
 *
 * 4. 具体的事务名和其他值：
 *  - 每个 Web Vital span 都需要分配一个事务名，用来标识当前的用户交互或页面加载任务
 *  其他一些值，如度量单位、具体的性能值等，也需由开发者设置
 *
 * 5. 手动结束 span：
 *  - 该 span 并不会自动结束，因此开发者需要手动调用结束操作 (end())
 *  来确保将这个 span 发送到 Sentry 进行数据收集和分析
 *
 * @param options
 *
 * @returns 返回一个未激活、独立的、尚未结束的 span,需要手动结束这个span,以便它能被正确地发送和处理
 * 调用结束方法 (span.end()) 才能让它完成，并且发送到 Sentry 进行分析。
 */
export function startStandaloneWebVitalSpan(
  options: StandaloneWebVitalSpanOptions,
): Span | undefined {
  // 获取 SDK 客户端实例
  const client = getClient();
  if (!client) {
    return;
  }

  // 从传入的 options 中提取信息
  const {
    name, // 监控的名称
    transaction, // 事务名称
    attributes: passedAttributes, // 属性
    startTime, // 起始时间
  } = options;

  // 获取客户端的 发布版本 和 环境信息
  const { release, environment } = client.getOptions();

  // 尝试从客户端获取 replay 集成,如果存在，则调用 getReplayId() 获取当前会话的 Replay ID
  // Replay 是用于记录用户会话的工具，可以帮助调试时回溯用户操作
  // Replay ID：关联用户会话的回放，用于调试或还原用户行为场景
  const replay = client.getIntegrationByName<
    Integration & { getReplayId: () => string }
  >('Replay');
  const replayId = replay && replay.getReplayId();

  // 获取当前作用域
  const scope = getCurrentScope();

  // 拿到用户信息
  const user = scope.getUser();
  // 提取用户信息用于展示
  const userDisplay =
    user !== undefined ? user.email || user.id || user.ip_address : undefined;

  // 用于识别和关联用户的性能数据或其他分析数据
  let profileId: string | undefined = undefined;
  try {
    // @ts-expect-error skip optional chaining to save bundle size with try catch
    // 尝试从当前作用域上下文中获取 profile_id，它可能用于关联某个用户的性能监控数据
    profileId = scope.getScopeData().contexts.profile.profile_id;
  } catch {
    // do nothing
  }

  // 构建属性对象
  const attributes: SpanAttributes = {
    release,
    environment,

    user: userDisplay || undefined,
    profile_id: profileId || undefined,
    replay_id: replayId || undefined,

    transaction,

    /**
     * 保存用户的 User-Agent 字符串，主要用于 Web Vital 分数的计算
     * 不同浏览器（如桌面版 Chrome 和移动版 Chrome）对性能的判断标准可能不同
     *
     * User-Agent 保存了当前用户的浏览器信息，
     * 用于区分不同的浏览器、设备，并根据这些差异动态调整对性能分数的评估。
     */
    'user_agent.original': WINDOW.navigator && WINDOW.navigator.userAgent,

    ...passedAttributes,
  };

  // 创建一个新的、独立的 span
  return startInactiveSpan({
    name,
    attributes,
    startTime,
    experimental: {
      // 表示该 span 是独立的，可能会用于实验性或额外的功能
      standalone: true,
    },
  });
}

/** 用于获取浏览器的 Performance API */
export function getBrowserPerformanceAPI(): Performance | undefined {
  // @ts-expect-error we want to make sure all of these are available, even if TS is sure they are
  // 确认是否有 window 对象，确保运行在浏览器环境中（某些非浏览器环境如 Node.js 中是没有 window 的）
  // 检查 window 对象是否支持 addEventListener，这也是现代浏览器的一个特性。
  // 检查 window 对象是否支持 Performance API，该 API 提供了与页面加载和渲染时间相关的信息
  // 如果都支持,最后返回 performance
  return WINDOW && WINDOW.addEventListener && WINDOW.performance;
}

/**
 * 将以毫秒为单位的时间转换为以秒为单位的时间
 * @param time time in ms
 */
export function msToSec(time: number): number {
  return time / 1000;
}
