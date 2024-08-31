import type { Span } from '@xigua-monitor/types';
import { logger } from '@xigua-monitor/utils';
import { DEBUG_BUILD } from '../debug-build';
import { getRootSpan, spanIsSampled, spanToJSON } from '../utils/spanUtils';

/**
 * 这个函数用于记录一个 Span 对象开始时的相关信息。这对于调试和监控追踪系统中的操作非常有用
 */
export function logSpanStart(span: Span): void {
  // 这是一个编译时常量，只有在调试模式下才会为 true。如果不在调试模式下，函数会立即返回，不执行后续代码
  if (!DEBUG_BUILD) return;

  // 将 Span 对象转换为一个 JSON 对象，以便于提取相关信息。
  // 这里提取了 description（描述），op（操作类型），以及 parent_span_id（父 Span ID）
  const {
    description = '< unknown name >',
    op = '< unknown op >',
    parent_span_id: parentSpanId,
  } = spanToJSON(span);

  // 获取当前 Span 的 ID
  const { spanId } = span.spanContext();

  // 检查 Span 是否被采样
  const sampled = spanIsSampled(span);
  // 获取追踪链中的根 Span
  const rootSpan = getRootSpan(span);
  // 来判断当前 Span 是否是根 Span
  const isRootSpan = rootSpan === span;

  // 构建日志的头部信息，包含 Span 是否被采样和它是否是根 Span
  const header = `[Tracing] Starting ${sampled ? 'sampled' : 'unsampled'} ${isRootSpan ? 'root ' : ''}span`;

  // 构建详细信息
  const infoParts: string[] = [
    `op: ${op}`,
    `name: ${description}`,
    `ID: ${spanId}`,
  ];

  // 有父 Span，则会将父 Span 的 ID 添加到 infoParts
  if (parentSpanId) {
    infoParts.push(`parent ID: ${parentSpanId}`);
  }

  // 如果当前 Span 不是根 Span，则将根 Span 的 ID、操作类型和描述也添加到 infoParts
  // 这帮助了解当前 Span 在整个追踪链中的位置。
  if (!isRootSpan) {
    const { op, description } = spanToJSON(rootSpan);
    infoParts.push(`root ID: ${rootSpan.spanContext().spanId}`);
    if (op) {
      infoParts.push(`root op: ${op}`);
    }
    if (description) {
      infoParts.push(`root description: ${description}`);
    }
  }

  // 输出日志
  logger.log(`${header}
  ${infoParts.join('\n  ')}`);
}

/**
 * Print a log message for an ended span.
 */
export function logSpanEnd(span: Span): void {
  if (!DEBUG_BUILD) return;

  const { description = '< unknown name >', op = '< unknown op >' } =
    spanToJSON(span);
  const { spanId } = span.spanContext();
  const rootSpan = getRootSpan(span);
  const isRootSpan = rootSpan === span;

  const msg = `[Tracing] Finishing "${op}" ${isRootSpan ? 'root ' : ''}span "${description}" with ID ${spanId}`;
  logger.log(msg);
}
