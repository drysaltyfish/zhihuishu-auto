import fs from 'node:fs';
const cfg = JSON.parse(fs.readFileSync('data/config.json','utf8').replace(/^\uFEFF/, ''));
const llm = cfg.llm;
console.log('model=', llm.model, 'baseUrl=', llm.baseUrl, 'keyLen=', (llm.apiKey||'').length);
const imgPath = 'C:/Users/lenovo/.dsh/attachments/v1/objects/4e/4ec0669bbd38a16990ededdf282bce5e20ba1d47ac59bc9800fc42fe02a4a49b';
const b64 = fs.readFileSync(imgPath).toString('base64');
console.log('img bytes=', fs.statSync(imgPath).size, 'b64 len=', b64.length);
const body = {
  model: llm.model,
  messages: [{ role: 'user', content: [
    { type: 'text', text: '这是一张网页截图，中间有一个「请完成安全验证」的点选验证码。请完成两件事：\n1) 逐字读出验证码下方的操作提示原文；\n2) 描述验证码图片画布区域里所有能看到的内容：每个字符的字形（字母/数字）、颜色、大致位置（以画布左上角为原点，给出百分比坐标 x%,y%），以及画布相对整张截图的像素范围。只输出你真实看到的内容，看不清就说看不清。' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,' + b64, detail: 'original' } },
  ] }],
  max_tokens: 2048,
  temperature: 0,
};
const t0 = Date.now();
const resp = await fetch(llm.baseUrl.replace(/\/$/, '') + '/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer ' + llm.apiKey },
  body: JSON.stringify(body),
});
const txt = await resp.text();
console.log('HTTP', resp.status, 'ms=', Date.now() - t0);
console.log(txt.slice(0, 4000));
