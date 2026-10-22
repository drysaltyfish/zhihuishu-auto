import fs from 'node:fs';
const u = new URL(fs.readFileSync('data/server.url','utf8').trim());
const t = u.searchParams.get('t');
const base = 'http://127.0.0.1:8731';
const api = (p, body) => fetch(base+p+'?t='+t, body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{}).then(async r=>({s:r.status,b:await r.json()}));
const st = async () => (await api('/api/state')).b;
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
console.log('restart:', (await api('/api/control',{action:'restart'})).s);
let t0=Date.now(), a;
while (Date.now()-t0<180000) { a = await st(); if (a.phase==='PLAYING' && a.video && a.video.ct>5) break; await sleep(2000); }
console.log('playing:', a.phase, Math.round(a.video.ct), a.course.name, 'lessons=', (a.lessons||[]).length);
const ctBefore = a.video.ct;
const r = await api('/api/course', { index: 0 });
console.log('POST course ->', r.s);
for (let i=0;i<4;i++){ await sleep(2500); const b=await st(); console.log((i+1)*2.5+'s', b.phase, 'ct=', Math.round((b.video&&b.video.ct)||0), 'notice=', (b.notice||'').slice(0,40), 'pts=', (b.questionPoints||[]).length); }
console.log('ctBefore=', Math.round(ctBefore));
console.log(fs.readFileSync('data/runtime.log','utf8').trim().split('\n').slice(-8).join('\n'));