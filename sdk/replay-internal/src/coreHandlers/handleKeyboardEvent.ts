import type { Breadcrumb } from '@xigua-monitor/types';
import { htmlTreeAsString } from '@xigua-monitor/utils';

import type { ReplayContainer } from '../types';
import { createBreadcrumb } from '../util/createBreadcrumb';
import { getBaseDomBreadcrumb } from './handleDom';
import { addBreadcrumbEvent } from './util/addBreadcrumbEvent';

/** 处理键盘事件和创建面包屑 */
export function handleKeyboardEvent(
  replay: ReplayContainer,
  event: KeyboardEvent,
): void {
  // 如果重放系统未启用，直接返回
  if (!replay.isEnabled()) {
    return;
  }

  // 更新用户的活动状态，表明用户有交互行为，但并不会重启录制，以避免生成不必要的低价值录制数据
  replay.updateUserActivity();

  // 生成与键盘事件相关的面包屑
  const breadcrumb = getKeyboardBreadcrumb(event);

  // 如果返回为空（表示该键盘事件不需要记录面包屑）
  if (!breadcrumb) {
    return;
  }

  // 将生成的面包屑添加到回放事件中，记录键盘操作
  addBreadcrumbEvent(replay, breadcrumb);
}

/** exported only for tests */
export function getKeyboardBreadcrumb(event: KeyboardEvent): Breadcrumb | null {
  // 从事件对象中提取常用信息
  const { metaKey, shiftKey, ctrlKey, altKey, key, target } = event;

  // 判断当前目标元素是否为输入字段如 input、textarea 或者可编辑内容元素
  // 避免捕获用户的文本输入行为，避免记录敏感信息（如密码、用户名等）
  if (!target || isInputElement(target as HTMLElement) || !key) {
    return null;
  }

  //注意：这里我们不考虑shift，因为它意味着“大写”
  // 判断按下的键是否为修饰键（如 Meta、Ctrl、Alt），这些键通常与其他键组合使用
  const hasModifierKey = metaKey || ctrlKey || altKey;
  //  判断按键是否为单字符键，例如字母、数字。特殊键如 Escape 或 Tab 的 key.length 通常大于 1
  const isCharacterKey = key.length === 1;

  // 如果用户只按下了一个字符键而没有修饰键（如仅按下字母键）
  // 则不会创建面包屑，以避免捕获用户的输入内容
  if (!hasModifierKey && isCharacterKey) {
    return null;
  }

  // 获取目标元素的 DOM 树信息，作为面包屑的消息部分
  const message =
    htmlTreeAsString(target, { maxStringLength: 200 }) || '<unknown>';

  // 生成基础 DOM 面包屑数据，包含事件发生的 DOM 结构
  const baseBreadcrumb = getBaseDomBreadcrumb(target as Node, message);

  //  创建键盘按下的面包屑，并附加事件的详细信息（如键值、修饰键等）
  return createBreadcrumb({
    category: 'ui.keyDown',
    message,
    data: {
      ...baseBreadcrumb.data,
      metaKey,
      shiftKey,
      ctrlKey,
      altKey,
      key,
    },
  });
}

/** 用于检查目标元素是否为输入元素 */
function isInputElement(target: HTMLElement): boolean {
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    // 可编辑的元素（如富文本编辑器）
    target.isContentEditable
  );
}
