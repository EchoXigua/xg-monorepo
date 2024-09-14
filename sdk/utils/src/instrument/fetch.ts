/* eslint-disable @typescript-eslint/no-explicit-any */
import type { HandlerDataFetch } from '@xigua-monitor/types';

import { isError } from '../is';
import { addNonEnumerableProperty, fill } from '../object';
import { supportsNativeFetch } from '../supports';
import { timestampInSeconds } from '../time';
import { GLOBAL_OBJ } from '../worldwide';
import { addHandler, maybeInstrument, triggerHandlers } from './handlers';

type FetchResource = string | { toString(): string } | { url: string };

/**
 * 这个函数为 fetch 请求添加监控处理器。
 * 当发起请求时，该处理器会被调用一次，当请求结束时（有 endTimestamp 时）也会被调用
 *
 * @param handler 回调函数，将在 fetch 请求的开始和结束时被调用，用于处理相关数据
 * @param skipNativeFetchCheck 是否跳过对原生 fetch 的检查
 *
 * @hidden
 */
export function addFetchInstrumentationHandler(
  handler: (data: HandlerDataFetch) => void,
  skipNativeFetchCheck?: boolean,
): void {
  const type = 'fetch';
  // 将fetch处理器注册到系统中
  addHandler(type, handler);
  // 确保传入的函数已经被调用过
  maybeInstrument(type, () => instrumentFetch(undefined, skipNativeFetchCheck));
}

/**
 * 函数的目的是为那些长期的 fetch 请求（例如通过 fetch 进行的服务器发送事件（SSE））添加一个处理程序。
 * 该处理程序会解析请求的响应体，并在请求结束时发出 endTimestamp，以便能够更新请求的时间跨度（span）
 *
 * @hidden
 */
export function addFetchEndInstrumentationHandler(
  handler: (data: HandlerDataFetch) => void,
): void {
  // 在 fetch 请求结束时触发
  const type = 'fetch-body-resolved';
  addHandler(type, handler);
  maybeInstrument(type, () => instrumentFetch(streamHandler));
}

/**
 * 这个函数的主要作用是对浏览器的 fetch 方法进行监控（instrumentation），
 * 以便捕获关于网络请求的相关信息，如请求的开始和结束时间、请求的 URL、方法以及响应或错误等
 *
 * @param onFetchResolved
 * @param skipNativeFetchCheck
 * @returns
 */
function instrumentFetch(
  onFetchResolved?: (response: Response) => void,
  skipNativeFetchCheck: boolean = false,
): void {
  // 如果跳过fetch 检查且 不支持原生fetch 直接返回
  if (skipNativeFetchCheck && !supportsNativeFetch()) {
    return;
  }

  // 通过 fill 方法可以将原生 fetch 替换为监控版本，在调用 fetch 时执行额外的逻辑
  fill(GLOBAL_OBJ, 'fetch', function (originalFetch: () => void): () => void {
    // 当fetch 被调用的时候 会触发这个函数
    return function (...args: any[]): void {
      // 解析参数以获取请求的方法（method）和 URL（url）
      const { method, url } = parseFetchArgs(args);

      // 构建处理数据，包含参数，请求数据，以及请求开始时间戳
      const handlerData: HandlerDataFetch = {
        args,
        fetchData: {
          method,
          url,
        },
        startTimestamp: timestampInSeconds() * 1000,
      };

      // 没有提供 onFetchResolved 回调，则立即触发fetch的处理器
      if (!onFetchResolved) {
        triggerHandlers('fetch', {
          ...handlerData,
        });
      }

      /**
       * 捕获位置: 代码在请求发生时立即捕获堆栈跟踪，而不是在 Promise 的错误回调中捕获。
       * 这是因为某些浏览器（如 Safari）在错误发生时会清除堆栈跟踪，只留下当前文件的信息，这对于调试毫无意义。
       *
       * 说明: 如果用户使用的是 Sentry SDK，那么他们可能会看到此堆栈帧，这表示由 fetch 调用引发的错误没有堆栈跟踪信息，
       * SDK 会“回填”堆栈跟踪，以便用户能够看到导致错误的 fetch 调用。
       */
      // 创建一个错误对象以捕获当前的堆栈跟踪。这是为了后续出错时能提供更有用的调试信息
      const virtualStackTrace = new Error().stack;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      // 调用原生的 fetch方法，传入原始参数
      return originalFetch.apply(GLOBAL_OBJ, args).then(
        // 请求成功的回调
        async (response: Response) => {
          // 提供了 onFetchResolved 则调用它
          if (onFetchResolved) {
            onFetchResolved(response);
          } else {
            // 否则触发 fetch,此时请求已完成
            triggerHandlers('fetch', {
              ...handlerData,
              endTimestamp: timestampInSeconds() * 1000,
              response,
            });
          }

          return response;
        },
        // 请求失败的回调
        (error: Error) => {
          // 请求出错，则触发请求结束的处理器，并记录错误信息
          triggerHandlers('fetch', {
            ...handlerData,
            endTimestamp: timestampInSeconds() * 1000,
            error,
          });

          // 检查错误的堆栈，如果没有堆栈信息，则使用之前捕获的 virtualStackTrace 来填充错误堆栈。
          if (isError(error) && error.stack === undefined) {
            /**
             * 这是对 Sentry 用户的特别提醒。如果开发者在使用 Sentry 进行错误监控时，看到特定的堆栈帧信息
             * 这里指出，由于某个 fetch 调用导致的错误没有包含堆栈跟踪信息。
             *  Sentry SDK 进行了“回填”操作，即在错误对象中填充了一个虚拟的堆栈跟踪信息。
             * 这样做的目的是为了使开发者能够看到导致错误的具体 fetch 调用，从而更容易进行调试
             */
            error.stack = virtualStackTrace;

            // 向错误对象添加一个名为 framesToPop 的非可枚举属性，值为 1。
            // 这通常用于指示 Sentry SDK 在处理堆栈跟踪时需要跳过的帧数。
            addNonEnumerableProperty(error, 'framesToPop', 1);
          }

          /**
           * 注意:再次强调，如果用户使用的是 Sentry SDK 并看到此堆栈帧，
           * 这意味着 SDK 捕获了应用代码中的错误。这种情况是预期的，并不是 Sentry SDK 的错误。
           *
           * 抛出错误: 最后，使用 throw error 抛出错误，以便在调用 fetch 的地方能够处理它。
           * 通过抛出错误，应用程序能够继续执行错误处理逻辑，如展示错误消息或重试请求等。
           */
          throw error;
        },
      );
    };
  });
}

