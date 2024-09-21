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

import { WINDOW } from '../../../types';

/**
 * 用于跟踪页面首次隐藏的时间
 */
let firstHiddenTime = -1;

/**
 * 这个函数用于初始化一个 firstHiddenTime 变量，以记录页面首次隐藏的时间
 */
const initHiddenTime = () => {
  /**
   * 针对预渲染状态，我们不能立即将其视为真正的后台加载，需要在预渲染完成之后再决定页面的真实可见性
   */
  // 如果文档的可见性状态是 'hidden' 并且当前不是在预渲染状态下
  // 则认为页面在加载时就一直是隐藏的，将 firstHiddenTime 设置为 0（表示当前时间）
  // 否则设置为 Infinity，表示尚未记录任何隐藏时间
  firstHiddenTime =
    WINDOW.document!.visibilityState === 'hidden' &&
    !WINDOW.document!.prerendering
      ? 0
      : Infinity;
};

/**
 * 处理可见性状态变化事件，记录首次隐藏时间
 * @param event
 */
const onVisibilityUpdate = (event: Event) => {
  // 如果文档是'hidden'并且之前没有设置过隐藏时间，则根据当前事件数据更新它
  if (WINDOW.document!.visibilityState === 'hidden' && firstHiddenTime > -1) {
    /**
     * 如果事件是'visibilitychange'事件，意味着页面在此变化之前是可见的，所以事件时间戳是第一次隐藏时间
     * 但是如果事件不是'visibilitychange'事件，那么它一定是'prerenderingchange'事件
     *
     * 在 prerenderingchange 事件中，由于文档的可见性状态仍然是 'hidden'，所以可以推测页面一直处于后台状态，从未显示给用户。
     * 这样，我们可以合理地认为，第一次隐藏时间应该设置为 0，表示在页面加载的过程中，页面从未真正可见过。
     */

    // 更新第一次隐藏时间
    // 如果事件不是 visibilitychange: 则意味着是 prerenderingchange 事件，
    // 此时我们认为页面是在背景状态下始终隐藏的，所以将 firstHiddenTime 设置为 0。
    firstHiddenTime = event.type === 'visibilitychange' ? event.timeStamp : 0;

    // 一旦我们设置了 firstHiddenTime，就不再需要监听这两个事件
    // 所以移除这两个事件的处理以避免重复调用，保持性能
    removeEventListener('visibilitychange', onVisibilityUpdate, true);
    removeEventListener('prerenderingchange', onVisibilityUpdate, true);
  }
};

const addChangeListeners = () => {
  // 监听页面可见性事件
  addEventListener('visibilitychange', onVisibilityUpdate, true);
  /**
   * 在页面预渲染状态下，文档的 visibilityState 属性总是返回 'hidden'。
   * 预渲染是浏览器为了提高性能而提前加载页面的功能，但用户并没有看到该页面。
   * 所以仅依赖 visibilitychange 事件并不足以完全追踪页面的可见性。
   * 需要在预渲染完成后进行额外的检查，以确保能正确判断页面的可见性变化。
   */

  // 监听预渲染状态发生变化事件
  addEventListener('prerenderingchange', onVisibilityUpdate, true);
};

/**
 * 这个函数用于监测页面的可见性状态
 *
 * @returns
 */
export const getVisibilityWatcher = () => {
  // 确保是在浏览器环境下 且 页面从未被隐藏过
  if (WINDOW.document && firstHiddenTime < 0) {
    // 当前页面可能是第一次被隐藏

    /**
     * 如果文档在这段代码运行时是隐藏的，假设它从导航开始就一直隐藏。
     * 这表明当页面加载后用户没有看到该页面（例如，由于切换标签页或最小化浏览器），该代码会记录下页面隐藏的时间。
     *
     * “这不是一个完美的启发式”，意思是这个假设并不总是正确。比如，页面可能在用户导航后不久就被隐藏了，
     * 但这段代码仍然会将其视为从导航开始就隐藏。可能会出现一些误差。
     *
     * 直到有可用的 API 支持查询过去的可见性状态”，表明当前浏览器的 API 不能直接获取历史可见性状态
     * （例如，页面是何时隐藏或显示的），所以使用这种假设来填补信息的缺失。
     */
    initHiddenTime();
    addChangeListeners();
  }

  return {
    get firstHiddenTime() {
      return firstHiddenTime;
    },
  };
};
