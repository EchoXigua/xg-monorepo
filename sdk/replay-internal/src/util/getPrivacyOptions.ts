import type { ReplayIntegrationPrivacyOptions } from '../types';

type GetPrivacyOptions = Required<
  Omit<ReplayIntegrationPrivacyOptions, 'maskFn'>
>;

interface GetPrivacyReturn {
  /** 需要遮罩的文本元素的 CSS 选择器字符串 */
  maskTextSelector: string;
  /** 需要解除遮罩的文本元素的选择器字符串 */
  unmaskTextSelector: string;
  /**
   * 需要完全屏蔽的元素选择器字符串
   * 这些元素在录制或回放过程中将完全不可见。通常用于屏蔽可能包含敏感信息或不相关内容的元素
   */
  blockSelector: string;
  /**
   * 解除屏蔽的元素选择器
   * 如果某些元素在一般情况下需要屏蔽，但在特定情况下需要可见，则可以通过此选择器来解除屏蔽
   */
  unblockSelector: string;
  /**
   * 需要忽略的元素选择器字符串
   * 匹配此选择器的元素在录制或回放时将被忽略，不会被监控或录制。
   * 通常用于特定的表单字段（如 input[type="file"]），以避免记录敏感操作
   */
  ignoreSelector: string;

  /**
   * 使用正则表达式定义需要屏蔽的 CSS 类名
   * 匹配此正则表达式的元素将被屏蔽。与 blockSelector 类似，但通过类名来操作元素
   */
  blockClass?: RegExp;
  /**
   * 使用正则表达式定义需要遮罩文本内容的 CSS 类名
   * 任何匹配该正则表达式的元素的文本内容将在录制时被遮罩，以保护隐私
   */
  maskTextClass?: RegExp;
}

/**
 * 将用户提供的选择器数组 (selectors) 和默认选择器数组 (defaultSelectors) 合并成一个逗号分隔的字符串。
 * @param selectors
 * @param defaultSelectors
 * @returns
 */
function getOption(selectors: string[], defaultSelectors: string[]): string {
  return [
    ...selectors,
    // sentry defaults
    ...defaultSelectors,
  ].join(',');
}

/**
 * 函数返回了与隐私相关的配置，用于 rrweb（一个 Web 应用的录制和回放库），以便在录制时遵循隐私规则
 */
export function getPrivacyOptions({
  mask,
  unmask,
  block,
  unblock,
  ignore,
}: GetPrivacyOptions): GetPrivacyReturn {
  // 定义了默认会被屏蔽的元素
  const defaultBlockedElements = ['base[href="/"]'];

  const maskSelector = getOption(mask, ['.sentry-mask', '[data-sentry-mask]']);
  const unmaskSelector = getOption(unmask, []);

  const options: GetPrivacyReturn = {
    // We are making the decision to make text and input selectors the same
    maskTextSelector: maskSelector,
    unmaskTextSelector: unmaskSelector,

    blockSelector: getOption(block, [
      '.sentry-block',
      '[data-sentry-block]',
      ...defaultBlockedElements,
    ]),
    unblockSelector: getOption(unblock, []),
    ignoreSelector: getOption(ignore, [
      '.sentry-ignore',
      '[data-sentry-ignore]',
      'input[type="file"]',
    ]),
  };

  return options;
}
