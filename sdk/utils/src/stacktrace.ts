import type {
  Event,
  StackFrame,
  StackLineParser,
  StackParser,
} from '@xigua-monitor/types';

/**
 * 这个常量定义了一个限制，即最多只会处理 50 个堆栈帧。
 * 堆栈帧是函数调用栈中的每一个步骤。当错误发生时，通常会生成一个包含所有调用信息的堆栈跟踪，
 * 但这个堆栈可能非常深。为了防止处理过多堆栈帧而导致性能问题，Sentry 限制了堆栈帧的数量。
 */
const STACKTRACE_FRAME_LIMIT = 50;

/**
 * 当无法解析堆栈跟踪中的某个函数名时，将用 ? 作为占位符
 * 堆栈跟踪中某些帧可能无法映射到具体的函数名（例如由于代码混淆或压缩），此时会使用这个占位符来表示未知的函数。
 */
export const UNKNOWN_FUNCTION = '?';
/**
 * 这是一个用于清理 Webpack 错误的正则表达式
 * Webpack 在某些情况下会将错误包装在类似 (error: some error message) 的字符串中，
 * 这个正则表达式用于提取出 some error message 部分,以便更好地分析和报告错误。
 */
const WEBPACK_ERROR_REGEXP = /\(error: (.*)\)/;

/**
 *  这个正则表达式用于匹配堆栈跟踪中与 Sentry SDK 内部方法相关的帧
 * 例如 captureMessage 和 captureException。这些方法是 Sentry 用来捕获错误和消息的
 *
 * 当 Sentry 在处理堆栈跟踪时，会移除这些内部帧，以避免混淆。
 * 这样做的目的是让开发者只看到与他们自己的应用代码相关的堆栈帧，而不是 Sentry SDK 的实现细节。
 */
const STRIP_FRAME_REGEXP = /captureMessage|captureException/;

/**
 * 这个函数用于创建一个 StackParser，它接受一堆堆栈行解析器
 *
 * StackFrames are returned in the correct order for Sentry Exception
 * frames and with Sentry SDK internal frames removed from the top and bottom
 *
 */
export function createStackParser(...parsers: StackLineParser[]): StackParser {
  // 对 parsers 进行排序（根据每个解析器的优先级），并提取出解析器函数（即数组的第二个元素）
  const sortedParsers = parsers.sort((a, b) => a[0] - b[0]).map((p) => p[1]);

  /**
   * 返回一个 StackParser 函数,用于解析堆栈字符串
   */
  return (
    // 传入的堆栈字符串，通常是一个多行字符串，每一行代表一个堆栈帧
    stack: string,
    // 表示在解析堆栈字符串时需要跳过的行数,默认值为 0，表示从第一行开始解析
    skipFirstLines: number = 0,
    // 表示在解析堆栈字符串后，最终结果中需要从堆栈顶部移除的帧数。默认值为 0
    framesToPop: number = 0,
  ): StackFrame[] => {
    // 用来存储解析后的 StackFrame 对象
    const frames: StackFrame[] = [];

    // 将传入的堆栈字符串按行拆分成数组
    const lines = stack.split('\n');

    // 遍历 lines 数组中的每一行
    for (let i = skipFirstLines; i < lines.length; i++) {
      const line = lines[i] as string;
      // Ignore lines over 1kb as they are unlikely to be stack frames.
      // Many of the regular expressions use backtracking which results in run time that increases exponentially with
      // input size. Huge strings can result in hangs/Denial of Service:
      // https://github.com/getsentry/sentry-javascript/issues/2286
      // 如果当前行的长度超过 1024 个字符，则跳过该行不进行处理。
      // 因为超长的行通常不是有效的堆栈帧，而且使用复杂的正则表达式解析这些行可能会导致性能问题甚至拒绝服务攻击（DoS）。
      if (line.length > 1024) {
        continue;
      }

      // https://github.com/getsentry/sentry-javascript/issues/5459
      // Remove webpack (error: *) wrappers
      // 检查当前行是否匹配 Webpack 的错误包装
      const cleanedLine = WEBPACK_ERROR_REGEXP.test(line)
        ? // 如果匹配，则去掉包装部分，保留其中的有用信息
          line.replace(WEBPACK_ERROR_REGEXP, '$1')
        : line;

      // https://github.com/getsentry/sentry-javascript/issues/7813
      // Skip Error: lines
      // 如果当前行匹配到某种 Error: 形式的错误信息，则跳过该行。
      // 这通常是错误消息的标题部分，而不是实际的堆栈帧。
      if (cleanedLine.match(/\S*Error: /)) {
        continue;
      }

      // 遍历 sortedParsers 数组中的每个解析器，尝试解析当前行
      for (const parser of sortedParsers) {
        const frame = parser(cleanedLine);
        // 如果某个解析器成功解析当前行并返回了一个 StackFrame 对象，
        // 则将该对象添加到 frames 数组中，并停止对该行的进一步处理
        if (frame) {
          frames.push(frame);
          // 跳出当前for 循环
          break;
        }
      }

      // 如果 frames 数组中的帧数达到 STACKTRACE_FRAME_LIMIT + framesToPop，则停止解析
      // 这是为了限制堆栈帧的数量，避免解析过多的帧，影响性能
      if (frames.length >= STACKTRACE_FRAME_LIMIT + framesToPop) {
        break;
      }
    }

    // 将 frames 数组进行切片操作，移除顶部的 framesToPop 个帧
    // stripSentryFramesAndReverse 的作用是移除 Sentry SDK 内部的帧，并将数组顺序反转，
    // 最终返回处理后的 StackFrame[] 数组。
    return stripSentryFramesAndReverse(frames.slice(framesToPop));
  };
}

