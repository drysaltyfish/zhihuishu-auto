import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergePoints, nearestPoint, markAnswered, nextQuestionOf, toStateList } from '../server/worker/lib/question-points.mjs';

const p = (id, timeSec, answered = false) => ({ timeSec, questionIds: id, answered });

test('合并：保留平台没回的已答点', () => {
  const prev = [p('a', 100, true), p('b', 200, true)];
  const r = mergePoints(prev, [{ timeSec: 200, questionIds: 'b' }]);
  assert.equal(r.mode, 'merged');
  assert.deepEqual(r.points.map((x) => x.questionIds), ['a', 'b']);
  assert.equal(r.points[0].answered, true);
});

test('合并：空响应不清空已读列表', () => {
  const prev = [p('a', 100)];
  const r = mergePoints(prev, []);
  assert.equal(r.mode, 'kept');
  assert.equal(r.points.length, 1);
});

test('合并：换了视频先清空再合并', () => {
  const prev = [p('a', 100, true)];
  const r = mergePoints(prev, [{ timeSec: 300, questionIds: 'c' }], { newVideo: true });
  assert.deepEqual(r.points.map((x) => x.questionIds), ['c']);
  assert.equal(r.points[0].answered, false);
});

test('合并：真没点且不是换视频时返回 empty（前端显示本节没有题目）', () => {
  const r = mergePoints([], []);
  assert.equal(r.mode, 'empty');
  assert.deepEqual(r.points, []);
});

test('合并：按时间排序，且标记 changed', () => {
  const prev = [p('a', 300), p('b', 100)];
  const r = mergePoints(prev, [{ timeSec: 100, questionIds: 'b' }, { timeSec: 300, questionIds: 'a' }]);
  assert.deepEqual(r.points.map((x) => x.timeSec), [100, 300]);
  assert.equal(r.changed, true);
});

test('选点：优先未答且离当前进度最近的', () => {
  const list = [p('a', 100, true), p('b', 190), p('c', 400)];
  assert.equal(nearestPoint(list, 200).questionIds, 'b');
});

test('选点：全都答过时返回离进度最近的那个（用于显示已答）', () => {
  const list = [p('a', 100, true), p('c', 400, true)];
  assert.equal(nearestPoint(list, 380).questionIds, 'c');
});

test('选点：空列表返回 null', () => {
  assert.equal(nearestPoint([], 10), null);
});

test('标记已答：返回新数组，不改原数组', () => {
  const list = [p('a', 100), p('b', 200)];
  const out = markAnswered(list, list[0]);
  assert.equal(out[0].answered, true);
  assert.equal(list[0].answered, false);
  assert.notEqual(out, list);
});

test('标记已答：按 questionIds 兜底匹配（对象引用变了也能标上）', () => {
  const list = [p('a', 100)];
  const out = markAnswered(list, { questionIds: 'a', timeSec: 100 });
  assert.equal(out[0].answered, true);
});

test('下一题 payload：取第一道没答的，eta 不为负', () => {
  const list = [p('a', 100, true), p('b', 120)];
  assert.deepEqual(nextQuestionOf(list, 130), { atSec: 120, etaSec: 0, questionId: 'b' });
  assert.equal(nextQuestionOf([p('a', 100, true)], 10), null);
});

test('state 列表映射 done/next', () => {
  assert.deepEqual(toStateList([p('a', 1, true), p('b', 2)]).map((x) => x.state), ['done', 'next']);
});