/**
 * 这个函数用于处理 fetch Response 对象，特别是当该响应包含可读流时。
 * 它通过逐块读取响应的内容，并在完成时调用提供的回调函数。
 *
 * @param res 要处理的响应对象，如果未定义则不进行处理
 * @param onFinishedResolving 处理完成后要调用的回调函数
 * @returns
 */
async function resolveResponse(
  res: Response | undefined,
  onFinishedResolving: () => void,
): Promise<void> {
  if (res && res.body && res.body.getReader) {
    // res 存在且具有可读流 body 且有 getReader 方法

    // 获取响应流的读取器
    const responseReader = res.body.getReader();

    // eslint-disable-next-line no-inner-declarations
    /**
     * 这个函数用于递归读取流中的数据块
     * @param param0
     * @returns
     */
    async function consumeChunks({ done }: { done: boolean }): Promise<void> {
      if (!done) {
        try {
          // 同时处理 responseReader.read() 和一个 5 秒超时的 Promise。
          // 如果在 5 秒内未读取到数据，则认为读取已完成
          const result = await Promise.race([
            responseReader.read(),
            new Promise<{ done: boolean }>((res) => {
              setTimeout(() => {
                res({ done: true });
              }, 5000);
            }),
          ]);

          // 如果读取未完成（done 为 false），则递归调用，继续读取下一个数据块
          await consumeChunks(result);
        } catch (error) {
          // handle error if needed
        }
      } else {
        // 如果读取完成，返回一个已解析的 Promise
        return Promise.resolve();
      }
    }

    return (
      responseReader
        // 开始读取流数据
        .read()
        // 当读取到数据后，调用 consumeChunks 处理数据
        .then(consumeChunks)
        // 一旦完成，调用传入的回调函数
        .then(onFinishedResolving)
        // 捕获任何可能的错误，并返回 undefined
        .catch(() => undefined)
    );
  }
}

/**
 * 用于处理来自 fetch 请求的响应,会克隆响应，以便可以安全地进行流式读取
 * @param response
 * @returns
 */
async function streamHandler(response: Response): Promise<void> {
  // 尝试克隆响应对象。如果克隆失败（例如，响应已经被消耗），则直接返回
  let clonedResponseForResolving: Response;
  try {
    clonedResponseForResolving = response.clone();
  } catch {
    return;
  }

  //  处理克隆的响应，并在处理完成后触发 fetch-body-resolved 事件，将结束时间戳和原始响应作为数据传递。
  await resolveResponse(clonedResponseForResolving, () => {
    triggerHandlers('fetch-body-resolved', {
      endTimestamp: timestampInSeconds() * 1000,
      response,
    });
  });
}

/**
 * 用于检查给定对象 obj 是否具有指定的属性
 * @param obj
 * @param prop
 * @returns
 */
function hasProp<T extends string>(
  obj: unknown,
  prop: T,
): obj is Record<string, string> {
  return (
    !!obj && typeof obj === 'object' && !!(obj as Record<string, string>)[prop]
  );
}

/**
 * 用于从给定的资源（FetchResource 类型）中提取 URL。
 * @param resource
 * @returns
 */
function getUrlFromResource(resource: FetchResource): string {
  // string 直接返回
  if (typeof resource === 'string') {
    return resource;
  }

  // 不存在返回空
  if (!resource) {
    return '';
  }

  // 检查是否有url 的属性
  if (hasProp(resource, 'url')) {
    return resource.url;
  }

  // 调用toString
  if (resource.toString) {
    return resource.toString();
  }

  // 都不满足，返回空字符串
  return '';
}

/**
 * 用于解析 fetch 请求的参数，以确定使用的 HTTP 方法和请求的 URL
 * 仅为测试导出
 */
export function parseFetchArgs(fetchArgs: unknown[]): {
  method: string;
  url: string;
} {
  // 这种情况可能发生在调用 fetch() 时没有任何参数传入
  if (fetchArgs.length === 0) {
    return { method: 'GET', url: '' };
  }

  // 用户提供了 URL 和选项对象（例如：fetch(url, options)）
  if (fetchArgs.length === 2) {
    const [url, options] = fetchArgs as [FetchResource, object];

    return {
      url: getUrlFromResource(url),
      // 是否存在 method 属性,存在则将其转换为大写字符串,否则默认 GET
      method: hasProp(options, 'method')
        ? String(options.method).toUpperCase()
        : 'GET',
    };
  }

  // fetch 也允许传入一个对象作为参数
  /**
   * fetch({
      method: 'POST',
      body: JSON.stringify({ key: 'value' }),
      headers: { 'Content-Type': 'application/json' }
    });
   */
  const arg = fetchArgs[0];
  return {
    url: getUrlFromResource(arg as FetchResource),
    method: hasProp(arg, 'method') ? String(arg.method).toUpperCase() : 'GET',
  };
}
