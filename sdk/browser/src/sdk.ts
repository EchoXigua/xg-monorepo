import {
  getCurrentScope,
  functionToStringIntegration,
  inboundFiltersIntegration,
  captureSession,
  getClient,
  getIntegrationsToSetup,
  getReportDialogEndpoint,
  initAndBind,
  lastEventId,
  startSession,
} from '@xigua-monitor/core';
import type {
  Client,
  DsnLike,
  Integration,
  Options,
  UserFeedback,
} from '@xigua-monitor/types';
import {
  consoleSandbox,
  logger,
  stackParserFromStackParserOptions,
  supportsFetch,
} from '@xigua-monitor/utils';

import { addHistoryInstrumentationHandler } from '@sentry-internal/browser-utils';
import { dedupeIntegration } from '@xigua-monitor/core';
import type { BrowserClientOptions, BrowserOptions } from './client';
import { BrowserClient } from './client';
import { DEBUG_BUILD } from './debug-build';
import { WINDOW } from './helpers';
import { breadcrumbsIntegration } from './integrations/breadcrumbs';
import { browserApiErrorsIntegration } from './integrations/browserapierrors';
import { globalHandlersIntegration } from './integrations/globalhandlers';
import { httpContextIntegration } from './integrations/httpcontext';
import { linkedErrorsIntegration } from './integrations/linkederrors';
import { defaultStackParser } from './stack-parsers';
import { makeFetchTransport } from './transports/fetch';

/** 获取浏览器SDK的默认集成 */
export function getDefaultIntegrations(_options: Options): Integration[] {
  /**
   * Note: Please make sure this stays in sync with Angular SDK, which re-exports
   * `getDefaultIntegrations` but with an adjusted set of integrations.
   */
  return [
    inboundFiltersIntegration(),
    functionToStringIntegration(),
    browserApiErrorsIntegration(),
    breadcrumbsIntegration(),
    globalHandlersIntegration(),
    linkedErrorsIntegration(),
    dedupeIntegration(),
    httpContextIntegration(),
  ];
}

/**
 * 这个函数的作用是合并用户传入的配置选项与 Sentry 的默认配置选项
 *
 * @param optionsArg
 * @returns
 */
function applyDefaultOptions(optionsArg: BrowserOptions = {}): BrowserOptions {
  // 默认配置
  const defaultOptions: BrowserOptions = {
    // 获取默认的集成。集成可以是一些用于增强 SDK 功能的插件
    defaultIntegrations: getDefaultIntegrations(optionsArg),
    // 版本信息
    release:
      // 这允许构建工具查找并替换__SENTRY_RELEASE__以注入释放值
      typeof __SENTRY_RELEASE__ === 'string'
        ? __SENTRY_RELEASE__
        : // 支持sentry-webpack-plugin注入的变量
          WINDOW.SENTRY_RELEASE && WINDOW.SENTRY_RELEASE.id // This supports the variable that sentry-webpack-plugin injects
          ? WINDOW.SENTRY_RELEASE.id
          : undefined,
    // 表示自动开始会话跟踪
    autoSessionTracking: true,
    // 表示是否发送客户端报告
    sendClientReports: true,
  };

  /**
   * 检查传入的 optionsArg 是否包含 defaultIntegrations。
   * 如果它的值为 null 或 undefined，则从 optionsArg 中删除该属性。
   * 这种处理方式的目的是确保在合并配置时，只有用户显式设置的选项会被保留，而默认选项会被使用
   *
   * 源码注释中提到，应该对整个 optionsArg 调用 dropUndefinedKeys 函数，而不是仅仅处理 defaultIntegrations。
   * 这将使得所有值为 undefined 的属性都被删除，而不仅仅是 defaultIntegrations。
   * 为了使这个改进生效，需要先调整 hasTracingEnabled() 函数的逻辑。
   * 这个函数可能会在某些地方检查一个选项是否存在，并且区分 undefined 值和缺少该属性的对象。
   * 这意味着 hasTracingEnabled() 可能依赖于 optionsArg 中的某些值，因此在处理选项时，必须保持这种逻辑的一致性。
   */
  if (optionsArg.defaultIntegrations == null) {
    delete optionsArg.defaultIntegrations;
  }

  // 返回合并后的配置对象,者的属性会覆盖前者的相同属性
  return { ...defaultOptions, ...optionsArg };
}

type ExtensionProperties = {
  chrome?: Runtime;
  browser?: Runtime;
  nw?: unknown;
};
type Runtime = {
  runtime?: {
    id?: string;
  };
};

/**
 * 这个函数用于判断当前环境是否为浏览器扩展程序，并决定是否显示错误提示
 *
 * @returns
 */
