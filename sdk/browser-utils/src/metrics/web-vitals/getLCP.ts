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

import { WINDOW } from '../../types';
import { bindReporter } from './lib/bindReporter';
import { getActivationStart } from './lib/getActivationStart';
import { getVisibilityWatcher } from './lib/getVisibilityWatcher';
import { initMetric } from './lib/initMetric';
import { observe } from './lib/observe';
import { onHidden } from './lib/onHidden';
import { runOnce } from './lib/runOnce';
import { whenActivated } from './lib/whenActivated';
import type {
  LCPMetric,
  LCPReportCallback,
  MetricRatingThresholds,
  ReportOpts,
} from './types';

/** Thresholds for LCP. See https://web.dev/articles/lcp#what_is_a_good_lcp_score */
export const LCPThresholds: MetricRatingThresholds = [2500, 4000];

const reportedMetricIDs: Record<string, boolean> = {};

/**
 * 这个函数的作用是对 LCP（Largest Contentful Paint） 指标的监测和报告
 * LCP 是一个重要的性能指标，用于衡量用户在页面加载过程中看到的最大内容渲染所需的时间
 *
 * Calculates the [LCP](https://web.dev/articles/lcp) value for the current page and
 * calls the `callback` function once the value is ready (along with the
 * relevant `largest-contentful-paint` performance entry used to determine the
 * value). The reported value is a `DOMHighResTimeStamp`.
 *
 * If the `reportAllChanges` configuration option is set to `true`, the
 * `callback` function will be called any time a new `largest-contentful-paint`
 * performance entry is dispatched, or once the final value of the metric has
 * been determined.
 */
export const onLCP = (onReport: LCPReportCallback, opts: ReportOpts = {}) => {
  // 确保在页面被激活时（非预渲染状态）才开始监测 LCP
  whenActivated(() => {
    // 获取页面的可见性监测器，用于判断页面是否可见
    const visibilityWatcher = getVisibilityWatcher();
    // 初始化 LCP 的度量指标
    const metric = initMetric('LCP');
    // 用于存储报告函数的引用
    let report: ReturnType<typeof bindReporter>;

    // 处理监测到的 LCP 性能条目的函数
    const handleEntries = (entries: LCPMetric['entries']) => {
      // 获取最后一条条目
      const lastEntry = entries[entries.length - 1] as LargestContentfulPaint;
      if (lastEntry) {
        // 只报告在LCP之前未隐藏的页面
        if (lastEntry.startTime < visibilityWatcher.firstHiddenTime) {
          /**
           * 这里的处理逻辑和 onFCP 中一样，计算 LCP 值（相对于页面激活时间）
           * startTime: 这个属性指示内容渲染开始的时间
           * activationStart: 这个属性表示页面的激活时间
           *
           * 这里会修正 FCP 的值： 如果 activationStart 的时间晚于 LCP（即内容被渲染到屏幕上的时间），
           * 那么计算 LCP 值时，这个时间应该被修正为 0
           */

          // 存储 LCP 的值和性能条目
          metric.value = Math.max(
            lastEntry.startTime - getActivationStart(),
            0,
          );
          metric.entries = [lastEntry];
          // 报告 LCP
          report();
        }
      }
    };

    // 监听 largest-contentful-paint 性能条目
    const po = observe('largest-contentful-paint', handleEntries);

    if (po) {
      // 调用 bindReporter 以便在 LCP 更新时通知回调
      report = bindReporter(
        onReport,
        metric,
        LCPThresholds,
        opts.reportAllChanges,
      );

      // 停止监听函数，这里只会执行一次
      const stopListening = runOnce(() => {
        // 检查是否已报告: 确保在报告 LCP 值之前，当前的度量值没有被报告过
        if (!reportedMetricIDs[metric.id]) {
          // 从性能观察器（po）中获取当前所有的 LCP 条目，并调用 handleEntries 来处理这些条目
          // 确保在停止监听之前，所有相关的 LCP 数据都被处理
          /**
           * takeRecords() 方法用于返回一个包含已经记录的性能条目的数组，并清空当前观察器的记录
           * 这样可以确保在调用该方法后，之前的记录不会被再次获取
           *
           * 所以当 LCP 尽管没有完成时候，停止监听函数执行的时候，也能收集到一些当前已经记录的性能条目
           * （如大图片），这种情况下需要开发者去优化资源加载
           * 在设计性能监控逻辑时，往往需要在性能和数据准确性之间进行权衡。
           * 如果监控的逻辑过于复杂，可能会影响用户体验，因此需要保持简单高效的实现。
           */
          handleEntries(po.takeRecords() as LCPMetric['entries']);

          // 停止观察 LCP 事件，以节省性能资源
          po.disconnect();
          // 将该度量标记为已报告，以防止后续多次报告
          reportedMetricIDs[metric.id] = true;
          // 立即报告当前的 LCP 值
          report(true);
        }
      });

      /**
       * 这里强调在用户输入（例如点击或键盘输入）之后，应该停止对 LCP 的监听
       * 因为用户输入通常意味着用户正在与页面进行交互，此时的性能度量（如 LCP）可能不再反映真实的用户体验
       *
       * 到滚动也是一种用户输入，但它不可靠，因为滚动事件可能是通过编程方式触发的（例如通过 JavaScript 控制页面滚动）
       * 这种情况下，程序生成的滚动不会反映真实的用户体验，所以不应该用滚动事件来判断是否停止 LCP 的观察。
       * See: https://github.com/GoogleChrome/web-vitals/issues/75
       *
       * 为键盘按下和点击事件添加监听器，确保在这些事件后停止对 LCP 的监控
       */
      ['keydown', 'click'].forEach((type) => {
        if (WINDOW.document) {
          /**
           * 这里解释了为什么在处理用户输入事件时，回调函数被包裹在 setTimeout 中
           *
           * 主要原因是为了将回调放入事件队列，在当前的 JavaScript 执行栈完成后再执行
           *
           * 通过将停止监听的操作推入一个新的任务，避免在处理键盘或点击事件的过程中增加额外的延迟。
           * 这是为了减少对 INP（Input Delay）的影响
           * INP 是一种衡量用户与页面交互时的延迟。如果在输入事件的处理过程中增加额外的逻辑处理时间，可能会导致用户体验不佳。
           *
           * https://github.com/GoogleChrome/web-vitals/issues/383
           */
          addEventListener(type, () => setTimeout(stopListening, 0), true);
        }
      });

      // 当页面变为隐藏状态时，也会调用 stopListening，确保不再监控 LCP
      onHidden(stopListening);
    }
  });
};
