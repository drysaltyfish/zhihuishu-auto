/**
 * 答题策略的纯逻辑：兜底选项池 / 兜底选择 / 判分 / 答题记录。
 * LLM 调用本身在 server/llm.mjs；这里只放「模型不听话时」的确定性规则，方便断言。
 */

/** 「以上都不对」这类明显不是正确答案的兜底项，随机时避开 */
export const DISTRACTOR = /以上都|都不对|全部|无法确定|none of the above|all of the above/i;

/** 兜底池：优先排除 DISTRACTOR；全被排除时退回全部选项 */
export function optionPool(options) {
  const opts = Array.isArray(options) ? options : [];
  const pool = opts.map((o, i) => ({ o, i })).filter((x) => !DISTRACTOR.test(String(x.o.text || '')));
  return pool.length ? pool : opts.map((o, i) => ({ o, i }));
}

/** 随机兜底选一个（rng 可注入，测试才可复现） */
export function chooseFallback(options, rng = Math.random) {
  const pool = optionPool(options);
  if (!pool.length) return { ok: false, idx: 0, why: '没有可选选项' };
  const pick = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
  return { ok: true, idx: pick.i };
}

/** 选项标签里的字母（A-H） */
export function labelOf(option) {
  return String((option && option.label) || '').replace(/[^A-H]/g, '');
}

/** 判分：我选的字母与平台给出的正确答案字母是否一致 */
export function judge(chosenLabel, answerText) {
  const a = String(chosenLabel || '').replace(/[^A-H]/g, '');
  const b = String(answerText || '').replace(/[^A-H]/g, '');
  return !!(a && b && a === b);
}

/** 题面摘要：「【单选题】xxx」→ 保留题型前缀，最长 60 字 */
export function summaryOf(title) {
  return String(title || '').replace(/^.*?【/, '【').slice(0, 60);
}

/** 展示用的选择文本：「B. 选项文字前 24 字」 */
export function chosenText(option) {
  if (!option) return '';
  return ((option.label || '') + ' ' + String(option.text || '').slice(0, 24)).trim();
}

/** 一条答题历史（前端「最近答题」列表） */
export function historyEntry({ point, dialog, chosenIdx, how, right, answerText, at }) {
  const opt = dialog && dialog.options && dialog.options[chosenIdx];
  return {
    qid: point ? point.questionIds : '?',
    summary: summaryOf(dialog && dialog.title),
    chosen: chosenText(opt),
    by: how,
    right: right,
    correct: answerText || '',
    result: right === null ? 'ok' : (right ? 'ok' : 'bad'),
    at,
  };
}
