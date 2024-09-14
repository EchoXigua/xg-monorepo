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
import { initMetric } from './lib/initMetric';
import { observe } from './lib/observe';
import { onHidden } from './lib/onHidden';
import { runOnce } from './lib/runOnce';
import { onFCP } from './onFCP';
import type {
  CLSMetric,
  CLSReportCallback,
  MetricRatingThresholds,
  ReportOpts,
} from './types';

/*
 * 这个常量是 cls 的评分阈值，用来衡量页面布局偏移的严重程度
 *  [0.1, 0.25] 是基于用户体验研究得出的，并广泛用于网页性能衡量工具
 *
 * 0.1 以下：良好（Good）
 *
 * 0.1 到 0.25：需要改进（Needs improvement）
 *
 * 0.25 以上：差（Poor）
 *
 * See https://web.dev/articles/cls#what_is_a_good_cls_score
 */
export const CLSThresholds: MetricRatingThresholds = [0.1, 0.25];

/**
 * 这个函数主要功能是监控并计算当前页面的 CLS（Cumulative Layout Shift，累积布局偏移）值
 * CLS 是衡量页面布局在用户交互期间发生视觉稳定性变化的一个指标
 *
 * 1. 计算 CLS 值：
 *  - CLS 值通过计算页面加载过程中所有 layout-shift（布局偏移）的性能条目得出。
 *  这个偏移值是一个浮点数，用于衡量页面上元素的位移对用户体验的影响。
 *  - callback 是一个回调函数，在 CLS 值准备好报告时调用，并同时传递所有用于计算 CLS 值的 layout-shift 性能条目
 *
 * 2. callback 触发时机：
 *  - 默认情况下，当 CLS 值初次确定时，callback 函数就会被调用
 *  - 如果设置了 reportAllChanges 为 true，那么每次 CLS 值更新时，callback 都会被调用
 *  这意味着页面生命周期内的每次布局变化都会导致 CLS 值的更新，并触发回调
 *
 * 3. CLS 值的类型：
 *  - CLS 值是一个浮点数（double），它表示页面在用户浏览过程中发生的布局偏移总和
 *
 *
 * 关键！！！：
 * 1. 页面生命周期内的持续监控：
 *  - CLS 应该在整个页面生命周期内进行持续监控，即使页面进入后台或被隐藏后，仍然需要监控 CLS 的变化
 *  - 页面可能会在加载后长时间保持活动状态，用户可能会反复切换标签页，因此需要持续监听页面的视觉变化，并在布局偏移时更新 CLS
 *
 * 2. 浏览器行为与隐藏状态：
 *  - 当页面处于后台时，浏览器通常不会触发额外的回调。因此，一旦页面变为隐藏状态，CLS 的 callback 函数将被立即调用，
 *  以确保当前的 CLS 值得到报告。这是为了防止因为页面被隐藏而遗漏重要的布局变化。
 *
 * 3. 回调函数可能多次调用：
 *  - 同一页面加载过程中，callback 可能会被多次调用。这是因为 CLS 是一个累积的值，随着页面的交互与变化，
 * 布局偏移可能会发生多次。因此，回调函数会多次触发，以确保每次偏移都会更新 CLS 值。
 *
 * (https://developer.chrome.com/blog/page-lifecycle-api/#advice-hidden),
 */
