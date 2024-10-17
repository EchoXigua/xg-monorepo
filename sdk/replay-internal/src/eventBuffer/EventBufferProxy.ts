import type { ReplayRecordingData } from '@xigua-monitor/types';

import { DEBUG_BUILD } from '../debug-build';
import type {
  AddEventResult,
  EventBuffer,
  EventBufferType,
  RecordingEvent,
} from '../types';
import { logger } from '../util/logger';
import { EventBufferArray } from './EventBufferArray';
import { EventBufferCompressionWorker } from './EventBufferCompressionWorker';

/**
 * 这个类用来在事件缓冲区中进行压缩操作，同时提供了一个后备方案，当压缩的 worker 不能加载或出现错误时，
 * 使用一个简单的事件缓冲区 (EventBufferArray) 作为替代。
 */
export class EventBufferProxy implements EventBuffer {
  // 这里维护了两个缓冲区，代理缓冲区允许优雅地处理压缩 worker 的加载失败场景，始终确保事件被正确缓冲

  /** 简单的事件缓冲区，不进行压缩，确保在压缩机制失败时，仍然有事件缓冲能力 */
  private _fallback: EventBufferArray;
  /**
   * 压缩缓冲区，通过 Web Worker 进行压缩
   * 当系统可以正常加载 worker 时，使用此对象对事件进行压缩并缓冲
   */
  private _compression: EventBufferCompressionWorker;
  /**
   * 当前正在使用的缓冲区，保证对事件的缓冲操作始终有一个有效的缓冲机制，
   * 无论是简单的数组还是压缩的 worker。
   *
   * 初始值为简单缓冲区，当确认压缩 worker 正常工作后会切换为压缩缓冲区
   */
  private _used: EventBuffer;
  /** 保证压缩 worker 已经正确加载的 Promise 对象 */
  private _ensureWorkerIsLoadedPromise: Promise<void>;

  public constructor(worker: Worker) {
    this._fallback = new EventBufferArray();
    this._compression = new EventBufferCompressionWorker(worker);
    // 初始状态使用简单缓冲区
    this._used = this._fallback;

    // 确保 worker 被正确加载
    this._ensureWorkerIsLoadedPromise = this._ensureWorkerIsLoaded();
  }

  /**
   * 获取当前缓冲区的类型
   * @inheritdoc
   */
  public get type(): EventBufferType {
    return this._used.type;
  }

  /**
   * 当前缓冲区是否有事件
   * @inheritDoc
   */
  public get hasEvents(): boolean {
    return this._used.hasEvents;
  }

  /**
   * 缓冲区中是否已经有快照（Checkout）
   * @inheritdoc
   */
  public get hasCheckout(): boolean {
    return this._used.hasCheckout;
  }
  /**
   * 设置缓冲区中是否有快照
   * @inheritdoc
   */
  public set hasCheckout(value: boolean) {
    this._used.hasCheckout = value;
  }

  /**
   * 销毁当前缓冲区中的内容，清理所有缓冲的事件
   * @inheritDoc
   */
  public destroy(): void {
    this._fallback.destroy();
    this._compression.destroy();
  }

  /**
   * 清除当前缓冲区中的所有事件，重置事件和缓冲的大小
   * @inheritdoc
   */
  public clear(): void {
    return this._used.clear();
  }

  /**
   * 获取缓冲区中最早事件的时间戳
   * @inheritdoc
   */
  public getEarliestTimestamp(): number | null {
    return this._used.getEarliestTimestamp();
  }

  /**
   * 向缓冲区添加一个新事件。如果当前缓冲区为压缩缓冲区，它会尝试将事件发送到 worker 进行压缩。
   */
  public addEvent(event: RecordingEvent): Promise<AddEventResult> {
    return this._used.addEvent(event);
  }

  /**
   * 完成事件录制并将缓冲区中的事件数据打包准备发送。
   * 会等待 worker 压缩缓冲区准备好，再打包数据。
   * @inheritDoc
   */
  public async finish(): Promise<ReplayRecordingData> {
    // 确保worker被加载，所有发送的事件被压缩
    await this.ensureWorkerIsLoaded();

    return this._used.finish();
  }

  /**
   * 提供一个保证机制，在操作缓冲区前确保压缩 worker 准备好
   */
  public ensureWorkerIsLoaded(): Promise<void> {
    return this._ensureWorkerIsLoadedPromise;
  }

  /**
   * 实际执行压缩 worker 的加载工作
   * Actually check if the worker has been loaded.
   */
  private async _ensureWorkerIsLoaded(): Promise<void> {
    try {
      await this._compression.ensureReady();
    } catch (error) {
      // 如果加载失败，则切换到后备的简单缓冲区（不作替换了）
      DEBUG_BUILD &&
        logger.exception(
          error,
          'Failed to load the compression worker, falling back to simple buffer',
        );
      return;
    }

    // 现在我们需要将简单缓冲区切换到压缩缓冲区
    await this._switchToCompressionWorker();
  }

  /**
   * 将当前缓冲区切换到压缩 worker，迁移之前缓冲的事件到压缩缓冲区
   */
  private async _switchToCompressionWorker(): Promise<void> {
    // 取出缓冲区中的事件和是否已经记录了快照
    const { events, hasCheckout } = this._fallback;

    const addEventPromises: Promise<void>[] = [];
    for (const event of events) {
      // 将每个事件添加到压缩缓冲区，这里的 addEvent 是异步操作
      // 需要一些时间处理数据，尤其是在涉及到压缩时，可能需要更多的时间
      addEventPromises.push(this._compression.addEvent(event));
    }

    // 将快照标记同步到压缩缓冲区，后续的所有事件将直接添加到压缩缓冲区中
    this._compression.hasCheckout = hasCheckout;

    // 将当前缓冲区切换为压缩缓冲区
    this._used = this._compression;

    // 确保在所有事件成功添加到压缩缓冲区后，方法才会完成。这保证了在切换到压缩缓冲区时，事件不会丢失
    try {
      // 这里相当于暂停代码的执行，直到所有事件都添加完毕
      // 如果有任何一个 Promise 失败，Promise.all 会立即抛出错误，进入 catch 块进行异常处理
      await Promise.all(addEventPromises);
    } catch (error) {
      DEBUG_BUILD &&
        logger.exception(error, 'Failed to add events when switching buffers.');
    }
  }
}
