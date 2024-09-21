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
import { getActivationStart } from './lib/getActivationStart';
import { getVisibilityWatcher } from './lib/getVisibilityWatcher';
import { initMetric } from './lib/initMetric';
import { observe } from './lib/observe';
import { whenActivated } from './lib/whenActivated';
import type {
  FCPMetric,
  FCPReportCallback,
  MetricRatingThresholds,
  ReportOpts,
} from './types';

/**
 * FCP 的评分标准（阈值）
 * good（优秀）：小于 1800 毫秒
 * needs-improvement（需要改进）： 1800 毫秒 ~ 3000 毫秒
 * poor（较差）：大于 3000 毫秒
 *
 * See https://web.dev/articles/fcp#what_is_a_good_fcp_score
 */
export const FCPThresholds: MetricRatingThresholds = [1800, 3000];

/**
 * 这个函数的作用是计算页面的 FCP 值
 *  - FCP 是网页性能的一个关键指标，表示页面内容首次在用户屏幕上绘制的时间
 *  CP 的值反映的是从页面加载开始，到用户第一次看到页面内容的时间差
 *
 *  - 当 FCP 值准备好后，函数会调用传入的 callback,这个函数会接收到 FCP 值以及用于计算 FCP 的相关 paint 性能条目。
 *
 *  - FCP 值是一个 DOMHighResTimeStamp 类型，它是高精度的时间戳，用于精确衡量时间
 *
 * Calculates the [FCP](https://web.dev/articles/fcp)
 *
 * @param onReport 一个回调函数，用于报告计算出的 FCP 值
 * @param opts 配置选项，默认为空对象
 */
export const onFCP = (
  onReport: FCPReportCallback,
  opts: ReportOpts = {},
): void => {
  /**
   * 一个延迟执行函数，确保 FCP 的监控在页面被激活后才开始执行
   * 该函数延迟了页面加载的 FCP 计算，避免页面在预渲染或后台时触发不准确的 FCP 值
   */
  whenActivated(() => {
    // 获取页面的可见性状态
    const visibilityWatcher = getVisibilityWatcher();

    //  初始化 FCP 的度量对象,用来存储 FCP 值及其相关的性能数据
    const metric = initMetric('FCP');
    let report: ReturnType<typeof bindReporter>;

    /**
     * 处理性能数据的回调函数
     *
     * @param entries
     */
    const handleEntries = (entries: FCPMetric['entries']) => {
      // 拿到所有的性能条目开始遍历处理
      (entries as PerformancePaintTiming[]).forEach((entry) => {
        // 筛选出名称为 'first-contentful-paint' 的条目，这就是 FCP 值
        if (entry.name === 'first-contentful-paint') {
          //  停止监控新的 paint 条目（因为 FCP 只报告一次）
          po!.disconnect();

          // 比较 entry.startTime 和页面的 firstHiddenTime 来确保页面在首次绘制之前没有被隐藏过
          if (entry.startTime < visibilityWatcher.firstHiddenTime) {
            /**
             * 这里解释了在计算 FCP (First Contentful Paint) 值时，
             * 为什么要使用 activationStart 作为参考时间，而不是页面的导航开始时间，以及如何处理特殊情况。
             *
             * 1. 为什么使用 activationStart：
             *  - FCP 通常相对于页面加载（即导航开始时间）来计算。但是，如果页面在加载时被预渲染（prerendered），
             *  也就是说页面在用户真正访问之前就已经部分加载完成，那么导航开始时间不再是一个合适的参考点。
             *
             *  - 在这种情况下，页面真正被用户激活（从预渲染状态转为可见）时的时间点更合适。
             *  因此，使用 activationStart，即页面被激活的时间作为 FCP 的参考时间。
             *
             * 2. 特殊情况的处理：
             *  - 有时候页面的 activationStart 可能会发生在 FCP 之后（例如页面预渲染时已经发生了内容绘制）
             *  如果 activationStart 的时间比 FCP 晚，那么这就不符合逻辑。
             *  因此，这种情况下，FCP 的值需要被限制为 0，即认为从页面激活到 FCP 发生的时间是 0 毫秒。
             */

            // 将 FCP 值和相关的 entry 存储在 metric 对象中
            metric.value = Math.max(entry.startTime - getActivationStart(), 0);
            metric.entries.push(entry);
            // 立即报告
            report(true);
          }
        }
      });
    };

    // 监听页面的 paint 类型事件，用来捕获 first-contentful-paint 相关的性能数据。
    const po = observe('paint', handleEntries);

    // 果成功监听到事件 (po 存在)
    if (po) {
      /** 将 metric 中的变化报告给 onReport 回调函数 */
      report = bindReporter(
        onReport,
        metric,
        FCPThresholds,
        opts!.reportAllChanges,
      );
    }
  });
};
