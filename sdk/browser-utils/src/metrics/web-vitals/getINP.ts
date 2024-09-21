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

import { WINDOW } from '../../types';
import { bindReporter } from './lib/bindReporter';
import { initMetric } from './lib/initMetric';
import { observe } from './lib/observe';
import { onHidden } from './lib/onHidden';
import {
  getInteractionCount,
  initInteractionCountPolyfill,
} from './lib/polyfills/interactionCountPolyfill';
import { whenActivated } from './lib/whenActivated';
import type {
  INPMetric,
  INPReportCallback,
  MetricRatingThresholds,
  ReportOpts,
} from './types';

/** 表示一次用户交互的相关信息 */
interface Interaction {
  id: number; // 交互的唯一标识符
  latency: number; // 交互的延迟，表示从用户输入到页面响应的时间
  entries: PerformanceEventTiming[]; // 与这个交互相关的性能条目数组
}

/**
 * INP 的评分标准
 * 良好：200 毫秒以下
 * 需要改进：200 毫秒 ~ 500 毫秒
 * 差：500 毫秒以上
 * Thresholds for INP. See https://web.dev/articles/inp#what_is_a_good_inp_score */
export const INPThresholds: MetricRatingThresholds = [200, 500];

/**
 * 这个常量用于在浏览器的 bfcache（Back Forward Cache） 恢复后存储交互计数
 * 第 98 百分位（p98）交互延迟应该仅考虑当前导航，因此在使用中会用到这个值
 */
const prevInteractionCount = 0;

/**
 * 用于获取自上次 bfcache 恢复以来的交互计数
 * 如果没有发生 bfcache 恢复，它将返回页面生命周期内的所有交互计数
 */
const getInteractionCountForNavigation = () => {
  return getInteractionCount() - prevInteractionCount;
};

/**
 * 为了防止在交互很多的页面上占用过多内存，该常量定义了最多存储的最长交互数量为 10 个
 * 这些交互会被考虑为 INP 候选者
 */
const MAX_INTERACTIONS_TO_CONSIDER = 10;

/**
 * 用于存储当前页面上最长的交互，按照延迟从高到低排序
 * 该数组的最大长度为 MAX_INTERACTIONS_TO_CONSIDER（即 10）
 */
const longestInteractionList: Interaction[] = [];

/**
 * 以交互 ID 为键，Interaction 对象为值的对象，用于快速查找最长的交互
 */
const longestInteractionMap: { [interactionId: string]: Interaction } = {};

/**
 * 这个函数的功能是处理性能条目，并将其添加到存储的最长交互列表中，只有当交互的持续时间足够长时，才会被视为“最差交互”。
 * 如果这个条目已经是某个现有交互的一部分，则将其合并，并更新延迟和条目列表。
 */
const processEntry = (entry: PerformanceEventTiming) => {
  // 持续时间最短的交互（即第十个最长交互），以决定新条目是否应被添加到列表中
  const minLongestInteraction =
    longestInteractionList[longestInteractionList.length - 1];

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  // 查找是否已有交互存在
  const existingInteraction = longestInteractionMap[entry.interactionId!];

  // Only process the entry if it's possibly one of the ten longest,
  // or if it's part of an existing interaction.
  if (
    // 当前条目属于已有交互
    existingInteraction ||
    // 当前列表的长度少于最大交互数
    longestInteractionList.length < MAX_INTERACTIONS_TO_CONSIDER ||
    // 当前条目的持续时间超过当前最短的最长交互的持续时间
    (minLongestInteraction && entry.duration > minLongestInteraction.latency)
  ) {
    // 接下来就需要更新或创建交互

    // 如果已有交互存在，则更新其条目和延迟
    if (existingInteraction) {
      // 将当前条目添加到 existingInteraction.entries 数组中
      existingInteraction.entries.push(entry);
      // 更新当前条目延迟与已知延迟的最大值
      existingInteraction.latency = Math.max(
        existingInteraction.latency,
        entry.duration,
      );
    } else {
      // 否则创建一个新的交互对象，并将其添加到 交互映射对象和 longestInteractionList 中
      const interaction = {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        id: entry.interactionId!,
        latency: entry.duration,
        entries: [entry],
      };
      longestInteractionMap[interaction.id] = interaction;
      longestInteractionList.push(interaction);
    }

    // 根据延迟进行降序排序，以确保最长的交互在前面
    longestInteractionList.sort((a, b) => b.latency - a.latency);
    // 仅保留前十个最长的交互，并删除相应的交互映射中的条目
    longestInteractionList.splice(MAX_INTERACTIONS_TO_CONSIDER).forEach((i) => {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete longestInteractionMap[i.id];
    });
  }
};

