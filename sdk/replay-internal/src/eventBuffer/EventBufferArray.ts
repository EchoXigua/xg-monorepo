import { REPLAY_MAX_EVENT_BUFFER_SIZE } from '../constants';
import type {
  AddEventResult,
  EventBuffer,
  EventBufferType,
  RecordingEvent,
} from '../types';
import { timestampToMs } from '../util/timestamp';
import { EventBufferSizeExceededError } from './error';

/**
 * 这个类主要用于事件缓冲，不进行任何压缩
 * 如果无法加载或禁用压缩工作程序，则用作回退
 */
export class EventBufferArray implements EventBuffer {
  /** 存储待发送的事件 */
  public events: RecordingEvent[];

  /**
   * 是否已经进行了检查点
   * Checkout：通常指的是一个特定的状态保存或检查点，意味着在某个时刻保存当前状态，以便稍后能够恢复或引用。
   * @inheritdoc
   */
  public hasCheckout: boolean;

  /** 跟踪缓冲区中事件的总大小 */
  private _totalSize: number;

  public constructor() {
    this.events = [];
    this._totalSize = 0;
    this.hasCheckout = false;
  }

  /**
   * 检查缓冲区中是否有事件
   * @inheritdoc
   *
   */
  public get hasEvents(): boolean {
    return this.events.length > 0;
  }

  /**
   * 缓冲区的类型，这里是同步的事件缓冲
   * @inheritdoc
   *
   */
  public get type(): EventBufferType {
    return 'sync';
  }

  /**
   * 销毁，将事件数组清空，释放资源
   * @inheritdoc
   *
   */
  public destroy(): void {
    this.events = [];
  }

  /**
   * 向缓冲区添加事件
   * @inheritdoc
   *
   */
  public async addEvent(event: RecordingEvent): Promise<AddEventResult> {
    // 将事件序列化为 JSON 并计算其大小
    const eventSize = JSON.stringify(event).length;
    // 更新缓冲区大小
    this._totalSize += eventSize;

    // 检查是否超过最大缓冲区大小
    if (this._totalSize > REPLAY_MAX_EVENT_BUFFER_SIZE) {
      throw new EventBufferSizeExceededError();
    }

    // 将事件添加到缓冲区
    this.events.push(event);
  }

  /**
   * 用于完成事件处理
   * @inheritdoc
   */
  public finish(): Promise<string> {
    return new Promise<string>((resolve) => {
      /**
       * - 保存当前事件的引用：将 this.events 的引用赋值给 eventsRet，这样 eventsRet 变量就指向当前的事件数组
       * - 清空事件数组：调用 this.clear()，清空 this.events 数组，这样在上传过程中不会丢失新的事件
       */

      // 创建 eventsRet 的引用，获取当前的事件数组
      const eventsRet = this.events;
      // 清空事件数组以避免丢失新事件
      this.clear();
      // 转为JSON 字符串，返回一个成功的 promise
      resolve(JSON.stringify(eventsRet));
    });
  }

  /**
   * 清空缓冲区
   * @inheritdoc
   */
  public clear(): void {
    this.events = [];
    this._totalSize = 0;
    this.hasCheckout = false;
  }

  /**
   * 获取缓冲区中事件的最早时间戳
   *  @inheritdoc
   */
  public getEarliestTimestamp(): number | null {
    // 返回最早的时间戳
    /**
     * @example
     * [10, 1, 21, 2],sort();
     * 输出: [1, 10, 2, 21]
     *
     * [10, 1, 21, 2].sort((a, b) => a - b)
     * 输出: [1, 2, 10, 21]
     */
    const timestamp = this.events.map((event) => event.timestamp).sort()[0];

    if (!timestamp) {
      return null;
    }

    // 将时间戳转换为毫秒
    return timestampToMs(timestamp);
  }
}
