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

/**
 * 这个函数旨在生成一个性能高、唯一的 30 字符的字符串
 * 通过组合版本号、当前时间戳和13位数字整数生成唯一的字符串
 * @return {string}
 */
export const generateUniqueID = () => {
  // Math.floor(Math.random() * (9e12 - 1)) + 1e12
  // 生成一个范围在 1e12（10^12，最小值）到 9e12（9*10^12，最大值）之间的 13 位随机整数。
  return `v3-${Date.now()}-${Math.floor(Math.random() * (9e12 - 1)) + 1e12}`;
};
