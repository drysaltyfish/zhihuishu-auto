import fs from 'node:fs';
const u = new URL(fs.readFileSync('data/server.url','utf8').trim());
const t = u.searchParams.get('t');
const api = (p, body) => fetch('http://127.0.0.1:8731'+p+'?t='+t, body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{}).then(async r=>({s:r.status,b:await r.json()}));
const st = async () => (await api('/api/state')).b;
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
console.log('quit', (await api('/api/control',{action:'quit'})).s);
for (let i=0;i<30;i++){ const a=await st(); if (a.phase==='STOPPED') break; await sleep(1000); }
console.log('now', (await st()).phase);
console.log('start', (await api('/api/start',{})).s);
let t0=Date.now(), last='';
while (Date.now()-t0<210000) {
  const a = await st();
  const k = a.phase + '|' + Math.round((a.video&&a.video.ct)||0) + '|' + (a.notice||'').slice(0,28);
  if (k !== last) { last = k; console.log(((Date.now()-t0)/1000).toFixed(0)+'s', a.phase, 'ct='+Math.round((a.video&&a.video.ct)||0)+'/'+Math.round((a.video&&a.video.dur)||0), '|', (a.notice||'—').slice(0,40), '|', a.summary&&a.summary.section&&a.summary.section.name || ''); }
  if (a.phase==='PLAYING' && a.video && a.video.ct>15 && a.video.ct < a.video.dur-10) { console.log('== 已切到新的一节并开始播 =='); break; }
  await sleep(2500);
}
console.log('--- log tail ---');
console.log(fs.readFileSync('data/runtime.log','utf8').trim().split('\n').slice(-14).join('\n'));