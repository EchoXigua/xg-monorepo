import type {
  MeasurementUnit,
  Measurements,
  TimedEvent,
} from '@xigua-monitor/types';
import {
  SEMANTIC_ATTRIBUTE_SENTRY_MEASUREMENT_UNIT,
  SEMANTIC_ATTRIBUTE_SENTRY_MEASUREMENT_VALUE,
} from '../semanticAttributes';
import { getActiveSpan, getRootSpan } from '../utils/spanUtils';

/**
 * Adds a measurement to the current active transaction.
 */
export function setMeasurement(
  name: string,
  value: number,
  unit: MeasurementUnit,
): void {
  const activeSpan = getActiveSpan();
  const rootSpan = activeSpan && getRootSpan(activeSpan);

  if (rootSpan) {
    rootSpan.addEvent(name, {
      [SEMANTIC_ATTRIBUTE_SENTRY_MEASUREMENT_VALUE]: value,
      [SEMANTIC_ATTRIBUTE_SENTRY_MEASUREMENT_UNIT]: unit as string,
    });
  }
}

/**
 * 这个函数其主要功能是将一组定时事件 (TimedEvent[]) 转换为测量结果 (Measurements)，
 * 如果没有事件或者事件数组为空，则返回 undefined。
 *
 * @param events 每个 TimedEvent 代表一个具有时间属性的事件。
 * @returns
 */
export function timedEventsToMeasurements(
  events: TimedEvent[],
): Measurements | undefined {
  // 检查传入的 events 数组是否为空或未定义
  if (!events || events.length === 0) {
    // 返回 undefined，表示没有测量数据需要转换
    return undefined;
  }

  // 用于存储转换后的测量数据
  const measurements: Measurements = {};

  // 遍历 events 数组中的每个 TimedEvent，并从中提取属性 (attributes)。
  events.forEach((event) => {
    const attributes = event.attributes || {};

    // 从事件的属性中提取 unit（测量单位）和 value（测量值）
    const unit = attributes[SEMANTIC_ATTRIBUTE_SENTRY_MEASUREMENT_UNIT] as
      | MeasurementUnit
      | undefined;
    const value = attributes[SEMANTIC_ATTRIBUTE_SENTRY_MEASUREMENT_VALUE] as
      | number
      | undefined;

    //  验证和存储测量数据:
    if (typeof unit === 'string' && typeof value === 'number') {
      measurements[event.name] = { value, unit };
    }
  });

  // 返回构建好的 measurements 对象，该对象包含了所有有效的测量数据
  return measurements;
}
