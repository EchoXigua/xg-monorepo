// Based on https://github.com/angular/angular.js/pull/13945/files
// The MIT License

// Copyright (c) 2010-2016 Google, Inc. http://angularjs.org

// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

import { GLOBAL_OBJ } from '../worldwide';

const WINDOW = GLOBAL_OBJ as unknown as Window;

/**
 * 用于判断当前环境是否支持 HTML5 的 History API
 * 这个功能在许多现代 JavaScript 应用程序中非常重要，
 * 尤其是单页面应用（SPA）中，常常需要进行浏览器历史记录的管理
 *
 * {@link supportsHistory}.
 *
 * @returns Answer to the given question.
 */
export function supportsHistory(): boolean {
  // borrowed from: https://github.com/angular/angular.js/pull/13945/files
  /* eslint-disable @typescript-eslint/no-unsafe-member-access */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any

  // 检查是否在 Chrome 应用环境中( 指的是 Chrome 打包应用（Packaged Apps）或 Chrome 扩展的上下文环境)
  // 在某些 Chrome App 环境中，访问 history.pushState 可能会触发错误日志，即使这段代码被包裹在 try/catch 语句中
  // 因此在这种环境中，我们不希望触发 History API 的相关调用。
  // 所以还需要判断是否处于 Chrome App 环境中
  const chromeVar = (WINDOW as any).chrome;
  // 判断当前环境是否是一个 Chrome 打包应用（Chrome Packaged App）
  const isChromePackagedApp =
    chromeVar && chromeVar.app && chromeVar.app.runtime;
  /* eslint-enable @typescript-eslint/no-unsafe-member-access */

  // 确保 WINDOW 对象中存在 history 对象
  const hasHistoryApi =
    'history' in WINDOW &&
    // 并且 pushState 和 replaceState 方法均可用
    !!WINDOW.history.pushState &&
    !!WINDOW.history.replaceState;

  // 检查当前不是 Chrome 打包应用且支持 History API
  return !isChromePackagedApp && hasHistoryApi;
}
