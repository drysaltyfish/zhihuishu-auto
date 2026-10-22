import fs from 'node:fs';
const cfg = JSON.parse(fs.readFileSync('data/config.json','utf8').replace(/^\uFEFF/, ''));
const llm = cfg.llm;
const imgPath = 'C:/Users/lenovo/.dsh/attachments/v1/objects/4e/4ec0669bbd38a16990ededdf282bce5e20ba1d47ac59bc9800fc42fe02a4a49b';
const b64 = fs.readFileSync(imgPath).toString('base64');
const prompt = [
  '这是一张 2048x1156 像素的网页截图，中间有一个点选验证码。',
  '请只输出一个 JSON 对象，不要任何解释文字，格式：',
  '{"prompt":"验证码下方的提示原文（逐字）","canvas":{"x":0,"y":0,"w":0,"h":0},"chars":[{"text":"字符","color":"颜色","x":0.0,"y":0.0}]}',
  '其中 canvas 是验证码图片（浅灰/白色画布，含右上角刷新按钮）在截图中的像素矩形；chars 里 x,y 是字符中心相对 canvas 左上角的百分比（0-100，一位小数）。',
  '如实填写你看到的每个字符，不确定的字形标注最可能的值。',
].join('\n');
async function ask(n) {
  const body = { model: llm.model, messages: [{ role: 'user', content: [
    { type: 'text', text: prompt },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,' + b64, detail: 'original' } },
  ] }], max_tokens: 4096, temperature: 0 };
  const t0 = Date.now();
  const resp = await fetch(llm.baseUrl.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + llm.apiKey }, body: JSON.stringify(body),
  });
  const j = await resp.json();
  const m = (j.choices && j.choices[0] && j.choices[0].message) || {};
  console.log('--- call', n, 'HTTP', resp.status, 'ms=', Date.now() - t0, 'finish=', j.choices && j.choices[0] && j.choices[0].finish_reason);
  console.log('content:', JSON.stringify((m.content || '').slice(0, 1200)));
  console.log('usage:', JSON.stringify(j.usage));
}
await ask(1);
await ask(2);
