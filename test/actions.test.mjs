import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveControl, actionPatch, isStoppedPhase, requireRunning } from '../server/lib/actions.mjs';

test('未知动作直接拒绝', () => {
  const r = resolveControl('nope', { phase: 'PLAYING', mock: true, debug: true });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
  assert.equal(r.message, '不支持的操作');
});

test('空闲时点暂停 → 409 友好提示，不是 500', () => {
  const r = resolveControl('pause', { phase: 'IDLE', mock: false, debug: false });
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.equal(r.message, '任务还没开始');
  assert.match(r.hint, /开始听课/);
});

test('播放中可以暂停/继续/退出', () => {
  for (const name of ['pause', 'resume', 'quit']) {
    const r = resolveControl(name, { phase: 'PLAYING', mock: false, debug: false });
    assert.equal(r.ok, true, name);
    assert.equal(typeof r.action, 'object');
  }
});

test('重启不受「必须已经在跑」限制', () => {
  for (const phase of ['IDLE', 'STOPPED', 'PLAYING']) {
    assert.equal(resolveControl('restart', { phase, mock: false, debug: false }).ok, true, phase);
  }
});

test('verify/unverify 只在 mock 下存在', () => {
  assert.equal(resolveControl('verify', { phase: 'PLAYING', mock: false, debug: false }).ok, false);
  assert.equal(resolveControl('verify', { phase: 'PLAYING', mock: true, debug: false }).ok, true);
  assert.equal(resolveControl('unverify', { phase: 'PLAYING', mock: true, debug: false }).ok, true);
});

test('probe/verifyprobe 只在 debug 下存在，且要求正在跑', () => {
  assert.equal(resolveControl('probe', { phase: 'PLAYING', mock: false, debug: false }).ok, false);
  assert.equal(resolveControl('probe', { phase: 'IDLE', mock: false, debug: true }).status, 409);
  assert.equal(resolveControl('probe', { phase: 'PLAYING', mock: false, debug: true }).ok, true);
});

test('isStoppedPhase 只认 IDLE/STOPPED', () => {
  assert.equal(isStoppedPhase('IDLE'), true);
  assert.equal(isStoppedPhase('STOPPED'), true);
  for (const p of ['PLAYING', 'PAUSED', 'ANSWERING', 'WAIT_LOGIN', 'LAUNCHING', 'WAIT_PICK']) {
    assert.equal(isStoppedPhase(p), false, p);
  }
});

test('actionPatch 给出乐观补丁，无关动作没有补丁', () => {
  assert.deepEqual(actionPatch('pause'), { paused: true, phase: 'PAUSED' });
  assert.deepEqual(actionPatch('resume'), { paused: false });
  assert.deepEqual(actionPatch('quit'), { paused: true, phase: 'STOPPED', video: { paused: true } });
  assert.equal(actionPatch('verify'), null);
  assert.equal(actionPatch('nope'), null);
});

test('requireRunning 抛可透出错误，运行中不抛', () => {
  try {
    requireRunning({ phase: 'IDLE' }, '先点「开始听课」');
    assert.fail('应当抛出');
  } catch (e) {
    assert.equal(e.status, 409);
    assert.equal(e.expose, true);
    assert.equal(e.message, '任务还没开始');
    assert.equal(e.hint, '先点「开始听课」');
  }
  assert.doesNotThrow(() => requireRunning({ phase: 'PLAYING' }, 'x'));
});
