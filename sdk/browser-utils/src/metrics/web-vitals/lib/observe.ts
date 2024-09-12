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

import type {
  FirstInputPolyfillEntry,
  NavigationTimingPolyfillEntry,
} from '../types';

/** 定义了不同类型的性能条目的类型 */
interface PerformanceEntryMap {
  // 用户交互事件
  event: PerformanceEventTiming[];
  // 页面绘制相关性能，比如首次绘制（First Paint）
  paint: PerformancePaintTiming[];
  // 布局偏移，用于测量页面稳定性（CLS）
  'layout-shift': LayoutShift[];
  // 最大内容绘制时间（LCP）
  'largest-contentful-paint': LargestContentfulPaint[];
  // 首次输入延迟（FID），记录用户首次交互的性能
  'first-input': PerformanceEventTiming[] | FirstInputPolyfillEntry[];
  // 页面导航事件相关的性能数据
  navigation: PerformanceNavigationTiming[] | NavigationTimingPolyfillEntry[];
  // 资源加载性能条目，比如图片、脚本等的加载时间
  resource: PerformanceResourceTiming[];
  // 浏览器主线程中执行时间较长的任务
  longtask: PerformanceEntry[];
}

/**
 * 源码这里描述了 observe 函数的作用和其内部机制：
 *
 * - observe 函数接受一个性能条目的类型（如 resource, paint, longtask 等）和一个回调函数，
 * 并创建一个 PerformanceObserver 实例。这个观察者将监听指定类型的性能条目。
 *
 * - 函数启用了缓冲功能（buffered: true），这意味着即使在观察器开始监听之前就已经产生的性能条目，
 * 仍然会被捕获和处理。这对于捕获页面加载过程中的早期性能事件非常重要。
 *
 * - 每当捕获到性能条目时，回调函数会被调用，且每个条目都会作为回调参数传入。
 * 这种设计确保了程序能针对每一个性能条目进行单独的处理。
 *
 * - 该函数检测当前浏览器是否支持监听指定的性能条目类型。这是为了避免在不支持某种性能条目的浏览器中出现错误。
 *
 * - 为了在不支持的浏览器中避免潜在的错误，函数内部用 try/catch 包裹整个观察逻辑。
 * 如果某个浏览器不支持性能观察，或者在设置观察器的过程中发生错误，函数会捕获这些错误并静默处理。
 *
 * @param type 性能条目类型
 * @param callback 回调函数，接收特定类型的性能条目数组
 * @param opts 配置参数，用于自定义监听行为
 * @returns
 */
export const observe = <K extends keyof PerformanceEntryMap>(
  type: K,
  callback: (entries: PerformanceEntryMap[K]) => void,
  opts?: PerformanceObserverInit,
): PerformanceObserver | undefined => {
  try {
    // 检测浏览器是否支持指定的性能条目类型
    if (PerformanceObserver.supportedEntryTypes.includes(type)) {
      /**
       * PerformanceObserver API
       *
       * 这个 api是浏览器中用于监控各种性能事件的 API，通过观察 PerformanceEntry 对象来收集网页加载和运行时的性能信息。
       * 该 API 提供了一种有效的方式，能够实时地获取性能数据，并对这些数据进行处理和分析。
       */

      // 用于监听特定性能条目的 API，每次获取到条目时都会调用回调函数
      const po = new PerformanceObserver((list) => {
        /**
         * 将回调推迟到微任务队列中，以规避 Safari 浏览器中的 bug
         * （该 bug 导致回调函数立即被调用，而不是按预期在任务队列中执行
         * See: https://github.com/GoogleChrome/web-vitals/issues/277
         * eslint-disable-next-line @typescript-eslint/no-floating-promises
         */
        Promise.resolve().then(() => {
          callback(list.getEntries() as PerformanceEntryMap[K]);
        });
      });

      // 开始监听指定类型的性能条目，并启用 buffered: true
      // 以确保即使在观察器开始之前产生的条目也能被捕获。
      po.observe(
        Object.assign(
          {
            type,
            buffered: true,
          },
          opts || {},
        ) as PerformanceObserverInit,
      );
      return po;
    }
  } catch (e) {
    // Do nothing.
  }
  return;
};
