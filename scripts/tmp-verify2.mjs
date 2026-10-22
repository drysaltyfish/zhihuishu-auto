import fs from 'node:fs';
const u = new URL(fs.readFileSync('data/server.url','utf8').trim());
const t = u.searchParams.get('t');
const base = 'http://127.0.0.1:8731';
const api = (p, body) => fetch(base+p+'?t='+t, body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{}).then(async r=>({s:r.status,b:await r.json()}));
const st = async () => (await api('/api/state')).b;
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const logtail = (n=10) => fs.readFileSync('data/runtime.log','utf8').trim().split('\n').slice(-n).join('\n');

console.log('quit:', (await api('/api/control',{action:'quit'})).s);
await sleep(9000);
console.log('start:', (await api('/api/start',{})).s);
let t0=Date.now(), a;
while (Date.now()-t0<200000) { a = await st(); if (a.phase==='PLAYING' && a.video && a.video.ct>10 && (a.lessons||[]).length) break; await sleep(2500); }
console.log('playing:', a.phase, 'ct=', Math.round(a.video.ct), a.course.name, 'lessons=', (a.lessons||[]).length, 'pts=', (a.questionPoints||[]).map(p=>p.timeSec).join(','));

// 1) 选同一门课
const ctB = a.video.ct;
const r1 = await api('/api/course', { index: 0 });
console.log('POST same course ->', r1.s, JSON.stringify(r1.b).slice(0,100));
await sleep(4000);
const b1 = await st();
console.log('after same-course:', b1.phase, 'ct=', Math.round((b1.video&&b1.video.ct)||0), 'notice=', (b1.notice||'').slice(0,40), 'lessons=', (b1.lessons||[]).length, 'ctBefore=', Math.round(ctB));

// 2) 等下一个弹题点，观察答题后弹题点是否还在
console.log('--- 等弹题 ---');
t0 = Date.now();
let seenAnswer=false;
while (Date.now()-t0 < 240000) {
  a = await st();
  if (a.phase==='ANSWERING' || (a.history||[]).length > 0) { seenAnswer = true; }
  if (seenAnswer && a.phase==='PLAYING') {
    console.log('answered; phase=', a.phase, 'history=', (a.history||[]).length, 'pts=', JSON.stringify((a.questionPoints||[]).map(p=>({t:p.timeSec,s:p.state,ans:p.answered}))));
    break;
  }
  await sleep(2500);
}
console.log('log tail:\n' + logtail(14));