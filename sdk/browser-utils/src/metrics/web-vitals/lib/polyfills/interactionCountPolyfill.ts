/*
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { Metric } from '../../types';
import { observe } from '../observe';

declare global {
  interface Performance {
    interactionCount: number;
  }
}

/** 当前估算的交互计数 */
let interactionCountEstimate = 0;
/** 已知的最小交互 ID，初始值为无穷大，方便后续更新 */
let minKnownInteractionId = Infinity;
/** 已知的最大交互 ID，初始值为 0 */
let maxKnownInteractionId = 0;

/**
 * 这里代码的目的是估算 interactionCount（交互计数），它反映了用户与页面的交互次数。
 * 由于某些浏览器可能不直接支持 interactionCount 属性，
 * 代码通过追踪 PerformanceEventTiming 条目的 interactionId 来推断该值。
 */
const updateEstimate = (entries: Metric['entries']): void => {
  // 遍历性能条目
  (entries as PerformanceEventTiming[]).forEach((e) => {
    // 如果存在 interactionId
    if (e.interactionId) {
      // 找到当前已知的最小和最大交互 ID
      minKnownInteractionId = Math.min(minKnownInteractionId, e.interactionId);
      maxKnownInteractionId = Math.max(maxKnownInteractionId, e.interactionId);

      // 这里的计算假设 interactionId 是连续分配的，且每 7 个交互 ID 对应 1 次实际的交互
      // 这段代码主要用于估算用户的交互次数，尤其是在浏览器不支持 performance.interactionCount 时作为替代方法
      // 适用于那些依赖 PerformanceEventTiming 事件的应用或统计工具，比如为了优化网页性能，通过用户交互频率来衡量页面响应能力
      // interactionId 并不一定严格遵循每 7 个为一组的模式，未来可以通过浏览器更新或其他机制改善这一估算方法
      interactionCountEstimate = maxKnownInteractionId
        ? (maxKnownInteractionId - minKnownInteractionId) / 7 + 1
        : 0;
    }
  });
};

/**
 * 用于保存 PerformanceObserver 实例
 * 如果浏览器不支持原生的 interactionCount，那么 po 会被用于监控用户交互事件
 */
let po: PerformanceObserver | undefined;

/**
 * 返回用户的交互次数
 */
export const getInteractionCount = (): number => {
  // 首先检查是否已经初始化了 PerformanceObserver（即 po 是否存在）
  // 存在则返回 polyfill 估算的 interactionCount
  // 没有初始化 po，则尝试直接返回 performance.interactionCount 的值，如果浏览器也不支持该属性，则返回 0
  return po ? interactionCountEstimate : performance.interactionCount || 0;
};

/**
 * 这个函数用于检查浏览器是否支持原生的 interactionCount，如果不支持，则初始化一个 polyfill 来估算交互次数
 */
export const initInteractionCountPolyfill = (): void => {
  if ('interactionCount' in performance || po) return;

  // 如果浏览器不支持原生 interactionCount 并且 po 尚未初始化，那么通过 observe 方法
  // 创建一个 PerformanceObserver 来监听用户的交互事件（事件类型为 event），并调用 updateEstimate 函数更新交互计数估算值。
  po = observe('event', updateEstimate, {
    type: 'event', // 表示监听所有 PerformanceEventTiming 类型的事件
    buffered: true, // 意味着在观察器注册之前发生的事件也会被捕获
    durationThreshold: 0, // 表示所有事件（无论持续时间多短）都会被捕获
  } as PerformanceObserverInit);
};