function shouldShowBrowserExtensionError(): boolean {
  const windowWithMaybeExtension =
    // 检查全局 WINDOW 对象是否具有 window 属性，以确定是否处于浏览器窗口环境中
    typeof WINDOW.window !== 'undefined' &&
    (WINDOW as typeof WINDOW & ExtensionProperties);
  if (!windowWithMaybeExtension) {
    // 如果不在浏览器窗口环境中（例如，service workers），则直接返回 false，表示不需要显示错误。
    return false;
  }

  // 根据 WINDOW 对象是否存在 chrome 属性来判断使用哪个键（chrome 或 browser）来获取扩展对象。
  const extensionKey = windowWithMaybeExtension.chrome ? 'chrome' : 'browser';
  // 获取扩展对象
  const extensionObject = windowWithMaybeExtension[extensionKey];

  // 获取扩展对象的 runtime.id，用于后续判断
  const runtimeId =
    extensionObject && extensionObject.runtime && extensionObject.runtime.id;
  // 获取当前页面的 URL（href），以便进行协议检查
  const href = (WINDOW.location && WINDOW.location.href) || '';

  // 定义了一个包含各种浏览器扩展协议的数组。这些协议标识了不同浏览器中扩展的 URL 格式
  const extensionProtocols = [
    'chrome-extension:',
    'moz-extension:',
    'ms-browser-extension:',
    'safari-web-extension:',
  ];

  // 确定当前页面是否为专用扩展页面
  const isDedicatedExtensionPage =
    // 检查是否存在 runtimeId，意味着当前环境是扩展
    !!runtimeId &&
    // 确保当前窗口是顶级窗口，而不是嵌套在其他窗口中
    WINDOW === WINDOW.top &&
    // 检查当前 URL 是否以任何扩展协议开头，表明这是一个有效的扩展页面。
    extensionProtocols.some((protocol) => href.startsWith(`${protocol}//`));

  // see: https://github.com/getsentry/sentry-javascript/issues/12668
  // 检查当前环境是否为 NW.js（一个运行 Node.js 应用程序的桌面环境，它模仿浏览器扩展的行为）。
  const isNWjs = typeof windowWithMaybeExtension.nw !== 'undefined';

  //  确保存在 runtimeId 且确保当前不是专用扩展页面 且 确保当前不是 NW.js 环境
  return !!runtimeId && !isDedicatedExtensionPage && !isNWjs;
}

/**
 * 这个魔术字符串用于构建工具，允许在 SDK 中注入一个 release 值
 * 它通常会在构建时由构建工具（如 Webpack 或 Rollup）自动注入
 * 如果定义了 __SENTRY_RELEASE__，它会在 SDK 中被用于标识当前版本的应用
 */
declare const __SENTRY_RELEASE__: string | undefined;

/**
 * 浏览器 sdk
 *
 * 要使用此SDK，请在加载网页时尽早调用{@link init}函数。
 * 要设置上下文信息或发送手动事件，请使用提供的方法。
 *
 * @example
 *
 * ```
 *
 * import { init } from '@sentry/browser';
 *
 * init({
 *   dsn: '__DSN__',
 *   // ...
 * });
 * ```
 *
 * @example
 * ```
 *
 * import { addBreadcrumb } from '@sentry/browser';
 * addBreadcrumb({
 *   message: 'My Breadcrumb',
 *   // ...
 * });
 * ```
 *
 * @example
 *
 * ```
 *
 * import * as Sentry from '@sentry/browser';
 * Sentry.captureMessage('Hello, world!');
 * Sentry.captureException(new Error('Good bye'));
 * Sentry.captureEvent({
 *   message: 'Manual',
 *   stacktrace: [
 *     // ...
 *   ],
 * });
 * ```
 *
 * @see {@link BrowserOptions} for documentation on configuration options.
 */
export function init(browserOptions: BrowserOptions = {}): Client | undefined {
  // 将用户提供的选项与默认选项合并。这样可以确保 SDK 在缺省情况下也有合理的配置
  const options = applyDefaultOptions(browserOptions);

  // 检查是否在浏览器扩展中使用 Sentry，如果是，则输出错误信息并返回
  if (shouldShowBrowserExtensionError()) {
    // Sentry 不支持在某些浏览器扩展环境中运行，因此需要给出明确的错误提示
    consoleSandbox(() => {
      // eslint-disable-next-line no-console
      console.error(
        '[Sentry] You cannot run Sentry this way in a browser extension, check: https://docs.sentry.io/platforms/javascript/best-practices/browser-extensions/',
      );
    });
    return;
  }

  if (DEBUG_BUILD) {
    // 如果是调试构建（DEBUG_BUILD 为真），检查当前环境是否支持 Fetch API
    if (!supportsFetch()) {
      // 如果不支持，输出警告信息，提醒用户需要添加 Fetch API 的 polyfill
      logger.warn(
        'No Fetch API detected. The Sentry SDK requires a Fetch API compatible environment to send events. Please add a Fetch API polyfill.',
      );
    }
  }

  // 包含 Sentry 客户端的所有配置
  const clientOptions: BrowserClientOptions = {
    ...options,
    // 用于解析堆栈跟踪信息
    stackParser: stackParserFromStackParserOptions(
      options.stackParser || defaultStackParser,
    ),
    // 用于获取并设置要初始化的集成
    integrations: getIntegrationsToSetup(options),

    // 决定了数据发送的方式，默认使用 makeFetchTransport
    transport: options.transport || makeFetchTransport,
  };

  // 创建并绑定 Sentry 的浏览器客户端
  const client = initAndBind(BrowserClient, clientOptions);

  // 如果用户在选项中启用了自动会话跟踪，则开始跟踪用户会话
  if (options.autoSessionTracking) {
    startSessionTracking();
  }

  // 返回初始化后的客户端实例
  return client;
}

