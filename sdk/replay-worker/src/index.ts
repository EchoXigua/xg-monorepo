import workerString from './worker';

/**
 * 获取web worker的URL
 */
export function getWorkerURL(): string {
  /**
   * Blob 是一种表示不可变的类文件对象的原始数据的结构
   *
   * Blob 的用法：
   * const blob = new Blob([data], { type: 'mime/type' });
   * - data: 这是要存储在 Blob 中的内容，类型可以是字符串、ArrayBuffer、TypedArray 或其他 Blob 对象的数组
   * - type: 这是一个可选的 MIME 类型字符串，用于指定 Blob 中数据的类型
   *
   * ArrayBuffer 和 TypedArray
   *
   * - ArrayBuffer 是一个通用的、固定长度的原始二进制数据缓冲区。它可以用来表示任何二进制数据。
   * 不能直接读取或写入 ArrayBuffer 的内容。你需要通过 TypedArray 或 DataView 来访问它的内容。
   *
   * - TypedArray 是一组视图类型的数组，允许你以特定的数据类型对 ArrayBuffer 进行操作（读取和写入数据）
   * 每种 TypedArray 代表了不同的类型，比如 Int8Array, Uint8Array, Float32Array 等。
   *
   * @example
   * const buffer = new ArrayBuffer(16); // 创建一个 16 字节的 ArrayBuffer
   * const int8View = new Int8Array(buffer); // 创建一个 8 位有符号整数视图
   * const uint8View = new Uint8Array(buffer); // 创建一个 8 位无符号整数视图
   *
   * int8View[0] = -128; // 设置第一个元素为 -128
   * uint8View[1] = 255; // 设置第二个元素为 255
   */
  const workerBlob = new Blob([workerString]);
  // 创建一个指向 Blob 对象的 URL，这个 URL 可以用来在 Worker 中加载代码
  return URL.createObjectURL(workerBlob);
}
