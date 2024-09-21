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

import { bindReporter } from './lib/bindReporter';
import { getVisibilityWatcher } from './lib/getVisibilityWatcher';
import { initMetric } from './lib/initMetric';
import { observe } from './lib/observe';
import { onHidden } from './lib/onHidden';
import { runOnce } from './lib/runOnce';
import { whenActivated } from './lib/whenActivated';
import type {
  FIDMetric,
  FIDReportCallback,
  MetricRatingThresholds,
  ReportOpts,
} from './types';

/**
 * FID 的评分标准（阈值）
 *
 * 良好：小于 100 毫秒
 * 需要改进：100 毫秒 ~ 300 毫秒
 * 差：大于 300 毫秒
 *
 * Thresholds for FID. See https://web.dev/articles/fid#what_is_a_good_fid_score
 */
export const FIDThresholds: MetricRatingThresholds = [100, 300];

/**
 * 这个函数主要是处理首次输入延迟（FID, First Input Delay） 值
 *
 * Calculates the [FID](https://web.dev/articles/fid)
 *
 * 注意: FID 只在用户与页面进行交互之后才会被报告,这个特性意味着 FID 不会在页面加载完成后立即提供
 * 如果用户没有与页面进行任何交互（例如没有点击、没有输入），那么 FID 就不会被计算和报告。
 * 这意味着在某些情况下（例如静态页面或用户没有互动的情况下），开发者可能无法获得 FID 数据，
 * 这对于优化用户体验的分析和决策可能会造成一定的限制。
 */
export const onFID = (onReport: FIDReportCallback, opts: ReportOpts = {}) => {
  // 会在页面激活时执行，确保监测在适当的时间开始
  whenActivated(() => {
    // 获取可见性监测器，用于追踪页面的可见性状态，以判断用户输入时页面是否被隐藏。
    const visibilityWatcher = getVisibilityWatcher();
    // 初始化 FID 指标对象,用于存储 FID 的相关信息，包括其值和条目
    const metric = initMetric('FID');
    // eslint-disable-next-line prefer-const
    // 存储绑定的报告函数,该函数将在 FID 数据准备好时被调用。
    let report: ReturnType<typeof bindReporter>;

    // 处理单个性能条目的函数
    const handleEntry = (entry: PerformanceEventTiming): void => {
      // 只有在用户输入事件发生时，页面没有被隐藏，才会报告这个输入事件的延迟

      // 检查事件的开始时间是否早于页面首次隐藏的时间。如果是，则说明输入事件在页面可见时发生。
      if (entry.startTime < visibilityWatcher.firstHiddenTime) {
        // 计算 FID 值,即处理开始时间与输入事件开始时间之间的差值。这个值反映了用户输入后的响应延迟
        metric.value = entry.processingStart - entry.startTime;
        // 添加当前性能条目
        metric.entries.push(entry);
        report(true);
      }
    };

    // 处理多个性能条目的函数 ,里面会遍历后依次调用单个处理函数
    const handleEntries = (entries: FIDMetric['entries']) => {
      (entries as PerformanceEventTiming[]).forEach(handleEntry);
    };

    // 监听 'first-input' 类型的性能条目
    const po = observe('first-input', handleEntries);

    // 绑定报告函数，将其与 FID 指标、阈值以及是否报告所有变化的选项关联
    report = bindReporter(
      onReport,
      metric,
      FIDThresholds,
      opts.reportAllChanges,
    );

    if (po) {
      // 当页面隐藏时，使用 runOnce 确保只执行一次的函数。
      onHidden(
        runOnce(() => {
          // 获取当前观察到的所有记录,调用处理函数处理
          handleEntries(po.takeRecords() as FIDMetric['entries']);
          // 断开性能观察器，停止监听
          po.disconnect();
        }),
      );
    }
  });
};
