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

export interface OnHiddenCallback {
  (event: Event): void;
}

/**
 * 这个函数用于在浏览器页面被隐藏时执行某个回调函数
 *
 * @param cb
 */
export const onHidden = (cb: OnHiddenCallback) => {
  /**
   * 这个函数用于处理页面隐藏事件
   * @param event
   */
  const onHiddenOrPageHide = (event: Event) => {
    if (
      // 断事件类型是否为 pagehide
      event.type === 'pagehide' ||
      // 当前文档的可见性状态是否为 hidden
      (WINDOW.document && WINDOW.document.visibilityState === 'hidden')
    ) {
      // 如果是其中之一，说明当页面被隐藏或用户切换到其他标签页，执行回调
      cb(event);
    }
  };

  // 确保当前环境是一个浏览器环境
  if (WINDOW.document) {
    addEventListener('visibilitychange', onHiddenOrPageHide, true);
    // 为了兼容一些可能存在问题的浏览器实现，再添加一个 pagehide 事件的监听器。
    // 这两个事件组合使用确保在多种浏览器环境中都能正确地检测到页面隐藏事件。
    addEventListener('pagehide', onHiddenOrPageHide, true);

    /**
     * addEventListener 的第三个参数， 用于指定事件监听器是否在捕获阶段执行
     *
     * 设置为 true 将在捕获阶段执行，而不是在冒泡阶段，从而使得它在冒泡阶段之前处理事件。
     * 这样可以确保即使在存在多个事件监听器的情况下，该回调函数能够第一时间响应 visibilitychange 或 pagehide 事件
     *
     *
     * 捕获阶段 (Capturing Phase)：
     *  - 在事件传播的捕获阶段，事件会从根节点（如 window）逐层向下传播到目标元素。
     *  这意味着在事件到达目标元素之前，会先经过所有的父元素。
     *
     * 冒泡阶段 (Bubbling Phase)：
     *  - 在事件传播的冒泡阶段，事件会从目标元素逐层向上传播到根节点。这是 DOM 事件传播的默认方式。
     *
     * 如果 useCapture 设置为 false（或者不传入第三个参数），事件监听器将在冒泡阶段触发
     *
     */
  }
};
