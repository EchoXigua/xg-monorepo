/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Compressor, compress } from './Compressor';

// 处理压缩操作的类实例
const compressor = new Compressor();

interface Handlers {
  /** 清理内部数据或缓冲区 */
  clear: () => void;
  /** 添加事件 */
  addEvent: (data: string) => void;
  /** 完成操作并返回压缩数据 */
  finish: () => Uint8Array;
  /** 对传入的数据进行压缩并返回压缩后的结果 */
  compress: (data: string) => Uint8Array;
}

const handlers: Handlers = {
  clear: () => {
    compressor.clear();
  },

  addEvent: (data: string) => {
    return compressor.addEvent(data);
  },

  finish: () => {
    return compressor.finish();
  },

  compress: (data: string) => {
    return compress(data);
  },
};

/**
 * Web Worker 中的消息处理器，处理来自主线程的消息
 */
export function handleMessage(e: MessageEvent): void {
  // 获取消息的内容，这里通过 method 和 id 匹配到对应的请求响应（一个方法可能有多个请求）
  const method = e.data.method as string;
  const id = e.data.id as number;
  const data = e.data.arg as string;

  // 检查 method 是否存在于 handlers 中，并且是否为函数
  if (method in handlers && typeof handlers[method] === 'function') {
    try {
      // 尝试执行相应的 handlers 方法，并捕获任何潜在的错误
      const response = handlers[method](data);
      postMessage({
        id,
        method,
        success: true,
        response,
      });
    } catch (err) {
      // 失败时捕获异常，并返回 success: false 和错误信息
      postMessage({
        id,
        method,
        success: false,
        response: (err as Error).message,
      });

      // eslint-disable-next-line no-console
      console.error(err);
    }
  }
}
