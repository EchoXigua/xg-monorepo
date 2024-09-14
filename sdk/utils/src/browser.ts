import { isString } from './is';
import { GLOBAL_OBJ } from './worldwide';

const WINDOW = GLOBAL_OBJ as unknown as Window;

const DEFAULT_MAX_STRING_LENGTH = 80;

type SimpleNode = {
  parentNode: SimpleNode;
} | null;

/**
 * 主要目的是将一个 DOM 元素及其祖先元素表示为一个简洁的、类似 CSS 选择器的字符串路径。
 * 这在调试、错误报告和日志记录中非常有用，特别是当你想要描述用户界面中的特定元素时。
 *
 * e.g. [HTMLElement] => body > div > input#foo.btn[name=baz]
 * @returns generated DOM path
 */
export function htmlTreeAsString(
  elem: unknown,
  options: string[] | { keyAttrs?: string[]; maxStringLength?: number } = {},
): string {
  // 元素不存在返回<unknown>
  if (!elem) {
    return '<unknown>';
  }

  /**
   * 这段代码被放在一个 try 块中，目的是捕获任何在操作 DOM 时可能出现的错误。
   * 因为操作 DOM 可能会涉及到未定义的属性或跨域的内容，可能会抛出异常
   * catch 块用于在发生错误时返回一个 <unknown> 字符串，表示无法生成路径。
   */

  // 从目标元素开始，逐级向上遍历 DOM 树，最多遍历 5 层（由 MAX_TRAVERSE_HEIGHT 限制）。
  try {
    let currentElem = elem as SimpleNode;
    /**
     * 定义了在生成路径时向上遍历 DOM 节点树的最大层数
     * 这个限制是为了防止生成的路径太长，影响可读性或导致性能问题
     */
    const MAX_TRAVERSE_HEIGHT = 5;

    // 用来存储每一层节点生成的字符串表示形式
    const out: string[] = [];
    // 记录当前遍历的层级数
    let height = 0;
    // 记录当前生成的路径字符串的长度
    let len = 0;
    // 用于分隔各个节点字符串表示的分隔符,例如生成的路径会是 body > div > p 这样的形式
    const separator = ' > ';
    // 分隔符的长度。因为在计算路径长度时，需要将分隔符的长度也考虑在内
    const sepLength = separator.length;
    /** 存储当前节点的字符串表示形式 */
    let nextStr;

    // 灵活地处理传入的参数
    const keyAttrs = Array.isArray(options) ? options : options.keyAttrs;

    // 计算最大字符串长度的限制
    const maxStringLength =
      (!Array.isArray(options) && options.maxStringLength) ||
      DEFAULT_MAX_STRING_LENGTH;

    // 开始遍历 DOM 节点树
    while (currentElem && height++ < MAX_TRAVERSE_HEIGHT) {
      // 将当前节点转换为字符串形式
      nextStr = _htmlElementAsString(currentElem, keyAttrs);
      if (
        // 如果 nextStr 是 html，说明已经到达了根节点，可以终止
        nextStr === 'html' ||
        (height > 1 &&
          // 当前生成的路径长度（包括新添加的节点字符串）超过了最大限制也会终止
          len + out.length * sepLength + nextStr.length >= maxStringLength)
      ) {
        break;
      }

      // 将生成的节点字符串添加到 out 数组中
      out.push(nextStr);

      // 更新路径字符串的总长度
      len += nextStr.length;
      // 将当前节点更新为其父节点，继续向上遍历
      currentElem = currentElem.parentNode;
    }

    // 遍历结束后，反转 out 数组中的顺序（因为遍历是从叶子节点到根节点）
    // 然后用分隔符 separator 将它们连接成完整的路径字符串。
    return out.reverse().join(separator);
  } catch (_oO) {
    return '<unknown>';
  }
}

/**
 * 这段代码的功能是将一个 DOM 元素转化为其对应的简化的 query-selector 表示形式。
 * 它生成的字符串可以用来唯一地标识一个 DOM 元素，从而在代码中用于查找该元素。
 * e.g. [HTMLElement] => input#foo.btn[name=baz]
 * @returns generated DOM path
 */
