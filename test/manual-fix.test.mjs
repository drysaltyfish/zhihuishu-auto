import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceFailStep, manualFixHint, SWITCH_FAIL_LIMIT } from '../server/worker/lib/manual-fix.mjs';

test('默认阈值是 2 轮', () => {
  assert.equal(SWITCH_FAIL_LIMIT, 2);
});

test('第一次失败只计数，不转人工', () => {
  assert.deepEqual(advanceFailStep(0), { fails: 1, escalate: false });
  assert.deepEqual(advanceFailStep(undefined), { fails: 1, escalate: false });
});

test('连续第二次失败就转人工', () => {
  assert.deepEqual(advanceFailStep(1), { fails: 2, escalate: true });
});

test('已经超过阈值继续失败仍然转人工', () => {
  assert.deepEqual(advanceFailStep(5), { fails: 6, escalate: true });
});

test('可以自定义阈值', () => {
  assert.deepEqual(advanceFailStep(0, 1), { fails: 1, escalate: true });
  assert.deepEqual(advanceFailStep(2, 3), { fails: 3, escalate: true });
  assert.deepEqual(advanceFailStep(1, 3), { fails: 2, escalate: false });
});

test('非法输入当成 0 轮、非法阈值回落默认值', () => {
  assert.deepEqual(advanceFailStep(-3), { fails: 1, escalate: false });
  assert.deepEqual(advanceFailStep('x'), { fails: 1, escalate: false });
  assert.deepEqual(advanceFailStep(1, 0), { fails: 2, escalate: true });
  assert.deepEqual(advanceFailStep(1, NaN), { fails: 2, escalate: true });
});

test('提示文案带小节号和原因，并告诉用户点「继续」', () => {
  const t = manualFixHint('4.2', '连续 2 轮点了没反应');
  assert.match(t, /切到 4\.2/);
  assert.match(t, /连续 2 轮点了没反应/);
  assert.match(t, /浏览器窗口已经打开/);
  assert.match(t, /「继续」/);
});

test('没有小节号时用「切下一节」', () => {
  assert.match(manualFixHint('', ''), /切下一节/);
});
