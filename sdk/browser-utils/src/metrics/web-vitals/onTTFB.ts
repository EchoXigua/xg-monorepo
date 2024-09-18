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
import { getNavigationEntry } from './lib/getNavigationEntry';
import { initMetric } from './lib/initMetric';
import { whenActivated } from './lib/whenActivated';
import type {
  MetricRatingThresholds,
  ReportOpts,
  TTFBReportCallback,
} from './types';

/**
 * TTFB 的评分标准
 * 良好：800 毫秒以下
 * 需要改进：800 毫秒 ~ 1800 毫秒
 * 差：1800 毫秒以上
 *
 * Thresholds for TTFB. See https://web.dev/articles/ttfb#what_is_a_good_ttfb_score
 */
export const TTFBThresholds: MetricRatingThresholds = [800, 1800];

/**
 * 这个函数用来确保在页面完全加载和/或从预渲染状态（prerendering）完成后执行一个回调函数。
 * 它通过监听页面的不同状态（如预渲染、加载完成等）来确定何时执行回调。
 * @param callback
 */
const whenReady = (callback: () => void) => {
  if (WINDOW.document && WINDOW.document.prerendering) {
    // 如果页面处于预渲染状态，则等待页面激活（prerendering 结束）后再调用 whenReady
    whenActivated(() => whenReady(callback));
  } else if (WINDOW.document && WINDOW.document.readyState !== 'complete') {
    // 如果页面未完全加载（即 readyState 不是 'complete'），监听页面的 'load' 事件，
    // 等到加载完成后再递归调用 whenReady 以确保回调在加载完成之后执行。
    addEventListener('load', () => whenReady(callback), true);
  } else {
    // 如果页面已经完全加载或者页面不在预渲染状态下，
    // 使用 setTimeout 将回调放入下一次事件循环的任务队列中，确保它在 loadEventEnd 后执行。
    setTimeout(callback, 0);
  }
};

/**
 * TTFB（Time to First Byte） 性能指标的计算和报告功能
 *
 * TTFB 指的是从用户发起请求到接收到服务器返回的首字节数据所花费的时间。
 * 它是一个重要的页面加载性能指标，因为它衡量了 DNS 查询、服务器响应和网络传输等因素的延迟。
 *
 * 这个函数会等到页面加载完成后再调用回调函数。原因是，在页面加载完成之前，
 * navigation 性能条目中的某些属性可能未完全填充或更新。
 *  - 例如，navigation 条目包含了从页面起源（time origin）开始的一系列时间信息（如 DNS 查询时间、
 *  连接协商时间、网络延迟、服务器处理时间等），只有在页面加载完成后，这些信息才会全部可用。
 *
 * TTFB 的起点是页面的 "时间原点" (time origin)，即用户发起请求的时刻。
 * 因此，TTFB 包含了从用户发起请求到接收到服务器首字节的所有延迟因素，如：
 *  - DNS 查询时间：解析域名所花费的时间。
 *  - 连接协商时间：包括 TLS/SSL 握手等建立连接的时间。
 *  - 网络延迟：从客户端到服务器的传输时间。
 *  - 服务器处理时间：服务器准备并发送响应的时间。
 *
 * 通过等待页面加载完成，可以利用 Navigation Timing API 来获取额外的时间指标，
 * 例如重定向时间、加载事件的开始和结束时间等。这些信息对于分析整个页面加载过程中的性能瓶颈非常有用。
 *
 *
 * Calculates the [TTFB](https://web.dev/articles/ttfb)
 *
 * [Navigation Timing API](https://w3c.github.io/navigation-timing/). For
 * example, the TTFB metric starts from the page's [time
 * origin](https://www.w3.org/TR/hr-time-2/#sec-time-origin),
 */
export const onTTFB = (onReport: TTFBReportCallback, opts: ReportOpts = {}) => {
  // 初始化 TTFB 指标的度量对象
  const metric = initMetric('TTFB');
  // 将提供的 onReport 回调与 TTFB 指标和阈值绑定，以便在指标准备就绪时报告
  const report = bindReporter(
    onReport,
    metric,
    TTFBThresholds,
    opts.reportAllChanges,
  );

  // 确保在页面加载完毕后执行传入的回调
  whenReady(() => {
    // 获取当前页面的导航性能条目
    const navEntry = getNavigationEntry();

    // 只有在有效的导航条目存在时才会继续处理
    if (navEntry) {
      // 响应的开始时间（即浏览器开始接收第一个字节的时间）
      const responseStart = navEntry.responseStart;

      // 在某些情况下，浏览器不会报告 TTFB 值，或者报告的值可能不正确
      //  - 在某些情况下，出于隐私或安全原因，浏览器可能不会报告 responseStart 值（即首字节时间）
      //  例如，某些隐私保护措施可能会屏蔽网络请求的详细信息，尤其是涉及跨域请求时
      //  这意味着无法计算 TTFB，因为 responseStart 是计算 TTFB 的关键时间点
      //  - 有时，浏览器可能会因为 bug 而报告负值或不合理的大值，
      //  会忽略这些异常情况，防止错误的数据影响性能报告，确保了只有合理的 TTFB 值会被用于计算和报告
      // https://github.com/GoogleChrome/web-vitals/issues/137
      // https://github.com/GoogleChrome/web-vitals/issues/162
      // https://github.com/GoogleChrome/web-vitals/issues/275

      // 如果小于等于 0 或大于当前时间，直接返回，不进行后续处理
      if (responseStart <= 0 || responseStart > performance.now()) return;

      // 计算 TTFB 的值
      // 如果 getActivationStart() 返回的时间晚于 responseStart，则返回 0。这是为了确保 TTFB 不会为负值。
      metric.value = Math.max(responseStart - getActivationStart(), 0);

      // 将当前的导航条目存储在 metric.entries 中，可能用于后续的分析或报告
      metric.entries = [navEntry];
      // 发送报告
      report(true);
    }
  });
};
