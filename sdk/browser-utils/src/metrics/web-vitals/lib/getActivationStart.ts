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

import { getNavigationEntry } from './getNavigationEntry';

/**
 * 获取页面激活（activation）的开始时间，特别是针对预渲染的页面
 * 如果页面是通过预渲染加载的，那么 activationStart 表示页面从预渲染状态变为可交互状态的时间
 *
 * @returns
 */
export const getActivationStart = (): number => {
  const navEntry = getNavigationEntry();
  return (navEntry && navEntry.activationStart) || 0;
};
