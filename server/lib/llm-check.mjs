/** /api/llmcheck：用一道样题试一下模型通不通（不动浏览器，只发一次请求） */
import { askLLM } from '../llm.mjs';

export const SAMPLE_CHECK = {
  question: '下列关于心理健康的说法，哪一项最准确？',
  options: [
    { label: 'A.', text: '心理健康就是永远没有烦恼' },
    { label: 'B.', text: '心理健康是一种持续、积极且能适应环境的状态' },
    { label: 'C.', text: '只要没有心理疾病就是心理健康' },
    { label: 'D.', text: '心理健康与身体健康无关' },
  ],
  answerIdx: 1,
};

export async function runLlmCheck(llm, { ask = askLLM } = {}) {
  const r = await ask(llm, { question: SAMPLE_CHECK.question, options: SAMPLE_CHECK.options, timeoutMs: 30000 });
  const ok = !!(r && r.ok && r.idx === SAMPLE_CHECK.answerIdx);
  return {
    ok,
    model: (llm && llm.model) || '',
    letter: (r && r.letter) || '',
    why: (r && r.why) || '',
    raw: (r && r.raw) || '',
    ms: (r && r.ms) || 0,
  };
}
