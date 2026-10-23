/**
 * 自动切节失败后的升级策略（纯函数，便于单测）。
 *
 * 背景：课程树点了没反应时 clickLesson 内部会重试 3 次；如果视频始终没变，
 * 以前主循环过十几秒又从头点一轮，日志刷屏、问题也永远解决不了。
 * 策略：连续失败 SWITCH_FAIL_LIMIT 轮就停止硬试，把浏览器窗口叫出来让人手动点一节，
 * 弄好后点「继续」，自动化再从当前节接着跑。
 */

/** 连续失败几轮就转人工（每轮内部已经重试过 3 次真实鼠标点击） */
export const SWITCH_FAIL_LIMIT = 2;

/**
 * 记一次失败，返回新的连续失败轮数和「该不该转人工」。
 * @param {number} fails 之前的连续失败轮数
 * @param {number} [limit] 阈值，默认 SWITCH_FAIL_LIMIT
 * @returns {{fails: number, escalate: boolean}}
 */
export function advanceFailStep(fails, limit = SWITCH_FAIL_LIMIT) {
  const before = Number.isFinite(fails) && fails > 0 ? Math.floor(fails) : 0;
  const n = before + 1;
  const at = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : SWITCH_FAIL_LIMIT;
  return { fails: n, escalate: n >= at };
}

/** 转人工时给用户看的一句话（同时写进日志和界面提示） */
export function manualFixHint(code, reason) {
  const who = code ? '切到 ' + code : '切下一节';
  return (
    '自动' +
    who +
    '没成功（' +
    (reason || '点了没反应') +
    '）。浏览器窗口已经打开，请在里面手动点开要听的节，弄好后点「继续」'
  );
}
