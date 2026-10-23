/**
 * 提示类弹窗（「学前必读」「学习须知」等）的判定与关闭策略。
 *
 * 纯逻辑，不碰 DOM / Playwright，便于单测。页面里的 \`NOTICES\` 脚本只负责
 * 「把可见的候选弹窗读成数据」，点哪个按钮由这里决定。
 *
 * 铁律：只关「认得出的提示弹窗」，弹题与人机验证绝不动。
 */

/** 认得出的提示弹窗关键词（出现在弹窗正文里才算） */
export const NOTICE_KEYWORDS = [
  '学前必读',
  '学习须知',
  '课程须知',
  '课前须知',
  '修读须知',
  '必读',
  '须知',
  '温馨提示',
  '学习提示',
  '注意事项',
];

/** 命中这些字样的一律不碰：弹题 / 人机验证 / 反脚本提示 */
export const BLOCK_HINTS = [
  '提交答案',
  '正确答案',
  '答题卡',
  '安全验证',
  '请完成验证',
  '拖动滑块',
  '按住滑块',
  '验证码',
  '异常脚本',
];

/** 关闭类按钮文案，越靠前越优先 */
export const DISMISS_TEXTS = [
  '我知道了',
  '知道了',
  '我已知晓',
  '已阅读',
  '已读完',
  '关闭',
  '确定',
  '确认',
  '好的',
  '好',
];

/** 「开始学习」类按钮：只有弹窗里没有关闭按钮时才用（学前必读常见这个） */
export const START_TEXTS = ['开始学习', '进入学习', '继续学习', '立即学习'];

export function normalizeText(text) {
  return String(text == null ? '' : text)
    .replace(/\s+/g, ' ')
    .trim();
}

/** 是不是弹题 / 验证 / 反脚本这类绝不能关的弹窗 */
export function isBlocked(text) {
  const t = normalizeText(text);
  return BLOCK_HINTS.some((k) => t.includes(k));
}

/** 正文像不像一条可以关掉的提示 */
export function isNotice(text) {
  const t = normalizeText(text);
  if (!t) return false;
  if (isBlocked(t)) return false;
  return NOTICE_KEYWORDS.some((k) => t.includes(k));
}

function matchButton(buttons, texts) {
  for (const want of texts) {
    for (let i = 0; i < buttons.length; i++) {
      const b = buttons[i] || {};
      if (b.disabled) continue;
      const t = normalizeText(b.text);
      if (!t || t.length > 20) continue;
      if (t === want || t.includes(want)) return { index: i, text: t };
    }
  }
  return null;
}

/**
 * 决定怎么关这个弹窗。
 *
 * @param {{text?: string, buttons?: Array<{text?: string, disabled?: boolean}>, checkbox?: {visible?: boolean, checked?: boolean} | null}} notice
 * @returns {{close: boolean, reason: string, button: {index: number, text: string, kind: 'dismiss'|'start'} | null, checkFirst: boolean}}
 */
export function planNoticeClose(notice) {
  const n = notice || {};
  const text = normalizeText(n.text);
  const buttons = Array.isArray(n.buttons) ? n.buttons : [];
  const box = n.checkbox && n.checkbox.visible ? n.checkbox : null;
  const checkFirst = !!(box && !box.checked);

  if (!text) return { close: false, reason: '没有正文', button: null, checkFirst: false };
  if (isBlocked(text)) return { close: false, reason: '弹题/验证类，不能碰', button: null, checkFirst: false };
  if (!isNotice(text)) return { close: false, reason: '不是认得出的提示弹窗', button: null, checkFirst: false };

  const dismiss = matchButton(buttons, DISMISS_TEXTS);
  if (dismiss)
    return { close: true, reason: '关闭按钮：' + dismiss.text, button: { ...dismiss, kind: 'dismiss' }, checkFirst };

  const start = matchButton(buttons, START_TEXTS);
  if (start)
    return { close: true, reason: '只能点开始学习：' + start.text, button: { ...start, kind: 'start' }, checkFirst };

  if (checkFirst) {
    return { close: false, reason: '要先勾选「已阅读」才有按钮', button: null, checkFirst: true };
  }
  return { close: false, reason: '没有可用的关闭按钮', button: null, checkFirst: false };
}

/** 日志里怎么称呼这个弹窗：优先用正文开头命中的关键词（「学前必读」），否则取第一句，最多 40 字 */
export function noticeLabel(text) {
  const t = normalizeText(text);
  if (!t) return '提示弹窗';
  for (const k of NOTICE_KEYWORDS) {
    const i = t.indexOf(k);
    if (i >= 0 && i < 12) return k.slice(0, 40);
  }
  const first = t.split(/[。！？；\n]/)[0] || t;
  return first.slice(0, 40);
}
