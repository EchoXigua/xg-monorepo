import type { ReplayRecordingData } from '@xigua-monitor/types';

import { REPLAY_MAX_EVENT_BUFFER_SIZE } from '../constants';
import { DEBUG_BUILD } from '../debug-build';
import type {
  AddEventResult,
  EventBuffer,
  EventBufferType,
  RecordingEvent,
} from '../types';
import { logger } from '../util/logger';
import { timestampToMs } from '../util/timestamp';
import { WorkerHandler } from './WorkerHandler';
import { EventBufferSizeExceededError } from './error';

/**
 * 这个类通过 Web Worker 压缩和管理事件的缓冲区
 * 仅为测试导出
 */
export class EventBufferCompressionWorker implements EventBuffer {
  /**
   * 当前缓冲区中是否包含一次 "checkout" 事件（即系统状态的完整快照）
   * 这个属性在事件重放中非常重要，因为它决定了缓冲区是否有基础的快照数据可以用来回放
   * @inheritdoc
   */
  public hasCheckout: boolean;

  /**
   * 负责与实际的 Web Worker 进行通信
   * 通过它，缓冲区可以将数据发送给 Web Worker 并接收结果
   * WorkerHandler 是对 Web Worker 的一个封装，用于处理消息传递和与工作线程的交互
   */
  private _worker: WorkerHandler;

  /**
   * 记录缓冲区中最早的事件时间戳，用于在需要回放时确定从何时开始
   */
  private _earliestTimestamp: number | null;
  /**
   * 跟踪缓冲区中所有事件的总大小，用于防止缓冲区溢出，当超过指定大小时，会触发错误
   */
  private _totalSize;

  public constructor(worker: Worker) {
    this._worker = new WorkerHandler(worker);
    this._earliestTimestamp = null;
    this._totalSize = 0;
    this.hasCheckout = false;
  }

  /**
   * 当前缓冲区中是否有事件
   * @inheritdoc
   */
  public get hasEvents(): boolean {
    // 如果该属性有值，说明至少有一个事件被添加进来
    return !!this._earliestTimestamp;
  }

  /**
   * 事件缓冲区的类型，该缓冲区依赖于 Web Worker 进行事件处理和压缩
   * @inheritdoc */
  public get type(): EventBufferType {
    return 'worker';
  }

  /**
   * 确保 Web Worker 已经准备好
   * 在添加事件之前或执行其他操作之前调用，确保 Worker 已经启动
   */
  public ensureReady(): Promise<void> {
    return this._worker.ensureReady();
  }

  /**
   * 销毁缓冲区（清除 event）
   */
  public destroy(): void {
    this._worker.destroy();
  }

  /**
   * 添加事件到缓冲区
   *
   * 如果事件被worker成功接收和处理，返回true（promise）
   */
  public addEvent(event: RecordingEvent): Promise<AddEventResult> {
    // 将事件的时间戳转换为毫秒
    const timestamp = timestampToMs(event.timestamp);
    // 检查是否需要更新（即是否当前事件是最早的）
    if (!this._earliestTimestamp || timestamp < this._earliestTimestamp) {
      this._earliestTimestamp = timestamp;
    }

    // 将事件转为字符串
    const data = JSON.stringify(event);
    // 更新缓冲区大小
    this._totalSize += data.length;

    // 判断当前缓冲区大小是否超过限制，如果超过返回错误
    if (this._totalSize > REPLAY_MAX_EVENT_BUFFER_SIZE) {
      return Promise.reject(new EventBufferSizeExceededError());
    }

    // 将事件发送到 Web Worker 进行压缩处理
    return this._sendEventToWorker(data);
  }

  /**
   * 结束当前缓冲区并返回压缩后的事件数据
   */
  public finish(): Promise<ReplayRecordingData> {
    return this._finishRequest();
  }

  /**
   * 清空缓冲区（重置）
   * @inheritdoc
   */
  public clear(): void {
    this._earliestTimestamp = null;
    this._totalSize = 0;
    this.hasCheckout = false;

    // 发送 clear 消息给 Web Worker，通知其清空工作中的缓冲数据
    // 我们不需要等待 Worker 完成这个 clear 操作，因为接下来的消息会按顺序执行，且不会出现混乱或冲突
    // Worker 会按 FIFO（先进先出）的顺序处理来自主线程的消息，这使得不需要显式等待每个单独的消息完成
    this._worker.postMessage('clear').then(null, (e) => {
      DEBUG_BUILD &&
        logger.exception(e, 'Sending "clear" message to worker failed', e);
    });
  }

  /**
   * 获取缓冲区中最早事件的时间戳
   * @inheritdoc
   */
  public getEarliestTimestamp(): number | null {
    return this._earliestTimestamp;
  }

  /**
   * 将序列化后的事件数据（data）发送到 Web Worker
   */
  private _sendEventToWorker(data: string): Promise<AddEventResult> {
    return this._worker.postMessage<void>('addEvent', data);
  }

  /**
   * 向Web Worker 发送 'finish' 消息，等待 Worker 返回压缩后的事件数据
   * 完成后，它会清空缓冲区相关的属性，并将压缩数据返回
   */
  private async _finishRequest(): Promise<Uint8Array> {
    const response = await this._worker.postMessage<Uint8Array>('finish');

    this._earliestTimestamp = null;
    this._totalSize = 0;

    return response;
  }
}
