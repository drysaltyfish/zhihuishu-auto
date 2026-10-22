import test from 'node:test';
import assert from 'node:assert/strict';
import { runLlmCheck, SAMPLE_CHECK } from '../server/lib/llm-check.mjs';

const LLM = { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: 'sk-x' };

test('模型选对样题 → ok', async () => {
  const r = await runLlmCheck(LLM, { ask: async () => ({ ok: true, idx: SAMPLE_CHECK.answerIdx, letter: 'B', ms: 321, raw: 'B' }) });
  assert.equal(r.ok, true);
  assert.equal(r.letter, 'B');
  assert.equal(r.model, 'deepseek-chat');
  assert.equal(r.ms, 321);
});

test('模型选错 → 不通，但带上它选的字母方便排查', async () => {
  const r = await runLlmCheck(LLM, { ask: async () => ({ ok: true, idx: 0, letter: 'A' }) });
  assert.equal(r.ok, false);
  assert.equal(r.letter, 'A');
});

test('调用失败 → ok=false 并带回原因', async () => {
  const r = await runLlmCheck(LLM, { ask: async () => ({ ok: false, why: '未配置 API Key' }) });
  assert.equal(r.ok, false);
  assert.equal(r.why, '未配置 API Key');
  assert.equal(r.letter, '');
});

test('ask 返回空也不炸，字段给默认值', async () => {
  const r = await runLlmCheck(LLM, { ask: async () => null });
  assert.equal(r.ok, false);
  assert.equal(r.letter, '');
  assert.equal(r.ms, 0);
  assert.equal(r.raw, '');
});

test('没传 llm 配置时 model 为空串', async () => {
  const r = await runLlmCheck(undefined, { ask: async () => ({ ok: true, idx: 1, letter: 'B' }) });
  assert.equal(r.ok, true);
  assert.equal(r.model, '');
});

test('把题面和选项原样交给模型', async () => {
  let seen = null;
  await runLlmCheck(LLM, { ask: async (llm, payload) => { seen = { llm, payload }; return { ok: true, idx: 1 }; } });
  assert.equal(seen.llm.model, 'deepseek-chat');
  assert.equal(seen.payload.question, SAMPLE_CHECK.question);
  assert.equal(seen.payload.options.length, 4);
  assert.equal(seen.payload.timeoutMs, 30000);
});
