import { DEBUG_BUILD } from '../debug-build';
import type { WorkerRequest, WorkerResponse } from '../types';
import { logger } from '../util/logger';

/**
 * 这个类用于管理与 Web Worker 的交互，包括发送消息、接收消息、确保 Worker 准备就绪等功能
 * 仅为测试导出
 */
export class WorkerHandler {
  /**
   * 保存 Web Worker 的实例，用于向 Worker 发送消息和接收消息
   */
  private _worker: Worker;
  /**
   * 用于给每个消息分配唯一的 ID，从而确保消息和响应能够正确匹配
   * 每次发送消息时，该 ID 会自增，用于标识不同的请求
   */
  private _id: number;
  /**
   * 用于确保 Worker 在首次初始化时的准备工作只执行一次
   */
  private _ensureReadyPromise?: Promise<void>;

  public constructor(worker: Worker) {
    // 接收一个 Web Worker 实例并将其存储在 _worker 属性中
    this._worker = worker;
    this._id = 0;
  }

  /**
   * 确保 Worker 准备就绪
   */
  public ensureReady(): Promise<void> {
    // 如果已经有一个准备 Promise，则直接返回这个 Promise，不会重复创建。
    if (this._ensureReadyPromise) {
      return this._ensureReadyPromise;
    }

    this._ensureReadyPromise = new Promise((resolve, reject) => {
      // 监听 Worker 的消息事件，判断 Worker 是否成功准备就绪
      this._worker.addEventListener(
        'message',
        ({ data }: MessageEvent) => {
          if ((data as WorkerResponse).success) {
            resolve();
          } else {
            reject();
          }
        },
        { once: true },
      );

      // 监听错误
      this._worker.addEventListener(
        'error',
        (error) => {
          reject(error);
        },
        { once: true },
      );
    });

    return this._ensureReadyPromise;
  }

  /**
   * 终止 Worker，释放资源。当不再需要与 Worker 通信时调用此方法
   */
  public destroy(): void {
    DEBUG_BUILD && logger.info('Destroying compression worker');
    this._worker.terminate();
  }

  /**
   * 负责向 Worker 发送消息并等待响应
   */
  public postMessage<T>(
    method: WorkerRequest['method'],
    arg?: WorkerRequest['arg'],
  ): Promise<T> {
    // 生成唯一的消息 ID，确保每次发送的消息都有独立标识符，从而可以匹配正确的响应
    // 这里是自增
    const id = this._getAndIncrementId();

    return new Promise((resolve, reject) => {
      // 当 Worker 发送消息时触发。它监听 Worker 的消息事件
      const listener = ({ data }: MessageEvent): void => {
        // 检查返回的数据 response 是否对应当前的 method
        // 如果返回的响应与当前方法不匹配，则直接返回，不做处理
        // 因为可能多个请求同时发给 Worker，而我们只处理与当前方法匹配的响应
        const response = data as WorkerResponse;
        if (response.method !== method) {
          return;
        }

        // 使用消息的 id 来确保消息和响应是配对的
        // 如果 Worker 返回的消息 ID 不等于当前请求的 ID，说明这不是我们当前请求的响应，因此忽略这条消息
        if (response.id !== id) {
          return;
        }

        // 当收到正确的响应后，无论成功或失败，都移除这个监听器，避免内存泄漏或重复监听
        // 这里是因为每次发送消息都会监听 message 消息
        this._worker.removeEventListener('message', listener);

        if (!response.success) {
          // Worker 出现错误
          // TODO: Do some error handling, not sure what
          DEBUG_BUILD &&
            logger.error('Error in compression worker: ', response.response);

          reject(new Error('Error in compression worker'));
          return;
        }

        // 返回成功的promise，将数据返回
        resolve(response.response as T);
      };

      // 注意：我们不能使用‘ once ’选项，因为它可能需要监听多个消息
      // 用于接收 Worker 的响应。这个监听器是每次发送消息时动态添加的
      this._worker.addEventListener('message', listener);
      // 将消息发送给 Worker
      this._worker.postMessage({ id, method, arg });
    });
  }

  /** 获取当前ID并为下一次调用增加它
   *
   * @example
   * let d = 5
   * ++d 先对 d 加 1，然后返回 6
   * d++ 先返回原始值 6，然后对 d 加 1
   */
  private _getAndIncrementId(): number {
    return this._id++;
  }
}
