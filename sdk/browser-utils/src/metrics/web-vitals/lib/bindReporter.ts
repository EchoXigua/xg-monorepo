/*
 * Copyright 2020 Google LLC
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

import type { MetricRatingThresholds, MetricType } from '../types';

/**
 * 用于根据给定的值和阈值判断性能指标的评级
 * @param value
 * @param thresholds
 * @returns
 */
const getRating = (
  value: number,
  thresholds: MetricRatingThresholds,
): MetricType['rating'] => {
  if (value > thresholds[1]) {
    return 'poor';
  }
  if (value > thresholds[0]) {
    return 'needs-improvement';
  }
  return 'good';
};

/**
 * 这个函数用于绑定一个报告器，该报告器可以根据性能指标的变化向传入的回调函数发送数据
 *
 * @param callback 当指标值需要报告时调用的回调函数
 * @param metric 当前的指标对象，包含指标的名称、值和其他相关信息
 * @param thresholds  指标评级的阈值数组
 * @param reportAllChanges 是否在指标值发生变化时始终报告
 * @returns
 */
export const bindReporter = <MetricName extends MetricType['name']>(
  callback: (metric: Extract<MetricType, { name: MetricName }>) => void,
  metric: Extract<MetricType, { name: MetricName }>,
  thresholds: MetricRatingThresholds,
  reportAllChanges?: boolean,
) => {
  /** 用于存储上一个报告的指标值 */
  let prevValue: number;
  /** 用于存储当前值与上一个值之间的差异 */
  let delta: number;

  /**
   * 返回一个新的函数，这个新函数可以在需要时调用以触发报告
   *
   * @param forceReport 用于强制报告指标
   */
  return (forceReport?: boolean) => {
    // 性能指标值不应为负数
    if (metric.value >= 0) {
      // 检查是否需要强制报告指标 或者 总是在变化的时候报告
      if (forceReport || reportAllChanges) {
        // 计算当前值与上一个值之间的差异
        delta = metric.value - (prevValue || 0);

        /**
         * 判断是否需要报告：
         *
         *  - 如果当前指标的值与上一个报告的值之间存在变化（即 delta 不为零），就应该报告这个指标。
         *  因为我们关心的是指标的变化情况，而不是静态值。例如，如果页面的加载性能改善了，用户体验就会更好
         *
         *  - 如果没有之前的值（即 prevValue 为 undefined），也应该进行报告
         *  为了处理第一次报告的情况，或者在某些特殊情况下，比如文档变为隐藏状态时
         *
         *  - 如果文档（页面）变为隐藏状态（例如用户切换到其他标签页），在这时如果当前的指标值为 0，
         *  那么在页面重新可见时，prevValue 仍然是 undefined。这种情况是需要处理的，
         *  因为尽管指标值为 0，但仍然要确保这个状态能够被报告出去，以便后续的监测和分析。
         *
         * See: https://github.com/GoogleChrome/web-vitals/issues/14
         */
        if (delta || prevValue === undefined) {
          // 第一次报告，或之前的值为 0，则执行报告

          // 更新 prevValue
          prevValue = metric.value;
          // 更新 metric.delta 为计算出的 delta（当前值与上一个值之间的差）
          metric.delta = delta;

          // 当前的指标评级，并更新 metric.rating
          metric.rating = getRating(metric.value, thresholds);
          // 执行回调
          callback(metric);
        }
      }
    }
  };
};
