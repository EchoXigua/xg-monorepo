import type {
  DsnComponents,
  EventEnvelope,
  SdkMetadata,
  UserFeedback,
  UserFeedbackItem,
} from '@xigua-monitor/types';
import { createEnvelope, dsnToString } from '@xigua-monitor/utils';

/**
 * 将用户反馈转换为一个信封,以便在需要时发送到 Sentry 服务器或其他目的地
 *
 * @param feedback  用户反馈对象，包含 event_id 和其他用户反馈信息
 * @param param1
 * @returns
 */
export function createUserFeedbackEnvelope(
  feedback: UserFeedback,
  {
    metadata, // SDK 的元数据对象，可能包含 SDK 的名称和版本信息
    tunnel, // 可选的 tunnel URL，用于替代默认的 DSN 发送事件
    dsn, // 数据源名称（Data Source Name），标识 Sentry 项目的 DSN 配置
  }: {
    metadata: SdkMetadata | undefined;
    tunnel: string | undefined;
    dsn: DsnComponents | undefined;
  },
): EventEnvelope {
  // 创建信封头部
  const headers: EventEnvelope[0] = {
    // 事件 id
    event_id: feedback.event_id,
    // 事件发送事件
    sent_at: new Date().toISOString(),
    ...(metadata &&
      // sdk 信息(如果存在)
      metadata.sdk && {
        sdk: {
          name: metadata.sdk.name,
          version: metadata.sdk.version,
        },
      }),
    // 将 dsn 字符串化后添加到头部中
    ...(!!tunnel && !!dsn && { dsn: dsnToString(dsn) }),
  };

  // 将用户反馈对象转换为一个 envelope item
  const item = createUserFeedbackEnvelopeItem(feedback);

  return createEnvelope(headers, [item]);
}

/**
 * 创建信封条目
 *
 * @param feedback
 * @returns
 */
function createUserFeedbackEnvelopeItem(
  feedback: UserFeedback,
): UserFeedbackItem {
  const feedbackHeaders: UserFeedbackItem[0] = {
    type: 'user_report',
  };
  return [feedbackHeaders, feedback];
}
