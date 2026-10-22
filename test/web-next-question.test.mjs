import test from 'node:test';
import assert from 'node:assert/strict';
import { computeNextQuestion, etaText } from '../web/src/domain/next-question.js';

const point = (timeSec, extra = {}) => ({ timeSec, questionIds: 'q' + timeSec, answered: false, state: 'next', ...extra });
const state = (over = {}) => ({ video: { ct: 0 }, questionPoints: [], pointsLoaded: true, ...over });

test('没有弹题点 → null', () => {
  assert.equal(computeNextQuestion(null), null);
  assert.equal(computeNextQuestion(state()), null);
  assert.equal(computeNextQuestion(state({ questionPoints: undefined })), null);
});

test('已答 / state=done 的弹题点被过滤', () => {
  const s = state({
    video: { ct: 0 },
    questionPoints: [
      point(10, { answered: true }),
      point(20, { state: 'done' }),
      point(30),
    ],
  });
  const n = computeNextQuestion(s);
  assert.equal(n.atSec, 30);
  assert.equal(n.questionId, 'q30');
});

test('取当前位置之后最近的一题（数组乱序也取最小）', () => {
  const s = state({
    video: { ct: 40 },
    questionPoints: [point(100), point(50), point(45), point(10)],
  });
  const n = computeNextQuestion(s);
  assert.equal(n.atSec, 45);
  assert.equal(n.etaSec, 5);
});

test('ct 之后没有题 → null', () => {
  assert.equal(computeNextQuestion(state({ video: { ct: 200 }, questionPoints: [point(10), point(20)] })), null);
});

test('etaSec 不为负（0.5s 容差内算下一题，倒计时为 0）', () => {
  const justPassed = computeNextQuestion(state({ video: { ct: 99.6 }, questionPoints: [point(99.6)] }));
  assert.equal(justPassed.etaSec, 0);

  const atCt = computeNextQuestion(state({ video: { ct: 30 }, questionPoints: [point(30)] }));
  assert.equal(atCt.etaSec, 0);

  const future = computeNextQuestion(state({ video: { ct: 30.2 }, questionPoints: [point(31.2)] }));
  assert.equal(future.etaSec, 1);
  assert.ok(future.etaSec >= 0);
});

test('etaText 三种量级：秒 / 分+秒 / 超过一小时按分钟累计', () => {
  assert.equal(etaText(20), '20 秒');
  assert.equal(etaText(0), '0 秒');
  assert.equal(etaText(829), '13 分 49 秒');
  assert.equal(etaText(3661), '61 分 1 秒');
});

test('etaText 四舍五入与负数兜底', () => {
  assert.equal(etaText(59.6), '1 分 0 秒');
  assert.equal(etaText(-5), '0 秒');
  assert.equal(etaText(-0.4), '0 秒');
});
