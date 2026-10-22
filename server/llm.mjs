/** 答题用的 LLM 调用（worker 与 /api/llmcheck 共用；不依赖 playwright，可单独测） */

const LETTERS = 'ABCDEFGH';
const TRIVIAL = /^(对|正确|√|true|是|错|错误|×|false|否)$/i;

/** 从模型回复里抠出一个选项字母：优先行首字母，其次「答案是 B」这类，最后全文唯一字母 */
export function pickLetter(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  let m = /^[*#\s"'“”‘’【\[]*([A-Ha-h])\b/.exec(s);
  if (m) return m[1].toUpperCase();
  m = /(?:正确)?(?:答案|选项|应选|选择|choose|answer|option)\s*(?:是|为|:|：)?\s*[*#"“'【\[]*([A-Ha-h])\b/i.exec(s);
  if (m) return m[1].toUpperCase();
  const all = s.match(/\b[A-Ha-h]\b/g) || [];
  const uniq = [...new Set(all.map((x) => x.toUpperCase()))];
  if (uniq.length === 1) return uniq[0];
  return '';
}

/** 生成给模型的题面文本 */
export function buildPrompt(question, options) {
  const opts = options.slice(0, 8).map((o, i) => (o.label || LETTERS[i] + '.') + ' ' + o.text).join('\n');
  return '请为下面这道课程测验题选一个正确答案。只输出一个选项字母（A-H），不要解释、不要复述题目。\n\n题目：' + question + '\n\n选项：\n' + opts;
}

/**
 * 让模型选一个选项。
 * @returns {Promise<{ok:boolean, idx?:number, letter?:string, raw?:string, why?:string, ms?:number}>}
 */
export async function askLLM(llm, { question, options, timeoutMs } = {}) {
  const t0 = Date.now();
  if (!llm || !llm.apiKey) return { ok: false, why: '未配置 API Key' };
  const opts = Array.isArray(options) ? options : [];
  if (!opts.length) return { ok: false, why: '没有选项' };
  const judge = opts.length <= 2 && opts.every((o) => TRIVIAL.test(String(o.text || '').trim()));
  const body = {
    model: llm.model || 'deepseek-chat',
    messages: [
      { role: 'system', content: judge ? '你只输出一个汉字：对 或 错。不要解释。' : '你只输出一个选项字母，不含标点、解释或题目。' },
      { role: 'user', content: judge ? '判断下面这句话对不对，只回答「对」或「错」：\n' + question : buildPrompt(question, opts) },
    ],
    temperature: 0,
    stream: false,
    max_tokens: Math.max(256, Number(llm.maxTokens) || 1024),
  };
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), Number(timeoutMs || llm.timeoutMs) || 30000);
    const resp = await fetch(String(llm.baseUrl || 'https://api.deepseek.com').replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + llm.apiKey },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    clearTimeout(timer);
    const text = await resp.text();
    if (!resp.ok) return { ok: false, why: '接口返回 HTTP ' + resp.status + '：' + text.slice(0, 120), ms: Date.now() - t0 };
    let j = {};
    try { j = JSON.parse(text); } catch { return { ok: false, why: '接口返回的不是 JSON', ms: Date.now() - t0 }; }
    if (j.error) return { ok: false, why: '接口报错：' + String(j.error.message || j.error).slice(0, 120), ms: Date.now() - t0 };
    const choice = (j.choices && j.choices[0]) || {};
    const msg = choice.message || {};
    const content = String(msg.content || '').trim();
    const reasoning = String(msg.reasoning_content || '').trim();
    if (judge) {
      const pickTrue = /^(对|正确|√|true|是)/i.test(content) || (content.match(/对/g) || []).length > (content.match(/错/g) || []).length;
      if (!content) return { ok: false, why: '模型没有给出内容' + (choice.finish_reason === 'length' ? '（被 max_tokens 截断，可能在推理）' : ''), ms: Date.now() - t0 };
      const idx = pickTrue ? 0 : 1;
      return { ok: true, idx, letter: String(idx + 1), raw: content.slice(0, 40), ms: Date.now() - t0 };
    }
    let letter = pickLetter(content);
    let raw = content;
    if (!letter && reasoning) {
      // 推理型模型可能把 token 花在 reasoning 上：从推理里找唯一字母兜底
      letter = pickLetter(reasoning.slice(-400));
      raw = content || reasoning.slice(-40);
    }
    if (!letter) {
      const why = content
        ? '模型回复里没有选项字母：' + content.slice(0, 60)
        : '模型没给内容' + (choice.finish_reason === 'length' ? '（被 max_tokens 截断，可能在推理）' : '');
      return { ok: false, why, raw: raw.slice(0, 60), ms: Date.now() - t0 };
    }
    const idx = LETTERS.indexOf(letter);
    if (idx < 0 || idx >= opts.length) return { ok: false, why: '模型答的 ' + letter + ' 不在选项范围内', raw: raw.slice(0, 60), ms: Date.now() - t0 };
    return { ok: true, idx, letter, raw: raw.slice(0, 60), ms: Date.now() - t0 };
  } catch (e) {
    const msg2 = String((e && e.message) || e);
    return { ok: false, why: /abort/i.test(msg2) ? '接口超时' : '请求失败：' + msg2.slice(0, 100), ms: Date.now() - t0 };
  }
}
