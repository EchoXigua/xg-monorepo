import type {
  CaptureContext,
  // Client,
  // ClientOptions,
  // Event,
  EventHint,
  Scope as ScopeInterface,
  ScopeContext,
  StackFrame,
  // StackParser,
} from '@xigua-monitor/types';
import { Scope } from '../scope';

/**
 * This type makes sure that we get either a CaptureContext, OR an EventHint.
 * It does not allow mixing them, which could lead to unexpected outcomes, e.g. this is disallowed:
 * { user: { id: '123' }, mechanism: { handled: false } }
 */
export type ExclusiveEventHintOrCaptureContext =
  | (CaptureContext & Partial<{ [key in keyof EventHint]: never }>)
  | (EventHint & Partial<{ [key in keyof ScopeContext]: never }>);

/**
 * 用于解析 EventHint 或将CaptureContext 转换为 EventHint
 * 它的目的是兼容旧的函数签名，在需要时将 CaptureContext 转换为 Sentry 现在使用的 EventHint 类型
 *
 * @param hint 想要解析的提示信息或上下文
 * @returns 返回解析后的 EventHint 对象 或 undefined
 */
export function parseEventHintOrCaptureContext(
  hint: ExclusiveEventHintOrCaptureContext | undefined,
): EventHint | undefined {
  if (!hint) {
    // hint 不存在，则返回 undefined
    return undefined;
  }

  // 检查 hint 是否是 Scope 实例或一个返回 Scope 的函数
  if (hintIsScopeOrFunction(hint)) {
    return { captureContext: hint };
  }

  // 检查 hint 是否为 scope 上下文
  if (hintIsScopeContext(hint)) {
    return {
      captureContext: hint,
    };
  }

  // 如果都不是，这种情况意味着 hint 本身已经是 EventHint 类型，不需要进行任何转换
  return hint;
}

/**
 * 用于检查 hint 是否是 Scope 实例或函数
 * @param hint
 * @returns
 */
function hintIsScopeOrFunction(
  hint: CaptureContext | EventHint,
): hint is ScopeInterface | ((scope: ScopeInterface) => ScopeInterface) {
  return hint instanceof Scope || typeof hint === 'function';
}

type ScopeContextProperty = keyof ScopeContext;
const captureContextKeys: readonly ScopeContextProperty[] = [
  'user',
  'level',
  'extra',
  'contexts',
  'tags',
  'fingerprint',
  'requestSession',
  'propagationContext',
] as const;

/**
 * 这个函数用于判断传入的 hint 对象是否可以视为 ScopeContext 的一部分
 * @param hint
 * @returns
 */
function hintIsScopeContext(
  hint: Partial<ScopeContext> | EventHint,
): hint is Partial<ScopeContext> {
  return Object.keys(hint).some((key) =>
    // 检查是否存在至少一个键名在 captureContextKeys 数组中
    // 如果存在，返回 true，表示这个 hint 对象可以视为部分 ScopeContext
    captureContextKeys.includes(key as ScopeContextProperty),
  );
}
