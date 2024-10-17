import { EncodeUTF8, Zlib, compressSync, strToU8 } from 'fflate';

/**
 * 注意：
 *
 * Compressor 类内部的代码是同步的，但它是在 Web Worker 内部运行，因此不会影响主线程的执行
 *
 * 主线程与 Worker 之间的通信是异步的，主线程不会等待 Worker 的压缩任务完成，而是通过消息回调机制获取压缩结果
 */

/**
 * fflate 是一个轻量级且高效的 JavaScript 数据压缩库，支持多种压缩和解压缩算法，主要用于处理如 gzip、deflate 等压缩格式
 *
 * 1. 轻量高效：fflate 的设计初衷是尽可能小的包体积，同时保持高性能
 * 它是纯 JavaScript 实现，因此可以在浏览器和 Node.js 中使用
 *
 * 2. 支持多种格式：支持常用的压缩格式，如 gzip、zlib、deflate 和 zip
 * 此外，还可以在浏览器中实现基于 Web Workers 的异步压缩操作，以避免阻塞主线程
 *
 * 3. 同步与异步操作：fflate 既可以执行同步操作，也可以通过 Web Workers 进行异步处理，适用于不同场景需求
 * 你可以使用同步的 compressSync 或 unzipSync，也可以使用异步的 compress 或 unzip
 */

/**
 * 实现了一个有状态的压缩器，能够批量压缩事件
 *
 * 使用了 fflate 库中的 EncodeUTF8 和 Zlib 实现压缩功能，
 * 整个过程通过流式处理来逐步收集事件，最终将所有事件压缩并输出为 Uint8Array 格式的数据
 *
 * 1. stream:
 * - 作用: stream 是通过 fflate 库的 EncodeUTF8 类创建的，用来将字符串数据编码为 UTF-8 字节流
 * 它本质上是一个数据流管道，逐步将数据压入（通过 push() 方法），并将这些数据作为字节数组提供给压缩器
 *
 * - 工作原理: stream.push(data) 会将字符串数据推送到流中，这些数据会被编码为字节，接着通过回调函数传递给压缩器。
 * 在这里，EncodeUTF8 会将数据以流的形式传递给 deflate 进行进一步处理
 *
 * 2. Zlib (Deflate)
 * - 作用: Zlib 是一种压缩算法，特别适用于将大规模数据压缩为更小的字节表示。它也是 fflate 库的一部分
 * 在这个类中，Zlib 实例作为压缩器，负责接收字节数据并进行压缩
 *
 * - 工作原理: 当 stream 产生字节数据后，deflate.push(data, final) 会将这些数据逐步传递给压缩器。
 * 每当有一块数据被压缩完成时，ondata 回调函数就会被触发，压缩后的数据块会被推入 _deflatedData 数组中
 * 最终，这些压缩后的数据块会被合并成一个完整的压缩数据结果
 *
 *
 * 这里说一下数据流(stream)的概念
 * > 流（Stream）是一种处理数据的方式，特别适用于处理大规模数据或者逐步到达的数据。
 * 流不会一次性处理所有数据，而是逐步读取和处理数据块，这样可以显著降低内存占用，并提高效率
 */
export class Compressor {
  /**
   * 用于将字符串编码为 UTF-8 格式的流
   * 通过 EncodeUTF8 类，可以将事件推送到编码流中并将其输出为字节数组
   */
  public stream: EncodeUTF8;

  /**
   * 用于压缩数据的 Zlib 实例
   * Zlib 是一个流式压缩器，支持 DEFLATE 算法
   */
  public deflate: Zlib;

  /**
   * 用于存储压缩后的数据块，每次有新的压缩数据时都会保存到这个数组中
   */
  private _deflatedData: Uint8Array[];

  /**
   * 用来记录是否已经有事件被添加，防止出现空事件列表
   */
  private _hasEvents: boolean;

  public constructor() {
    this._init();
  }

  /**
   * 用来重置压缩器的状态。每次调用这个方法都会重新初始化内部缓冲区，
   * 使得压缩器可以清理已有的数据并开始新的批次处理
   */
  public clear(): void {
    this._init();
  }

  /**
   *  用于将新的事件添加到压缩缓冲区中
   */
  public addEvent(data: string): void {
    if (!data) {
      throw new Error('Adding invalid event');
    }
    // 每次添加事件时，如果该事件不是第一个，会在前面加上逗号 ,，以确保它们最终组合成一个有效的 JSON 数组
    const prefix = this._hasEvents ? ',' : '';

    // 将事件推送到 UTF-8 编码器中
    this.stream.push(prefix + data);

    this._hasEvents = true;
  }

  /**
   * 用于完成当前的压缩操作
   */
  public finish(): Uint8Array {
    // 首先在编码流中添加右括号 ]，表示 JSON 数组的结束
    this.stream.push(']', true);

    // 将之前压缩好的数据块合并为一个 Uint8Array
    const result = mergeUInt8Arrays(this._deflatedData);

    // 重新初始化压缩器，清空状态以便下一次使用
    this._init();

    // 返回合并后的压缩数据
    return result;
  }

  /**
   * 压缩器的初始化方法，设置初始状态
   */
  private _init(): void {
    this._hasEvents = false;
    this._deflatedData = [];

    // 创建 Zlib 实例
    this.deflate = new Zlib();

    /**
     * deflate.ondata 是一个回调函数, 当一块数据被压缩时，它将接收到压缩后的数据并存储在 _deflatedData 数组中
     * 来收集压缩后的数据
     */
    this.deflate.ondata = (data, _final) => {
      this._deflatedData.push(data);
    };

    // 创建 EncodeUTF8 编码流，数据经过编码后直接推送到 deflate 流进行压缩
    // 每当通过 stream.push 向流中添加数据时,会将这些数据编码为字节,通过回调函数传递给 Zlib 的 deflate.push 进行压缩
    this.stream = new EncodeUTF8((data, final) => {
      this.deflate.push(data, final);
    });

    // 预先向 stream 推送 [，模拟一个 JSON 数组的开头
    this.stream.push('[');
  }
}

/**
 * 一个独立的静态方法，用来直接压缩传入的字符串
 * 不依赖 Compressor 实例，而是直接使用 fflate 的 compressSync 函数
 */
export function compress(data: string): Uint8Array {
  return compressSync(strToU8(data));
}

/**
 * 用于合并多个 Uint8Array 数据块，将它们连接为一个连续的数组
 * @param chunks
 * @returns
 */
function mergeUInt8Arrays(chunks: Uint8Array[]): Uint8Array {
  // 计算出总长度
  let len = 0;

  for (const chunk of chunks) {
    len += chunk.length;
  }

  // 逐个合并数据块
  const result = new Uint8Array(len);

  for (let i = 0, pos = 0, l = chunks.length; i < l; i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const chunk = chunks[i]!;
    result.set(chunk, pos);
    pos += chunk.length;
  }

  return result;
}
