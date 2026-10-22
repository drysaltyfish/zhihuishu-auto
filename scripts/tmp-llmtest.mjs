
import fs from 'node:fs';
const cfg = JSON.parse(fs.readFileSync('data/config.json','utf8')).llm;
const body = {
  model: cfg.model,
  messages: [
    { role: 'system', content: '你只输出一个选项字母，不含标点或解释。' },
    { role: 'user', content: '题目：【单选题】大学阶段的核心发展任务包括以下哪两项？\n选项：\nA. 获得勤奋感\nB. 建立亲密关系\nC. 建立自我同一性\nD. 获得繁殖感' },
  ],
  temperature: 0.1, max_tokens: 8, stream: false,
};
const r = await fetch(cfg.baseUrl.replace(/\/$/,'') + '/chat/completions', { method:'POST', headers:{'content-type':'application/json',authorization:'Bearer '+cfg.apiKey}, body: JSON.stringify(body) });
console.log('status', r.status);
console.log((await r.text()).slice(0, 1500));