/**
 * Returns the estimated p98 longest interaction based on the stored
 * interaction candidates and the interaction count for the current page.
 */
const estimateP98LongestInteraction = () => {
  const candidateInteractionIndex = Math.min(
    longestInteractionList.length - 1,
    Math.floor(getInteractionCountForNavigation() / 50),
  );

  return longestInteractionList[candidateInteractionIndex];
};

/**
 * 计算 INP（Interaction to Next Paint）的度量，用于衡量网页交互的延迟
 * 通过监听用户与页面的交互事件，计算 INP 指标，并将结果报告给回调函数
 *
 * Calculates the [INP](https://web.dev/articles/inp) value for the current
 * page and calls the `callback` function once the value is ready, along with
 * the `event` performance entries reported for that interaction. The reported
 * value is a `DOMHighResTimeStamp`.
 *
 * A custom `durationThreshold` configuration option can optionally be passed to
 * control what `event-timing` entries are considered for INP reporting. The
 * default threshold is `40`, which means INP scores of less than 40 are
 * reported as 0. Note that this will not affect your 75th percentile INP value
 * unless that value is also less than 40 (well below the recommended
 * [good](https://web.dev/articles/inp#what_is_a_good_inp_score) threshold).
 *
 * If the `reportAllChanges` configuration option is set to `true`, the
 * `callback` function will be called as soon as the value is initially
 * determined as well as any time the value changes throughout the page
 * lifespan.
 *
 * _**Important:** INP should be continually monitored for changes throughout
 * the entire lifespan of a page—including if the user returns to the page after
 * it's been hidden/backgrounded. However, since browsers often [will not fire
 * additional callbacks once the user has backgrounded a
 * page](https://developer.chrome.com/blog/page-lifecycle-api/#advice-hidden),
 * `callback` is always called when the page's visibility state changes to
 * hidden. As a result, the `callback` function might be called multiple times
 * during the same page load._
 */
