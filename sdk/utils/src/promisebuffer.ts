import { SentryError } from './error';
import {
  SyncPromise,
  rejectedSyncPromise,
  resolvedSyncPromise,
} from './syncpromise';

export interface PromiseBuffer<T> {
  // exposes the internal array so tests can assert on the state of it.
  // XXX: this really should not be public api.
  $: Array<PromiseLike<T>>;
  add(taskProducer: () => PromiseLike<T>): PromiseLike<T>;
  drain(timeout?: number): PromiseLike<boolean>;
}

/**
 * 用于创建一个 Promise 缓冲区对象，主要作用是限制并控制并发的 Promise 数量，并提供管理这些 Promise 的方法（例如添加、移除和等待所有 Promise 完成）
 * @param limit 缓冲区中允许的最大 Promise 数量，如果超过限制，则新的 Promise 不会被添加到缓冲区
 */
export function makePromiseBuffer<T>(limit?: number): PromiseBuffer<T> {
  const buffer: Array<PromiseLike<T>> = [];

  /** 判断缓冲区是否可以接受新的promise */
  function isReady(): boolean {
    return limit === undefined || buffer.length < limit;
  }

  /**
   * 从队列中移除指定 promise
   *
   * @param task Can be any PromiseLike<T>
   * @returns Removed promise.
   */
  function remove(task: PromiseLike<T>): PromiseLike<T | void> {
    return (
      buffer.splice(buffer.indexOf(task), 1)[0] || Promise.resolve(undefined)
    );
  }

  /**
   * 将 Promise 添加到队列，并在任务完成时自动移除自己
   *
   * @param taskProducer 这里解释了为什么在当前版本的代码中，add 方法使用了函数来生成 Promise，而不是直接传入 Promise
   *        - 在之前的版本中，add 方法直接接受 PromiseLike<T> 类型的 Promise，
   *        Promise 是在调用 add 方法时立即创建的，而 Promise 的执行函数也会马上运行
   *        即便缓冲区已经满了，传递进来的任务仍然会开始执行，违反了缓冲区控制并发的初衷
   *        - 为了解决这个问题，现在 add 方法要求传入一个生产 Promise 的函数，而不是直接传递 Promise 对象
   *        好处是，Promise 的创建被延迟了，直到确保缓冲区有空间时才会生成并执行 Promise
   *
   * @returns The original promise.
   */
  function add(taskProducer: () => PromiseLike<T>): PromiseLike<T> {
    if (!isReady()) {
      // 如果缓冲区满了，返回一个被拒绝的 Promise 并抛出 SentryError
      return rejectedSyncPromise(
        new SentryError('Not adding Promise because buffer limit was reached.'),
      );
    }

    // 启动任务并将其 Promise 添加到队列
    // 被设计为一个函数而不是直接的 Promise，
    // 是为了避免立即执行任务，从而延迟任务的启动直到确认缓冲区有空间
    const task = taskProducer();
    if (buffer.indexOf(task) === -1) {
      // 不在缓冲区才添加
      buffer.push(task);
    }
    void task
      // 成功后移除任务
      .then(() => remove(task))
      /**
       * 使用 then(null, rejectionHandler) 代替 catch(rejectionHandler)，
       * 因为 PromiseLike 没有 .catch() 方法。
       * 这是为了确保与 PromiseLike 接口的兼容性，减少 polyfill 的体积
       */
      .then(null, () =>
        // 处理任务执行过程中发生的错误，将该任务移除
        remove(task).then(null, () => {
          // remove() 返回一个新的 Promise，因此需要添加一个额外的 then(null, ...) 来处理 remove 本身可能失败的情况
        }),
      );
    return task;
  }

  /**
   * 函数的作用是等待缓冲区中的所有 Promise 任务完成，
   * 或者在指定的超时时间内未完成时返回 false，如果所有任务在超时时间内完成，则返回 true
   *
   * @param timeout 如果超时设为 0 或未传递，那么函数会等待所有 Promise 执行完毕
   *
   * @returns
   */
  function drain(timeout?: number): PromiseLike<boolean> {
    return new SyncPromise<boolean>((resolve, reject) => {
      // 记录当前缓冲区中 Promise 的数量
      let counter = buffer.length;

      // 如果缓冲区中没有任务，立即返回 true
      if (!counter) {
        return resolve(true);
      }

      // 设置超时机制
      // 启动一个定时器，等待超时时间到达后自动调用 resolve(false)，表示未能在指定时间内完成所有任务
      const capturedSetTimeout = setTimeout(() => {
        if (timeout && timeout > 0) {
          resolve(false);
        }
      }, timeout);

      // 遍历缓冲区中的任务，为每个任务都附加一个 .then() ，等待任务完成
      buffer.forEach((item) => {
        void resolvedSyncPromise(item).then(() => {
          // 当某个任务完成时，counter 会递减
          if (!--counter) {
            // 如果所有任务都完成了（counter 变为 0），则清除超时计时器
            clearTimeout(capturedSetTimeout);
            resolve(true);
          }

          // 如果某个任务在执行过程中发生错误，直接调用 reject，终止 drain 的等待过程，通知错误
        }, reject);
      });
    });
  }

  return {
    $: buffer,
    add,
    drain,
  };
}
