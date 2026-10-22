import fs from 'node:fs';
const u = new URL(fs.readFileSync('data/server.url','utf8').trim());
const t = u.searchParams.get('t');
const base = 'http://127.0.0.1:8731';
const api = (p, body) => fetch(base+p+'?t='+t, body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{}).then(async r=>({s:r.status,b:await r.json()}));
const st = async () => (await api('/api/state')).b;
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const pts = (a) => JSON.stringify((a.questionPoints||[]).map(p=>({t:p.timeSec,ans:!!p.answered})));
console.log('quit', (await api('/api/control',{action:'quit'})).s);
await sleep(8000);
console.log('start', (await api('/api/start',{})).s);
let a, t0=Date.now();
while (Date.now()-t0<200000) { a = await st(); if (a.phase==='PLAYING' && a.video && a.video.ct>5) break; await sleep(2000); }
console.log('PLAYING ct=', Math.round(a.video.ct), 'section=', a.summary && a.summary.section && a.summary.section.pct, 'pts=', pts(a), 'loaded=', a.pointsLoaded);
const baseHist = (a.history||[]).length;
console.log('wait popup, baseHist=', baseHist);
t0 = Date.now();
let mark = 0;
while (Date.now()-t0 < 800000) {
  a = await st();
  if ((a.history||[]).length > baseHist && !mark) {
    mark = Date.now();
    console.log('ANSWERED at ct=', Math.round(a.video.ct), 'pts=', pts(a), 'phase=', a.phase);
  }
  if (mark && Date.now()-mark > 12000) { console.log('12s later pts=', pts(a), 'loaded=', a.pointsLoaded, 'phase=', a.phase); break; }
  if (!mark && (Date.now()-t0) % 60000 < 3000) console.log('  ...waiting ct=', Math.round(a.video.ct), 'pts=', pts(a));
  await sleep(1500);
}
console.log(fs.readFileSync('data/runtime.log','utf8').trim().split('\n').slice(-14).join('\n'));