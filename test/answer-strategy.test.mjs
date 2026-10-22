import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseFallback,
  optionPool,
  judge,
  labelOf,
  summaryOf,
  chosenText,
  historyEntry,
} from '../server/worker/lib/answer-strategy.mjs';

const opt = (label, text) => ({ label, text });

test('兜底池：排除「以上都不对」这类选项', () => {
  const pool = optionPool([opt('A.', '正常选项'), opt('B.', '以上都不对')]);
  assert.deepEqual(
    pool.map((x) => x.i),
    [0]
  );
});

test('兜底池：全排除时退回全部选项（不能一个都不选）', () => {
  const pool = optionPool([opt('A.', '全部正确'), opt('B.', '以上都不对')]);
  assert.equal(pool.length, 2);
});

test('随机兜底：rng 可注入，选到的下标在池内', () => {
  assert.equal(chooseFallback([opt('A.', '甲'), opt('B.', '乙')], () => 0).idx, 0);
  assert.equal(chooseFallback([opt('A.', '甲'), opt('B.', '乙')], () => 0.99).idx, 1);
  assert.equal(chooseFallback([], () => 0.5).ok, false);
});

test('判分：字母一致算对，缺一算错', () => {
  assert.equal(judge('B', '正确答案：B'), true);
  assert.equal(judge('B', '正确答案：C'), false);
  assert.equal(judge('B', ''), false);
  assert.equal(judge('', 'B'), false);
});

test('labelOf 只留 A-H', () => {
  assert.equal(labelOf(opt('B.', 'x')), 'B');
  assert.equal(labelOf(opt('选项C', 'x')), 'C');
});

test('题面摘要保留【题型】前缀并截断', () => {
  assert.equal(summaryOf('根据课程【单选题】下列正确的是'), '【单选题】下列正确的是');
  assert.equal(summaryOf('x'.repeat(100)).length, 60);
});

test('答题历史：字段与旧实现一致', () => {
  const d = {
    title: '【单选题】题目',
    options: [opt('A.', '甲选项很长很长很长很长很长很长很长很长'), opt('B.', '乙')],
  };
  const h = historyEntry({
    point: { questionIds: 'q1' },
    dialog: d,
    chosenIdx: 1,
    how: 'LLM',
    right: true,
    answerText: '正确答案：B',
    at: '10:00:00',
  });
  assert.deepEqual(h, {
    qid: 'q1',
    summary: '【单选题】题目',
    chosen: 'B. 乙',
    by: 'LLM',
    right: true,
    correct: '正确答案：B',
    result: 'ok',
    at: '10:00:00',
  });
});

test('答题历史：没判分时 result=ok', () => {
  const h = historyEntry({
    point: null,
    dialog: { title: '', options: [] },
    chosenIdx: 0,
    how: '随机',
    right: null,
    answerText: '',
    at: 'x',
  });
  assert.equal(h.result, 'ok');
  assert.equal(h.qid, '?');
});
