import fs from 'node:fs';
const u = new URL(fs.readFileSync('data/server.url','utf8').trim());
const t = u.searchParams.get('t');
const base = 'http://127.0.0.1:8731';
const api = (p, body) => fetch(base+p+'?t='+t, body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{}).then(async r=>({s:r.status,b:await r.json()}));
const st = async () => (await api('/api/state')).b;
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
console.log('quit:', (await api('/api/control',{action:'quit'})).s);
await sleep(9000);
console.log('start:', (await api('/api/start',{})).s);
let t0=Date.now(), a;
while (Date.now()-t0<200000) { a = await st(); if (a.phase==='PLAYING' && a.video && a.video.ct>10 && (a.lessons||[]).length && (a.questionPoints||[]).length) break; await sleep(2500); }
console.log('playing: ct=', Math.round(a.video.ct), a.course.name, 'pts=', (a.questionPoints||[]).map(p=>p.timeSec).join(','), 'loaded=', a.pointsLoaded);

// A) 选同一门课：不应有 COURSE_PICK、不应回退
const ctB = a.video.ct;
const r1 = await api('/api/course', { index: 0 });
let sawPick = false;
for (let i=0;i<6;i++){ await sleep(700); const b=await st(); if (b.phase==='COURSE_PICK') sawPick=true; if(i===5) console.log('A) after same-course: phase=',b.phase,'ct=',Math.round((b.video&&b.video.ct)||0),'notice=',(b.notice||'').slice(0,40)); }
console.log('A) POST->', r1.s, 'sawCoursePick=', sawPick, 'ctBefore=', Math.round(ctB));

// B) 等新弹题并观察答题后弹题点是否还在
console.log('B) 等弹题…');
const baseHist = (a.history||[]).length;
t0 = Date.now();
let answeredAt = 0;
while (Date.now()-t0 < 330000) {
  a = await st();
  if ((a.history||[]).length > baseHist && !answeredAt) {
    answeredAt = Date.now();
    console.log('  答题完成时刻，pts=', JSON.stringify((a.questionPoints||[]).map(p=>({t:p.timeSec,s:p.state,ans:p.answered}))), 'loaded=', a.pointsLoaded);
  }
  if (answeredAt && Date.now()-answeredAt > 8000) { break; }
  await sleep(1500);
}
console.log('B) 8 秒后 pts=', JSON.stringify((a.questionPoints||[]).map(p=>({t:p.timeSec,s:p.state,ans:p.answered}))), 'phase=', a.phase, 'loaded=', a.pointsLoaded);
console.log(fs.readFileSync('data/runtime.log','utf8').trim().split('\n').slice(-12).join('\n'));