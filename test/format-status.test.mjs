import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusText } from '../web/src/domain/format.js';

const state = (over = {}) => ({
  phase: 'PLAYING',
  video: { paused: false, ct: 300, dur: 600, rate: 1 },
  summary: { section: { pct: 50, watched: 300, total: 600 } },
  ...over,
});

test('正在播：显示「播放中」', () => {
  assert.equal(statusText(state()), '播放中');
});

test('播到 100% 但状态还挂在 PLAYING：说「本节播完，正在切下一节」，不再冒充「缓冲中」', () => {
  const s = state({ video: { paused: true, ct: 600, dur: 600 }, summary: { section: { pct: 100 } } });
  assert.equal(statusText(s), '本节播完，正在切下一节');
  assert.equal(
    statusText(state({ video: { paused: true, ct: 600, dur: 600 }, summary: { section: { pct: 99 } } })),
    '本节播完，正在切下一节'
  );
});

test('中途被暂停：仍然显示「缓冲中」', () => {
  assert.equal(statusText(state({ video: { paused: true, ct: 120, dur: 600 } })), '缓冲中');
});

test('没有 summary 时退回「缓冲中」，不抛错', () => {
  assert.equal(statusText(state({ summary: undefined, video: { paused: true, ct: 120, dur: 600 } })), '缓冲中');
});

test('其它相位沿用原来的文案', () => {
  assert.equal(statusText(state({ phase: 'ENDED' })), '本节播完');
  assert.equal(statusText(state({ phase: 'PAUSED' })), '已暂停');
  assert.equal(statusText(state({ phase: 'WAIT_VERIFY' })), '等待人机验证');
  assert.equal(statusText(null), '—');
});
