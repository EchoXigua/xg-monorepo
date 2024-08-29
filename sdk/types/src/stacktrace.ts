import type { StackFrame } from './stackframe';

/**
 * 主要作用是结构化地存储和表示程序在执行过程中产生的堆栈跟踪信息。
 * 通过记录堆栈帧（StackFrame），开发者可以追踪到具体出错的代码位置，以及该位置在执行过程中是如何被调用的。
 */
export interface Stacktrace {
  /**
   * frames 是一个数组，每个元素都是一个 StackFrame 对象，表示堆栈中的一个帧
   * 堆栈帧按照调用顺序从最早的到最新的依次排列，帮助开发者追踪函数调用链
   */
  frames?: StackFrame[];
  /**
   * 一个元组，表示堆栈跟踪中的某些帧被省略了
   * 元组的第一个数字表示堆栈中被省略的帧的开始索引，第二个数字表示结束索引。
   * 这通常用于减少堆栈跟踪的长度，特别是在某些帧是重复或不重要的情况下
   */
  frames_omitted?: [number, number];
}

/**
 * 用于解析堆栈字符串并返回一个 StackFrame 对象的数组
 */
export type StackParser = (
  // 需要解析的堆栈字符串
  stack: string,
  // 表示在解析堆栈时应该跳过的行数
  skipFirstLines?: number,
  // 表示需要从最终结果中删除的帧数，通常用于调整堆栈的准确性。
  framesToPop?: number,
) => StackFrame[];

/**
 * 用于解析堆栈中的一行，并返回一个 StackFrame 对象, 如果无法解析该行则返回 undefined。
 */
export type StackLineParserFn = (line: string) => StackFrame | undefined;

/**
 * 一个元组类型
 * 第一个元素是一个数字，表示优先级或解析顺序
 * 第二个元素是一个 StackLineParserFn 函数，用于解析堆栈中的一行
 *
 * 用于定义多种解析堆栈行的函数及其优先级，确保在复杂的堆栈结构中能够正确解析出堆栈帧。
 */
export type StackLineParser = [number, StackLineParserFn];
