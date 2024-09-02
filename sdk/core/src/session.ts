import type {
  SerializedSession,
  Session,
  SessionContext,
  SessionStatus,
} from '@xigua-monitor/types';
import {
  dropUndefinedKeys,
  timestampInSeconds,
  uuid4,
} from '@xigua-monitor/utils';

/**
 * 用于创建一个新的 Session 对象，并为其设置某些默认参数。
 * 可以通过传递一个 context 参数来覆盖或补充这些默认值。
 * \
 * @param context (optional) additional properties to be applied to the returned session object
 *
 * @returns a new `Session` object
 */
export function makeSession(
  context?: Omit<SessionContext, 'started' | 'status'>,
): Session {
  // 来获取当前时间的 UNIX 时间戳（以秒为单位）
  const startingTime = timestampInSeconds();

  const session: Session = {
    sid: uuid4(),
    // 表示这个会话对象是初始化的会话
    init: true,
    // 会话的最新更新时间
    timestamp: startingTime,
    // 会话的开始时间
    started: startingTime,
    // 会话的持续时间
    duration: 0,
    // 会话的初始状态
    status: 'ok',
    // 在该会话中捕获的错误数量
    errors: 0,
    // 表示默认情况下不会忽略会话的持续时间。
    ignoreDuration: false,
    // 用于将 Session 对象转换为 JSON 格式，以便在需要时序列化会话。
    toJSON: () => sessionToJSON(session),
  };

  // 如果传递了 context 参数，则用 context 中的属性更新会话对象的默认属性
  if (context) {
    updateSession(session, context);
  }

  // 函数返回创建并可能更新后的 Session 对象
  return session;
}

/**
 * 这个函数的作用是通过将传入的 context 中的属性应用到 session 上
 * 这是一个会修改传入对象（session）的函数，因此它不返回新的对象，而是直接对原对象进行更新
 * 必须这样做，而不是返回一个新的和更新的会话，因为关闭和发送会话会在会话传递给发送逻辑后对会话进行更新
 *
 * @see BaseClient.captureSession
 *
 * @param session 需要更新的 Session 对象
 * @param context 包含要应用到 session 对象上的属性的 SessionContext 对象 @param session
 */
// eslint-disable-next-line complexity
export function updateSession(
  session: Session,
  context: SessionContext = {},
): void {
  // 包含用户信息
  if (context.user) {
    // session 中还没有设置 ipAddress，那么就使用 context.user.ip_address。
    if (!session.ipAddress && context.user.ip_address) {
      session.ipAddress = context.user.ip_address;
    }

    // 如果 session 中的 did（设备 ID）没有设置，同时 context 也没有提供 did，
    // 则尝试从 context.user 中获取 id、email 或 username 作为设备标识符。
    if (!session.did && !context.did) {
      session.did =
        context.user.id || context.user.email || context.user.username;
    }
  }

  // 更新 session 的 timestamp
  session.timestamp = context.timestamp || timestampInSeconds();

  // 更新 session 中相应的字段
  // 更新异常机制和忽略持续时间的标志
  if (context.abnormal_mechanism) {
    session.abnormal_mechanism = context.abnormal_mechanism;
  }

  if (context.ignoreDuration) {
    session.ignoreDuration = context.ignoreDuration;
  }

  // 更新会话 ID
  if (context.sid) {
    // 如果 sid 长度不为 32，则生成一个新的 UUID
    session.sid = context.sid.length === 32 ? context.sid : uuid4();
  }
  // 更新 session 的初始状态
  if (context.init !== undefined) {
    session.init = context.init;
  }

  // 如果 session 中的 did 没有设置，同时 context 中提供了 did，则使用 context.did 更新 session.did。
  if (!session.did && context.did) {
    session.did = `${context.did}`;
  }

  // 更新会话的开始时间和持续时间
  if (typeof context.started === 'number') {
    session.started = context.started;
  }
  if (session.ignoreDuration) {
    session.duration = undefined;
  } else if (typeof context.duration === 'number') {
    session.duration = context.duration;
  } else {
    // 根据 timestamp 和 started 计算会话的持续时间
    const duration = session.timestamp - session.started;
    session.duration = duration >= 0 ? duration : 0;
  }

  // 更新发布版本、环境和其他信息
  if (context.release) {
    session.release = context.release;
  }
  if (context.environment) {
    session.environment = context.environment;
  }
  if (!session.ipAddress && context.ipAddress) {
    session.ipAddress = context.ipAddress;
  }
  if (!session.userAgent && context.userAgent) {
    session.userAgent = context.userAgent;
  }
  if (typeof context.errors === 'number') {
    session.errors = context.errors;
  }
  if (context.status) {
    session.status = context.status;
  }
}

/**
 * 这个函数的作用是关闭一个会话 (Session)
 * 通过设置会话的状态并调用 updateSession 函数来更新会话对象。
 *
 * 注意，这个函数会改变传递的会话
 * (@see updateSession for explanation).
 *
 * @param session 要关闭的 Session 对象
 * @param status 用来设置会话的关闭状态。这个状态必须是 SessionStatus 类型的一个值，但不能为 'ok'
 *
 */
export function closeSession(
  session: Session,
  status?: Exclude<SessionStatus, 'ok'>,
): void {
  let context = {};
  if (status) {
    // 如果提供了 status 参数，则将其添加到 context 对象中
    context = { status };
  } else if (session.status === 'ok') {
    // 如果没有提供 status 参数，并且当前会话的状态为 'ok'，则将状态设置为 'exited'
    context = { status: 'exited' };
  }

  updateSession(session, context);
}

/**
 * 这个函数用于将 Session 对象序列化为一个 JSON 对象，同时调整对象结构以符合 Sentry 后端所要求的格式
 * JavaScript SDK 内部使用的 Session 对象结构和 Sentry 后端要求的结构存在细微差异，因此需要进行此转换。
 *
 * @param session 传入的 Session 对象，包含会话的相关数据
 *
 * @returns 转换后的 JSON 对象，符合 Sentry 后端的会话格式
 */
function sessionToJSON(session: Session): SerializedSession {
  // 移除为undefined的key
  return dropUndefinedKeys({
    sid: `${session.sid}`,
    init: session.init,
    // 会话的开始时间，时间戳从秒转换为毫秒并格式化为 ISO 字符串
    started: new Date(session.started * 1000).toISOString(),
    // 当前会话的时间戳，同样从秒转换为毫秒并格式化为 ISO 字符串。
    timestamp: new Date(session.timestamp * 1000).toISOString(),
    status: session.status,
    errors: session.errors,
    did:
      typeof session.did === 'number' || typeof session.did === 'string'
        ? `${session.did}`
        : undefined,
    // 会话的持续时间
    duration: session.duration,
    // 如果会话由于某种异常机制关闭，则记录该机制
    abnormal_mechanism: session.abnormal_mechanism,
    // 会话的属性对象
    attrs: {
      release: session.release, // 会话的版本信息
      environment: session.environment, // 会话所处的环境信息
      ip_address: session.ipAddress, // 用户的 IP 地址
      user_agent: session.userAgent, // 用户的浏览器信息
    },
  });
}