/**
 * All properties the report dialog supports
 */
export interface ReportDialogOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
  eventId?: string;
  dsn?: DsnLike;
  user?: {
    email?: string;
    name?: string;
  };
  lang?: string;
  title?: string;
  subtitle?: string;
  subtitle2?: string;
  labelName?: string;
  labelEmail?: string;
  labelComments?: string;
  labelClose?: string;
  labelSubmit?: string;
  errorGeneric?: string;
  errorFormEntry?: string;
  successMessage?: string;
  /** Callback after reportDialog showed up */
  onLoad?(this: void): void;
  /** Callback after reportDialog closed */
  onClose?(this: void): void;
}

/**
 * Present the user with a report dialog.
 *
 * @param options Everything is optional, we try to fetch all info need from the global scope.
 */
export function showReportDialog(options: ReportDialogOptions = {}): void {
  // doesn't work without a document (React Native)
  if (!WINDOW.document) {
    DEBUG_BUILD &&
      logger.error('Global document not defined in showReportDialog call');
    return;
  }

  const scope = getCurrentScope();
  const client = scope.getClient();
  const dsn = client && client.getDsn();

  if (!dsn) {
    DEBUG_BUILD && logger.error('DSN not configured for showReportDialog call');
    return;
  }

  if (scope) {
    options.user = {
      ...scope.getUser(),
      ...options.user,
    };
  }

  if (!options.eventId) {
    const eventId = lastEventId();
    if (eventId) {
      options.eventId = eventId;
    }
  }

  const script = WINDOW.document.createElement('script');
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.src = getReportDialogEndpoint(dsn, options);

  if (options.onLoad) {
    script.onload = options.onLoad;
  }

  const { onClose } = options;
  if (onClose) {
    const reportDialogClosedMessageHandler = (event: MessageEvent): void => {
      if (event.data === '__sentry_reportdialog_closed__') {
        try {
          onClose();
        } finally {
          WINDOW.removeEventListener(
            'message',
            reportDialogClosedMessageHandler,
          );
        }
      }
    };
    WINDOW.addEventListener('message', reportDialogClosedMessageHandler);
  }

  const injectionPoint = WINDOW.document.head || WINDOW.document.body;
  if (injectionPoint) {
    injectionPoint.appendChild(script);
  } else {
    DEBUG_BUILD &&
      logger.error(
        'Not injecting report dialog. No injection point found in HTML',
      );
  }
}

/**
 * This function is here to be API compatible with the loader.
 * @hidden
 */
export function forceLoad(): void {
  // Noop
}

/**
 * This function is here to be API compatible with the loader.
 * @hidden
 */
export function onLoad(callback: () => void): void {
  callback();
}

/**
 * 这个函数实现了浏览器环境中自动会话跟踪（Session Tracking）功能，
 * 主要用于在用户首次加载页面时，以及在每次导航变更时，自动创建和捕获新的会话。
 * 这在用户交互分析和监控中非常有用。
 */
function startSessionTracking(): void {
  // 会检查 WINDOW.document 是否存在
  if (typeof WINDOW.document === 'undefined') {
    // 如果不存在，说明当前运行环境不是浏览器（例如，可能是服务器端环境）

    // 如果在非浏览器环境中尝试启用会话跟踪，将会记录一条警告信息（如果启用了调试模式）
    DEBUG_BUILD &&
      logger.warn(
        'Session tracking in non-browser environment with @sentry/browser is not supported.',
      );
    return;
  }

  // 启动一个新的会话，并设置 ignoreDuration: true 选项。
  // 这意味着会话的持续时间不会被记录，因为浏览器会话的持续时间没有太大意义，更多的是用来表示页面视图。
  startSession({ ignoreDuration: true });
  // 将启动的会话捕获到 Sentry 中
  captureSession();

  // 监听浏览器的导航变更事件
  // 当用户从一个页面导航到另一个页面时（即 from 和 to 发生变化）
  // 函数会启动并捕获一个新的会话。这确保了每次导航都会记录为一个新的会话。
  addHistoryInstrumentationHandler(({ from, to }) => {
    // 不要为初始路由创建额外的会话，或者如果位置没有改变
    if (from !== undefined && from !== to) {
      startSession({ ignoreDuration: true });
      captureSession();
    }
  });
}

/**
 * Captures user feedback and sends it to Sentry.
 *
 * @deprecated Use `captureFeedback` instead.
 */
export function captureUserFeedback(feedback: UserFeedback): void {
  const client = getClient<BrowserClient>();
  if (client) {
    // eslint-disable-next-line deprecation/deprecation
    client.captureUserFeedback(feedback);
  }
}