export const onCLS = (
  onReport: CLSReportCallback,
  opts: ReportOpts = {},
): void => {
  /**
   * CLS 的报告需要在 FCP（First Contentful Paint，首次内容绘制）发生之后开始。
   * 这是为了保持与 CrUX（Chrome User Experience Report）的行为一致
   */
  onFCP(
    // 确保其中的逻辑只执行一次，防止 FCP 多次触发
    runOnce(() => {
      // 初始化了 CLS 的指标对象，初始值为 0
      const metric = initMetric('CLS', 0);

      let report: ReturnType<typeof bindReporter>;

      /** 当前会话的 CLS 值，它会不断累积每次布局偏移的分数 */
      let sessionValue = 0;

      /** 存储 LayoutShift 的数组，每次页面上发生的布局偏移条目都会被加入到这个数组中 */
      let sessionEntries: LayoutShift[] = [];

      // 处理布局偏移条目的 函数
      const handleEntries = (entries: LayoutShift[]): void => {
        // 遍历所有条目
        entries.forEach((entry) => {
          // 判断布局偏移是否由用户的近期输入导致
          // CLS 只计算那些没有用户输入引起的布局偏移
          if (!entry.hadRecentInput) {
            // 当前会话中的第一个布局偏移条目（最早）
            const firstSessionEntry = sessionEntries[0];
            // 当前会话中的最后一个布局偏移条目（最新）
            const lastSessionEntry = sessionEntries[sessionEntries.length - 1];

            // If the entry occurred less than 1 second after the previous entry
            // and less than 5 seconds after the first entry in the session,
            // include the entry in the current session. Otherwise, start a new
            // session.
            // 判断当前的布局偏移条目（entry）是否属于当前会话，还是应该开启一个新的会话
            if (
              // 当前会话的累积 CLS 值存在
              sessionValue &&
              // 当前会话中至少有一个条目
              firstSessionEntry &&
              lastSessionEntry &&
              // 当前条目与最后一个条目的时间差小于 1 秒
              entry.startTime - lastSessionEntry.startTime < 1000 &&
              // 当前条目与第一个条目的时间差小于 5 秒
              entry.startTime - firstSessionEntry.startTime < 5000
            ) {
              // 只有当前条目与会话中的条目之间的时间差都在规定的时间范围内（小于1秒和5秒），
              // 这个新的条目才会被合并到当前会话中
              sessionValue += entry.value;
              sessionEntries.push(entry);
            } else {
              // 开启一个新会话，将当前条目的值作为新的会话总值
              sessionValue = entry.value;
              // 当前会话的条目列表只包含当前条目
              sessionEntries = [entry];
            }
          }
        });

        /**
         * 是检查当前会话的累积 CLS 值（sessionValue）是否大于当前已记录的 CLS 值（metric.value）
         * 是的话，说明当前会话的偏移对用户体验影响更大，因此需要更新 metric.value，将其设置为当前会话的累积值
         * 并将贡献当前 CLS 的条目列表（sessionEntries）更新为最新的条目
         *
         * 调用 report() 来报告新的 CLS 值，这个调用确保每次有比之前更大的 CLS 值时，都会及时上报最新的数据信息
         */
        if (sessionValue > metric.value) {
          metric.value = sessionValue;
          metric.entries = sessionEntries;
          report();
        }
      };

      // 监听 layout-shift 事件，该事件表示页面的布局发生了偏移。
      const po = observe('layout-shift', handleEntries);
      if (po) {
        // 创建了 PerformanceObserver 对象

        // 绑定了一个报告函数 report，用于当 CLS 发生变化时将其报告
        report = bindReporter(
          onReport,
          metric,
          CLSThresholds,
          opts.reportAllChanges,
        );

        // 处理页面隐藏
        onHidden(() => {
          // 获取未处理的 layout-shift 条目，并通过 handleEntries 处理这些条目
          handleEntries(po.takeRecords() as CLSMetric['entries']);
          // 在页面隐藏时强制上报 CLS 值
          // 页面在用户切换到后台后不再触发 CLS 事件，所有未上报的布局偏移需要在此时处理并上报，确保完整的数据报告
          report(true);
        });

        // 将 report 函数放入事件队列中，确保 CLS 在页面加载后立即进行一次上报。
        // 即使没有布局偏移发生，CLS 值为 0 也会被上报
        /**
         * 这里讲一下为什么要这样做、
         *
         * 1. 确保 CLS 能及时上报：
         *  - 为了确保 CLS 的值能够在页面首次加载时尽早上报，尤其是当 reportAllChanges 配置选项为 true 时
         *  - setTimeout 将上报任务推到 js 事件循环的下一轮执行。这意味着它会在当前任务（页面的其他初始化逻辑）完成后立即执行
         *
         * 2. 配合 FCP（首次内容绘制，First Contentful Paint）：
         *  - CLS 的上报与 FCP（First Contentful Paint）相关
         *  - 因为在一些性能监控工具中（比如 Google 的 CrUX），CLS 只有在 FCP 之后才被认为是有效的
         *  - 即使页面还没有触发任何布局偏移（layout shift），CLS 仍然需要在页面首次内容绘制之后上报
         *
         * 3. 延时处理的好处：
         *  -  延迟上报的时间是极短的（几乎是立即执行）。这样做的好处是让当前的页面加载任务（例如 FCP 的处理）可以优先执行，
         *  而 CLS 的上报可以紧随其后，避免阻塞页面加载流程。
         *  - 同时，CLS 是一个不断累积的指标，如果不使用延迟，有可能在某些情况下还未完成的其他页面性能指标（如 FCP）会与 CLS 的初次上报产生竞争关系。
         *  通过这种方式，CLS 能够在合适的时间上报，不会干扰其他指标的计算和上报
         *
         * 4. 兜底机制：
         *  - 作为兜底机制，即使没有其他事件触发上报，CLS 也会在 setTimeout 触发后及时上报
         *  - 假如页面在加载过程中没有发生任何显著的布局偏移，或者布局偏移发生在首次内容绘制（FCP）之前，
         *  这样的延时处理确保了 CLS 值为 0 或其他初始值可以尽早上报，防止遗漏性能数据。
         *
         */
        setTimeout(report, 0);
      }
    }),
  );
};