/**
 * 这个函数的主要功能是从提供的 stackParser 选项中获取一个堆栈解析器（StackParser）的实现。
 * @see Options
 *
 */
export function stackParserFromStackParserOptions(
  stackParser: StackParser | StackLineParser[],
): StackParser {
  if (Array.isArray(stackParser)) {
    // 数组中的各个解析器组合成一个 StackParser 并返回
    return createStackParser(...stackParser);
  }
  // 不是数组直接返回
  return stackParser;
}

/**
 * 函数的目的是处理堆栈跟踪信息，将与 Sentry SDK 内部实现相关的堆栈帧去除，并将堆栈的顺序反转，
 * 以确保最终返回的堆栈帧数组从顶部到底部按顺序排列，其中调用崩溃函数的位置是数组中的最后一个元素。
 * @hidden
 */
export function stripSentryFramesAndReverse(
  stack: ReadonlyArray<StackFrame>,
): StackFrame[] {
  // 如果是空栈 直接返回空数组
  if (!stack.length) {
    return [];
  }

  // 将传入的 stack 复制到 localStack 中。这样做是为了在后续操作中避免直接修改传入的原始数组。
  const localStack = Array.from(stack);

  // 检查堆栈的顶部（即最后一个调用）的函数名称是否包含 sentryWrapped
  if (/sentryWrapped/.test(getLastStackFrame(localStack).function || '')) {
    // 如果是，则认为这是由 Sentry 包装的堆栈帧，并将其从堆栈中移除。
    localStack.pop();
  }

  // 将堆栈数组的顺序反转。这一步的目的是将堆栈从“从顶部到底部”的顺序改为“从底部到顶部”的顺序，
  // 这样就可以直接从堆栈的底部开始删除（移除）不需要的堆栈帧。
  localStack.reverse();

  // 反转之后，检查堆栈的底部是否包含由 Sentry 内部方法（如 captureMessage 或 captureException）调用的堆栈帧。
  if (STRIP_FRAME_REGEXP.test(getLastStackFrame(localStack).function || '')) {
    localStack.pop();

    // 如果是，则将其移除。由于某些情况下，这些内部调用可能会堆栈深度多达两级，
    // 因此在移除第一帧后，还需要再次检查并可能移除第二帧。

    // When using synthetic events, we will have a 2 levels deep stack, as `new Error('Sentry syntheticException')`
    // is produced within the hub itself, making it:
    //
    //   Sentry.captureException()
    //   getCurrentHub().captureException()
    //
    // instead of just the top `Sentry` call itself.
    // This forces us to possibly strip an additional frame in the exact same was as above.
    if (STRIP_FRAME_REGEXP.test(getLastStackFrame(localStack).function || '')) {
      localStack.pop();
    }
  }

  //  使用 slice 来确保返回的堆栈帧数量不超过 STACKTRACE_FRAME_LIMIT（即最多50个帧）
  return localStack.slice(0, STACKTRACE_FRAME_LIMIT).map((frame) => ({
    // 对于每个堆栈帧，确保 filename 和 function 属性有值
    ...frame,
    // 如果某个帧缺少 filename，则使用最后一个堆栈帧的 filename
    filename: frame.filename || getLastStackFrame(localStack).filename,
    // 如果某个帧缺少 function，则使用 UNKNOWN_FUNCTION
    function: frame.function || UNKNOWN_FUNCTION,
  }));
}

function getLastStackFrame(arr: StackFrame[]): StackFrame {
  return arr[arr.length - 1] || {};
}

/**
 * 这个函数用于从一个事件中提取栈帧（stack frames）的函数。
 * 它通过安全地访问事件对象的嵌套属性来避免检查未定义的属性
 * 
 * @example
 * const event = {
  exception: {
    values: [
      {
        stacktrace: {
          frames: [
            { filename: 'app.js', lineno: 10, colno: 5, function: 'myFunction' },
            { filename: 'app.js', lineno: 12, colno: 8, function: 'anotherFunction' }
          ]
        }
      }
    ]
  }
};


---->
[
  { filename: 'app.js', lineno: 10, colno: 5, function: 'myFunction' },
  { filename: 'app.js', lineno: 12, colno: 8, function: 'anotherFunction' }
]
 */
export function getFramesFromEvent(event: Event): StackFrame[] | undefined {
  // 从事件对象中提取异常信息
  const exception = event.exception;

  if (exception) {
    // 用于存储提取的栈帧
    const frames: StackFrame[] = [];
    try {
      // @ts-expect-error Object could be undefined
      // 遍历异常
      exception.values.forEach((value) => {
        // @ts-expect-error Value could be undefined
        if (value.stacktrace.frames) {
          // 如果存在frames ，将栈帧添加到 frames 数组中
          // @ts-expect-error Value could be undefined
          frames.push(...value.stacktrace.frames);
        }
      });
      return frames;
    } catch (_oO) {
      return undefined;
    }
  }
  return undefined;
}

const defaultFunctionName = '<anonymous>';

/**
 * 安全地从自身提取函数名
 */
export function getFunctionName(fn: unknown): string {
  try {
    if (!fn || typeof fn !== 'function') {
      return defaultFunctionName;
    }
    return fn.name || defaultFunctionName;
  } catch (e) {
    // Just accessing custom props in some Selenium environments
    // can cause a "Permission denied" exception (see raven-js#495).
    return defaultFunctionName;
  }
}
