import type { ViewModel } from '../types';

// Vendored from https://github.com/vuejs/vue/blob/612fb89547711cacb030a3893a0065b785802860/src/core/util/debug.js
// with types only changes.

// The MIT License (MIT)

// Copyright (c) 2013-present, Yuxi (Evan) You

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

/**
 * (?:...) 是一个非捕获组，表示只做匹配但不捕获匹配的内容
 * [-_] 匹配连接符 - 或 _
 * (\w) 匹配一个字母或数字（即单词字符），并将其捕获
 *
 * 整体意思是匹配字符串开头或任何连接符后的一个字母或数字
 */
const classifyRE = /(?:^|[-_])(\w)/g;
/**
 * 这个函数的作用是将字符串转换为“类名”风格，即去除连接符（如 - 和 _）并将每个单词的首字母大写
 * @param str
 * @returns
 * @example
 * my-component 转换为 MyComponent
 */
const classify = (str: string): string =>
  str.replace(classifyRE, (c) => c.toUpperCase()).replace(/[-_]/g, '');

const ROOT_COMPONENT_NAME = '<Root>';
const ANONYMOUS_COMPONENT_NAME = '<Anonymous>';

/**
 * 用于将一个字符串重复指定次数
 * @param str
 * @param n
 * @returns
 */
const repeat = (str: string, n: number): string => {
  return str.repeat(n);
};

/**
 * 用于格式化 Vue 组件的名称，使其更加易于识别和调试。
 * 它能够根据传入的组件实例 (vm) 返回该组件的名称，并可以选择性地包含组件的文件路径信息
 * @param vm  Vue 组件实例
 * @param includeFile 表示是否在返回的组件名称中包含组件的文件路径
 * @returns
 */
export const formatComponentName = (
  vm?: ViewModel,
  includeFile?: boolean,
): string => {
  if (!vm) {
    // 没有传入 Vue 组件实例，函数会返回一个默认的匿名组件名称
    return ANONYMOUS_COMPONENT_NAME;
  }

  if (vm.$root === vm) {
    // 如果当前组件是根组件，返回表示根组件的常量
    return ROOT_COMPONENT_NAME;
  }

  // https://github.com/getsentry/sentry-javascript/issues/5204 $options can be undefined
  if (!vm.$options) {
    // 因为 vm.$options 可能会是 undefined（如在某些特殊情况下），
    // 这里做了一个防御性检查。如果 vm.$options 不存在，则返回匿名组件名称。
    return ANONYMOUS_COMPONENT_NAME;
  }

  const options = vm.$options;

  // options.name：通常是开发者在组件定义中指定的名称
  // options._componentTag：可能是一个内部的组件标签
  // options.__file：这是 Vue 编译器生成的文件路径信息

  let name = options.name || options._componentTag;
  const file = options.__file;
  if (!name && file) {
    // 如果 name 不存在，且文件路径 file 存在，则尝试通过正则表达式匹配文件名

    // 去掉路径和文件扩展名来获取组件名称
    // ([^/\\]+) 匹配不包含 / 和 \ 的一个或多个字符，即文件名
    // [^...]：表示一个否定字符集，即匹配不在括号内的字符
    // /：正斜杠，是路径分隔符，常见于 Unix/Linux 系统（例如 /path/to/file.vue）
    // \\：反斜杠，是路径分隔符，常见于 Windows 系统（例如 C:\\path\\to\\file.vue）

    // \.vue$ 匹配以.vue结尾的
    // match[0] 是匹配到的整个字符串
    // match[1] 是捕获组 ([^/\\]+) 对应的内容，也就是 .vue 文件的文件名
    //  "/path/to/component/MyComponent.vue"; -------> MyComponent

    const match = file.match(/([^/\\]+)\.vue$/);
    // 如果文件路径不符合 .vue 文件的格式，match 将为 null
    if (match) {
      name = match[1];
    }
  }

  return (
    // classify(name)：这个函数通常是将组件名称转换为更具辨识度的格式，
    // 如  my-component 转换为 MyComponent）
    (name ? `<${classify(name)}>` : ANONYMOUS_COMPONENT_NAME) +
    (file && includeFile !== false ? ` at ${file}` : '')
  );
};

/**
 * 这个函数的作用是生成一个 Vue 组件的调用栈，用于在调试或错误报告时显示组件的层次结构
 * 这个函数遍历给定 Vue 实例 (vm) 的父组件链，并生成一个字符串表示组件的层次结构，包括可能的递归调用次数
 * @param vm
 * @returns
 */
export const generateComponentTrace = (vm?: ViewModel): string => {
  console.log('vm', vm);

  if (vm && (vm._isVue || vm.__isVue) && vm.$parent) {
    // 确保 vm 是一个 Vue 实例，并且有一个父组件（即 vm.$parent 不为空，跟组件才没有$parent）
    // vm._isVue 和 vm.__isVue 是 Vue 的内部标志，用于识别一个对象是否为 Vue 实例

    // 数组用于存储遍历过程中遇到的组件，栈结构
    const tree = [];
    // 用于记录连续出现的递归组件
    let currentRecursiveSequence = 0;

    // 这个 while 循环的主要任务是从当前组件开始，一直向上遍历它的父组件链，直到没有父组件为止。
    // 它会将这些组件记录在 tree 数组中，同时还处理了递归组件（即相同组件重复嵌套）的情况
    while (vm) {
      if (tree.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        // 获取栈顶组件
        const last = tree[tree.length - 1] as any;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access

        // 如果当前组件和前一个组件的构造函数相同（如果是同一个组件，就说明这是一个递归调用）
        if (last.constructor === vm.constructor) {
          // 递增，表示递归调用的深度。
          currentRecursiveSequence++;
          vm = vm.$parent; // eslint-disable-line no-param-reassign
          continue;
        } else if (currentRecursiveSequence > 0) {
          // 处理非递归组件
          // 如果 currentRecursiveSequence 大于 0（即已经检测到递归）
          // 并且当前组件不再是递归组件，则将前一个递归组件的信息（包括递归次数）更新到 tree 中
          tree[tree.length - 1] = [last, currentRecursiveSequence];
          currentRecursiveSequence = 0;
        }
      }

      // 将当前vm 压入栈中
      tree.push(vm);
      vm = vm.$parent; // eslint-disable-line no-param-reassign
    }

    // 这段代码的目的是将 Vue 组件的层级关系以可读的字符串格式化输出，用于表示组件树的调用关系
    const formattedTree = tree
      .map(
        (vm, i) =>
          `${
            // 对于第一个组件，前面会加上 ---> ，而对于后续的组件添加空格，以表示层级关系
            // 根节点前面没有空格，第二层的节点前面有 5 个空格，第三层的节点前面有 7 个空格，以此类推
            (i === 0 ? '---> ' : repeat(' ', 5 + i * 2)) +
            (Array.isArray(vm)
              ? // 如果是数组，说明当前组件是一个递归调用
                // 会输出格式为 组件名... ，其中 vm[1] 是递归调用的次数。
                `${formatComponentName(vm[0])}... (${vm[1]} recursive calls)`
              : formatComponentName(vm))
          }`,
      )
      //   将所有生成的字符串合并为一个以换行符分隔的字符串，最终结果表示组件树的调用关系。
      .join('\n');

    return `\n\nfound in\n\n${formattedTree}`;
  }

  return `\n\n(found in ${formatComponentName(vm)})`;
};