function _htmlElementAsString(el: unknown, keyAttrs?: string[]): string {
  const elem = el as {
    tagName?: string;
    id?: string;
    className?: string;
    getAttribute(key: string): string;
  };

  // 用于存储生成的字符串片段
  const out: string[] = [];

  // 输入元素无效或没有 tagName 返回空 表示无法生成有效的字符串表示形式
  if (!elem || !elem.tagName) {
    return '';
  }

  // @ts-expect-error WINDOW has HTMLElement
  // 检查 WINDOW 是否包含 HTMLElement 构造函数，确保环境支持 DOM 操作。
  if (WINDOW.HTMLElement) {
    // 对于某些 DOM 元素，可能会存在 data-sentryComponent 或 data-sentryElement 属性。
    // 代码会优先使用这些属性来生成字符串表示形式。如果这些属性存在且有值，函数直接返回对应的值。
    if (elem instanceof HTMLElement && elem.dataset) {
      if (elem.dataset['sentryComponent']) {
        return elem.dataset['sentryComponent'];
      }
      if (elem.dataset['sentryElement']) {
        return elem.dataset['sentryElement'];
      }
    }
  }

  // 将元素的 tagName（如 DIV 或 INPUT）转换为小写
  out.push(elem.tagName.toLowerCase());

  // Pairs of attribute keys defined in `serializeAttribute` and their values on element.
  const keyAttrPairs =
    keyAttrs && keyAttrs.length
      ? keyAttrs
          // 过滤空属性
          .filter((keyAttr) => elem.getAttribute(keyAttr))
          // 生成一个由键值对（属性名和属性值）组成的数组
          .map((keyAttr) => [keyAttr, elem.getAttribute(keyAttr)])
      : null;

  // 如果找到关键属性及其值，代码会将其转换为字符串片段
  // 如 [name="baz"],并添加到 out 数组
  if (keyAttrPairs && keyAttrPairs.length) {
    keyAttrPairs.forEach((keyAttrPair) => {
      out.push(`[${keyAttrPair[0]}="${keyAttrPair[1]}"]`);
    });
  } else {
    // 处理 id 和 className
    if (elem.id) {
      out.push(`#${elem.id}`);
    }

    const className = elem.className;
    if (className && isString(className)) {
      const classes = className.split(/\s+/);
      for (const c of classes) {
        out.push(`.${c}`);
      }
    }
  }

  // 允许的属性列表
  const allowedAttrs = ['aria-label', 'type', 'name', 'title', 'alt'];
  for (const k of allowedAttrs) {
    const attr = elem.getAttribute(k);
    if (attr) {
      out.push(`[${k}="${attr}"]`);
    }
  }

  // 将数组转换为字符串
  return out.join('');
}

/**
 * Given a DOM element, traverses up the tree until it finds the first ancestor node
 * that has the `data-sentry-component` or `data-sentry-element` attribute with `data-sentry-component` taking
 * precendence. This attribute is added at build-time by projects that have the component name annotation plugin installed.
 *
 * @returns a string representation of the component for the provided DOM element, or `null` if not found
 */
export function getComponentName(elem: unknown): string | null {
  // @ts-expect-error WINDOW has HTMLElement
  if (!WINDOW.HTMLElement) {
    return null;
  }

  let currentElem = elem as SimpleNode;
  const MAX_TRAVERSE_HEIGHT = 5;
  for (let i = 0; i < MAX_TRAVERSE_HEIGHT; i++) {
    if (!currentElem) {
      return null;
    }

    if (currentElem instanceof HTMLElement) {
      if (currentElem.dataset['sentryComponent']) {
        return currentElem.dataset['sentryComponent'];
      }
      if (currentElem.dataset['sentryElement']) {
        return currentElem.dataset['sentryElement'];
      }
    }

    currentElem = currentElem.parentNode;
  }

  return null;
}

/**
 * A safe form of location.href
 */
export function getLocationHref(): string {
  try {
    return WINDOW.document.location.href;
  } catch (oO) {
    return '';
  }
}

/**
 * Gets a DOM element by using document.querySelector.
 *
 * This wrapper will first check for the existance of the function before
 * actually calling it so that we don't have to take care of this check,
 * every time we want to access the DOM.
 *
 * Reason: DOM/querySelector is not available in all environments.
 *
 * We have to cast to any because utils can be consumed by a variety of environments,
 * and we don't want to break TS users. If you know what element will be selected by
 * `document.querySelector`, specify it as part of the generic call. For example,
 * `const element = getDomElement<Element>('selector');`
 *
 * @param selector the selector string passed on to document.querySelector
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getDomElement<E = any>(selector: string): E | null {
  if (WINDOW.document && WINDOW.document.querySelector) {
    return WINDOW.document.querySelector(selector) as unknown as E;
  }
  return null;
}
