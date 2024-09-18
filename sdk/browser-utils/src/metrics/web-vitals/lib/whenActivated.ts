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

import { WINDOW } from '../../../types';

/**
 * 这个函数作用是确保在页面被激活时执行回调函数，特别是考虑到页面可能会经历 预渲染（prerendering） 阶段。
 * 预渲染是指浏览器在后台提前渲染页面内容，但页面未真正呈现给用户。当页面被激活后，浏览器会将预渲染的页面呈现出来。
 *
 * @param callback
 */
export const whenActivated = (callback: () => void) => {
  // 确保当前在浏览器环境，且支持 prerendering 属性
  // 这是一个浏览器属性，用于判断当前页面是否处于预渲染状态。
  if (WINDOW.document && WINDOW.document.prerendering) {
    // 如果页面处于预渲染状态（prerendering === true），函数会为 prerenderingchange 事件注册一个监听器。
    // 当页面从预渲染状态转为激活状态时，触发这个事件，执行回调，第三个参数 true 表示捕获阶段处理该事件
    addEventListener('prerenderingchange', () => callback(), true);
  } else {
    // 如果页面当前没有处于预渲染状态（即已经是激活状态），则立即执行回调
    callback();
  }
};