export const onINP = (onReport: INPReportCallback, opts: ReportOpts = {}) => {
  // 确保代码在页面完全激活后才运行，这可以处理页面预渲染等情况
  whenActivated(() => {
    // TODO(philipwalton): remove once the polyfill is no longer needed.
    // 一个兼容性补丁，确保计数逻辑在所有环境下都能正常工作。
    initInteractionCountPolyfill();

    // 初始化 INP 度量对象，用于存储交互的值和条目
    const metric = initMetric('INP');
    // eslint-disable-next-line prefer-const
    let report: ReturnType<typeof bindReporter>;

    // 处理一组 PerformanceEventTiming 条目，用于计算 INP 指标
    const handleEntries = (entries: INPMetric['entries']) => {
      entries.forEach((entry) => {
        // 这是一个有明确标识符的用户交互
        if (entry.interactionId) {
          // 通过这个函数来处理
          // 将条目添加到当前的交互列表中，确保将这些交互记录在候选的 "最长交互" 列表中
          // 这是 INP 指标的关键，因为它需要找到用户交互的高延迟事件
          processEntry(entry);
        }

        /**
         * 这里解释了在处理 first-input 类型条目时需要特殊处理的原因以及当前的浏览器行为限制
         *
         * 1. first-input 类型条目没有 interactionId
         *  - 通常浏览器分配给用户交互的 PerformanceEventTiming 条目会有一个 interactionId，用于唯一标识一个交互事件
         *
         *  - 对于 first-input（即用户在页面加载后首次交互的事件）类型的条目，
         *  当前浏览器（Chrome）还没有为其分配 interactionId。所以无法通过 interactionId 匹配这些事件。
         *
         * 2. 为了将 first-input 考虑到 INP 中，需要比较 duration 和 startTime:
         *  - 由于 first-input 没有 interactionId，我们需要通过其他属性来判断该条目是否已被处理，
         *  代码选择了 duration（交互的持续时间）和 startTime（交互开始的时间）来作为匹配依据
         *
         *  - 如果某个 first-input 条目的 duration 和 startTime 与之前记录的条目相匹配，
         *  就认为该事件已经处理过，否则将其视为新的交互事件并记录下来
         *
         * 3. 事件条目（event entries）应该先于 first-input 条目分派:
         *  - Chrome 浏览器当前的行为是先处理一般的 event 条目（即有 interactionId 的事件），然后处理 first-input 事件
         *  这意味着在处理 first-input 之前，其他事件已经被分派和处理过了
         *  - 基于这一假设，代码可以放心地先检查 event 条目，然后再处理 first-input 条目，避免重复计算
         *
         *
         * TODO(philipwalton): remove once crbug.com/1325826 is fixed.
         *  - TODO 提到这段逻辑是临时的，并且在 Chrome 修复 crbug.com/1325826 后可以删除。
         *  该问题是关于 first-input 缺少 interactionId 的 bug，修复后 first-input 条目会有自己的 interactionId，
         *  就不需要通过 duration 和 startTime 来匹配了
         */

        // 处理 first-input 条目
        // first-input 类型的条目通常没有 interactionId，为了确保这些条目也被纳入 INP 计算，使用一种匹配机制来处理
        if (entry.entryType === 'first-input') {
          // 检查 entry.duration 和 entry.startTime 是否与现有的交互条目相匹配
          // 如果找到匹配的交互条目，则跳过处理这个条目，否则将其添加到交互列表中
          const noMatchingEntry = !longestInteractionList.some(
            (interaction) => {
              return interaction.entries.some((prevEntry) => {
                return (
                  entry.duration === prevEntry.duration &&
                  entry.startTime === prevEntry.startTime
                );
              });
            },
          );
          // 只有当没有匹配的条目时，才会调用 processEntry 处理 first-input。
          if (noMatchingEntry) {
            processEntry(entry);
          }
        }
      });

      // 计算 98 百分位数（P98）的最长交互延迟，这是 INP 的最终计算结果
      const inp = estimateP98LongestInteraction();

      // 如果计算出来的 INP 延迟值与之前存储的值不相同，更新 metric.value（即当前页面的 INP 值）
      if (inp && inp.latency !== metric.value) {
        metric.value = inp.latency;
        // 存储这些性能条目
        metric.entries = inp.entries;
        // 报告更新后的 INP 值
        report();
      }
    };

    // 监听用户的交互事件（event），设置了一个交互时长的阈值
    // 默认值为 40 毫秒（相当于 2.5 帧的持续时间），超过这个时间的交互事件才会被处理
    const po = observe('event', handleEntries, {
      /**
       * 这里解释了事件计时条目的持续时间会被舍入到最接近的 8 毫秒，
       * 以及为什么在 INP 指标的实现中选择特定的阈值（durationThreshold）来平衡数据的价值和性能
       *
       * 大多数现代显示器的刷新率为 60Hz，意味着每秒绘制 60 帧。每帧的时长约为 16.67 毫秒
       *
       * 1. 舍入至 8 毫秒：事件计时条目的持续时间被浏览器舍入到最接近的 8 毫秒。
       * 这意味着如果一个事件持续的实际时间为 12 毫秒，浏览器会将其记录为 8 毫秒，
       * 而如果事件持续时间为 15 毫秒，则记录为 16 毫秒。这样的舍入有助于减少数据的复杂性。
       *
       * 2. 40 毫秒阈值：注释中的 40 毫秒 是作为 durationThreshold 的默认值，
       * 表示只有那些持续时间超过 40 毫秒的交互事件会被考虑到 INP 指标中
       * 40 毫秒大约相当于 2.5 帧（40ms / 16.67ms ≈ 2.5），意味着选择了那些跨越至少 2.5 帧的交互事件
       *
       * 3. 平衡效用与性能：设置这个阈值的目的是为了平衡 数据的价值 和 性能的影响
       *  - 如果每一个很短的事件（例如只跨越 1-2 帧的事件）都被记录和处理，那么系统将会花费过多的资源去处理微小的交互，
       *  而这些交互的延迟可能对用户体验并无显著影响。因此，较短的事件可能不值得被考虑在内
       *
       *  - 通过仅考虑那些跨越 至少 2.5 帧 的事件，INP 只会处理对用户体验有更大影响的事件，而不会耗费过多的系统性能。
       *
       */
      durationThreshold:
        opts.durationThreshold != null ? opts.durationThreshold : 40,
    } as PerformanceObserverInit);

    // 将度量数据与 onReport 回调函数绑定，当 INP 值计算完成或更新时，调用 onReport 进行报告
    report = bindReporter(
      onReport,
      metric,
      INPThresholds,
      opts.reportAllChanges,
    );

    if (po) {
      /**
       * 如果浏览器支持 interactionId（意味着浏览器支持 INP 指标），还会监听 first-input 类型的性能条目
       * 这对首次交互事件的持续时间小于设置的阈值（durationThreshold）时非常有用
       *
       * interactionId：这是性能事件（例如用户交互事件）中的一个属性，用于唯一标识用户的交互
       * INP 指标：INP 是衡量页面对用户输入（例如点击、键盘输入等）反应时间的一个性能指标
       * 它通过衡量交互事件的延迟，反映页面响应性
       * first-input 事件：指用户第一次与页面进行交互的事件，通常是页面加载后用户的第一个操作
       * 由于这个事件对用户体验至关重要，INP 需要特别处理这些事件
       */
      if (
        'PerformanceEventTiming' in WINDOW &&
        'interactionId' in PerformanceEventTiming.prototype
      ) {
        po.observe({ type: 'first-input', buffered: true });
      }

      // 在页面隐藏时去处理
      onHidden(() => {
        // 获取当前所有已经记录的性能条目，调用处理函数去处理
        handleEntries(po.takeRecords() as INPMetric['entries']);

        /**
         * 这里解释了当页面上有用户交互事件发生，但 PerformanceObserver 未能捕获任何交互事件时，系统将报告一个延迟值为 0
         *
         * 如果用户确实与页面进行了交互（通过检查交互事件的计数），但 PerformanceObserver 没有捕获到这些交互事件
         * 在这种情况下，系统会认为虽然有交互，但没有足够的数据来计算实际的延迟，
         * 因此会报告一个 0 毫秒 的延迟。这意味着系统默认用户交互的延迟是即时的，没有感知到的延迟。
         *
         * 为什么要这样做呢？
         *  - 确保即使没有捕获到用户交互事件，系统依然会返回一个合理的值（即 0），而不是让度量数据缺失或不完整
         *  - 通过报告 0 毫秒的延迟，意味着即便在极少数情况下缺失了交互事件数据，仍然可以确保报告完整性，避免让开发者误以为页面没有交互
         */
        //  小于 0 且有交互发生，但没有捕获到任何交互事件
        if (metric.value < 0 && getInteractionCountForNavigation() > 0) {
          // 设置报告 metric.value 为 0，并清空条目列表
          metric.value = 0;
          metric.entries = [];
        }

        // 强制触发报告
        report(true);
      });
    }
  });
};
