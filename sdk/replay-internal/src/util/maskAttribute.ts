import type { getPrivacyOptions } from './getPrivacyOptions';

/**
 * 定义了在处理遮罩（masking）元素的属性时所需要的参数
 */
interface MaskAttributeParams {
  /**
   * 包含需要遮罩的属性名称
   * 比如，开发者可以使用这个字段来指定哪些 HTML 属性（如 src、href 等）需要在录制或重放时被遮罩
   */
  maskAttributes: string[];
  /**
   * 用来指示是否要遮罩所有文本内容
   * 如果为 true，那么所有与文本相关的内容都会被遮罩，确保敏感信息不会被记录
   */
  maskAllText: boolean;
  /**
   *  包含了隐私相关的配置，如遮罩、屏蔽、忽略等选择器规则
   */
  privacyOptions: ReturnType<typeof getPrivacyOptions>;
  /** 正在处理的属性的名称,例如，HTML 元素中的 src 或 alt 等属性名 */
  key: string;
  /** 该属性的值,例如，src 属性的 URL，alt 属性的文本描述等。 */
  value: string;
  /** 当前正在处理的 HTML 元素,这个字段是对 DOM 元素的直接引用，允许对该元素的属性或文本内容进行操作 */
  el: HTMLElement;
}

/**
 * Masks an attribute if necessary, otherwise return attribute value as-is.
 *
 */
export function maskAttribute({
  el, // 当前处理的 HTML 元素
  key, // 处理的属性名称,如 src、href、value
  maskAttributes, // 需要遮罩的属性名的数组，比如 ['src', 'href']
  maskAllText, // 决定是否遮罩所有文本
  privacyOptions, // 隐私相关的配置，包括不同的选择器用于指定哪些元素的文本或属性需要遮罩或不遮罩
  value, // 当前属性的值
}: MaskAttributeParams): string {
  // 只有当 maskAllText 为 true 时，才会继续进行遮罩处理。
  if (!maskAllText) {
    return value;
  }

  // unmaskTextSelector 的选择器优先级较高
  if (
    privacyOptions.unmaskTextSelector &&
    el.matches(privacyOptions.unmaskTextSelector)
  ) {
    // 如果当前元素匹配 privacyOptions.unmaskTextSelector（即标记为不需要遮罩的元素选择器），
    // 则返回原始值 value，表示该元素不需要遮罩
    return value;
  }

  // 如果当前属性 key 存在于 maskAttributes 数组中（即该属性是需要遮罩的属性），则进行遮罩处理
  if (
    maskAttributes.includes(key) ||
    // 如果处理的是 value 属性，并且该元素是 input 元素且类型为 submit 或 button，也会进行遮罩
    (key === 'value' &&
      el.tagName === 'INPUT' &&
      ['submit', 'button'].includes(el.getAttribute('type') || ''))
  ) {
    // 将所有非空白字符 [\S] 替换为星号 *
    return value.replace(/[\S]/g, '*');
  }

  // 如果不满足上述遮罩条件，则返回原始属性值 value
  return value;
}
