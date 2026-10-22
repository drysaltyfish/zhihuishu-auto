import fs from 'node:fs';
const u = new URL(fs.readFileSync('data/server.url','utf8').trim());
const t = u.searchParams.get('t');
const api = (p, body) => fetch('http://127.0.0.1:8731'+p+'?t='+t, body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{}).then(async r=>({s:r.status,b:await r.json()}));
const st = async () => (await api('/api/state')).b;
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
let a = await st();
console.log('before start:', a.phase, '| verifyHint=', JSON.stringify(a.verifyHint));
console.log('start', (await api('/api/start',{})).s);
let t0=Date.now(), seen=[];
while (Date.now()-t0<180000) {
  a = await st();
  const k = a.phase + (a.verifyHint ? '['+a.verifyHint.slice(0,14)+']' : '');
  if (!seen.length || seen[seen.length-1]!==k) { seen.push(k); console.log(((Date.now()-t0)/1000).toFixed(0)+'s', k, 'ct=', a.video && Math.round(a.video.ct), 'pts=', (a.questionPoints||[]).map(p=>p.timeSec).join(',')); }
  if (a.phase==='PLAYING' && a.video && a.video.ct>25) break;
  await sleep(2000);
}
console.log('final:', JSON.stringify({phase:a.phase, verifyHint:a.verifyHint, notice:a.notice, course:a.course&&a.course.name, lessons:(a.lessons||[]).length, ptsLoaded:a.pointsLoaded}));
console.log(fs.readFileSync('data/runtime.log','utf8').trim().split('\n').slice(-9).join('\n'));