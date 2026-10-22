import fs from 'node:fs';
const u = new URL(fs.readFileSync('data/server.url','utf8').trim());
const t = u.searchParams.get('t');
const base = 'http://127.0.0.1:8731';
const api = (p, body) => fetch(base+p+'?t='+t, body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{}).then(async r=>({s:r.status,b:await r.json()}));
const st = async () => (await api('/api/state')).b;
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
console.log('quit', (await api('/api/control',{action:'quit'})).s);
await sleep(8000);
console.log('start', (await api('/api/start',{})).s);
const seen = [];
let t0 = Date.now(), a;
while (Date.now()-t0 < 150000) {
  a = await st();
  const key = a.phase + (a.verifyHint ? '[' + a.verifyHint.slice(0,20) + ']' : '');
  if (!seen.length || seen[seen.length-1] !== key) { seen.push(key); console.log(((Date.now()-t0)/1000).toFixed(0)+'s', key, 'ct=', a.video && Math.round(a.video.ct), 'pts=', (a.questionPoints||[]).map(p=>p.timeSec).join(',')); }
  if (a.phase === 'PLAYING' && a.video && a.video.ct > 20) break;
  await sleep(2000);
}
console.log('final', JSON.stringify({phase:a.phase, notice:a.notice, verifyHint:a.verifyHint, ct:a.video&&a.video.ct, ptsLoaded:a.pointsLoaded, nPts:(a.questionPoints||[]).length, lessons:(a.lessons||[]).length}));
console.log(fs.readFileSync('data/runtime.log','utf8').trim().split('\n').slice(-10).join('\n'));