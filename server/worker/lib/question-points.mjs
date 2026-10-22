/**
 * 弹题点（questionPoint）的纯逻辑：合并 / 选点 / 标记已答 / 生成前端状态。
 * 这里没有页面、没有 Playwright、没有 IPC —— 一行测试就能覆盖「空响应不能清空已答」这类线上坑。
 */

/** 平台返回的弹题点 → 前端 state 的列表（state: next/done） */
export function toStateList(points) {
  return (points || []).map((q) => ({ ...q, state: q.answered ? 'done' : 'next' }));
}

/**
 * 合并一次 loadVideoPointerInfo 的响应。
 * 规则（与旧实现逐行等价）：
 *  - 换了视频（newVideo）就先清空旧视频的点；
 *  - 平台可能只回「还没答」的点，已答过的必须保留（前端要能看见「已答」）；
 *  - 空响应且不是换视频时，不能把已读到的列表清空。
 * @returns {{points:Array, changed:boolean, mode:'merged'|'kept'|'empty'}}
 */
export function mergePoints(prev, incoming, { newVideo = false } = {}) {
  const pts = Array.isArray(incoming) ? incoming : [];
  let points = newVideo ? [] : (prev || []).slice();

  if (pts.length) {
    const prevMap = new Map(points.map((q) => [String(q.questionIds), q]));
    const merged = pts.map((p) => {
      const old = prevMap.get(String(p.questionIds));
      return { timeSec: p.timeSec, questionIds: p.questionIds, answered: !!(old && old.answered) };
    });
    for (const old of points) {
      if (old.answered && !merged.some((m) => String(m.questionIds) === String(old.questionIds))) merged.push({ ...old });
    }
    merged.sort((a, b) => a.timeSec - b.timeSec);
    const changed = merged.length !== points.length
      || merged.some((m, i) => m.timeSec !== (points[i] || {}).timeSec || m.answered !== (points[i] || {}).answered);
    return { points: merged, changed, mode: 'merged' };
  }

  if (points.length) return { points, changed: false, mode: 'kept' };
  return { points: [], changed: false, mode: 'empty' };
}

/** 用当前进度找对应的弹题点：优先本题还没答的，其次离进度最近的那个 */
export function nearestPoint(points, ct) {
  const list = points || [];
  if (!list.length) return null;
  const byDistance = (a, b) => Math.abs(a.timeSec - ct) - Math.abs(b.timeSec - ct);
  const cand = list.filter((q) => !q.answered).sort(byDistance)[0];
  if (!cand) return list.slice().sort(byDistance)[0];
  return cand;
}

/** 标记某个点已答，返回新数组（旧实现是原地改元素，这里显式返回，避免别名 bug） */
export function markAnswered(points, point) {
  const list = points || [];
  if (!point) return list.slice();
  const idx = list.indexOf(point);
  if (idx >= 0) {
    const out = list.slice();
    out[idx] = { ...out[idx], answered: true };
    return out;
  }
  const qid = String(point.questionIds);
  return list.map((p) => (String(p.questionIds) === qid ? { ...p, answered: true } : p));
}

/** 前端「下一题」用的 payload：第一道没答的题 */
export function nextQuestionOf(points, ct) {
  const qd = (points || []).find((x) => !x.answered) || null;
  if (!qd) return null;
  return { atSec: qd.timeSec, etaSec: Math.max(0, qd.timeSec - ct), questionId: qd.questionIds };
}
