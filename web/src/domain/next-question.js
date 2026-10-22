/**
 * 「下一题」纯算法：不依赖 Vue，也不读全局状态。
 * 由本节 video.ct + questionPoints（未答、且位置在当前位置之后的最小者）推导，
 * 不再等后台 worker 推送的 state.nextQuestion（切视频后会滞后）。
 */
export function computeNextQuestion(state) {
  const s = state;
  if (!s) return null;
  const ct = (s.video && s.video.ct) || 0;
  const list = (s.questionPoints || []).filter((p) => !p.answered && p.state !== 'done');
  const ahead = list.filter((p) => p.timeSec >= ct - 0.5).sort((a, b) => a.timeSec - b.timeSec);
  if (!ahead.length) return null;
  const q = ahead[0];
  return { atSec: q.timeSec, questionId: q.questionIds, etaSec: Math.max(0, q.timeSec - ct) };
}

/**
 * 倒计时文案：不足 1 分钟「20 秒」，否则「13 分 49 秒」。
 * 与原实现一致：小时也按分钟累计（3700 秒 → 「61 分 40 秒」）。
 */
export function etaText(sec) {
  const v = Math.max(0, Math.round(sec));
  const m = Math.floor(v / 60), s = v % 60;
  return m > 0 ? m + ' 分 ' + s + ' 秒' : v + ' 秒';
}
