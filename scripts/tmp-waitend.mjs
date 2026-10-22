
import fs from 'node:fs';
const u = new URL(fs.readFileSync('data/server.url','utf8').trim());
const t = u.searchParams.get('t');
const st = () => fetch('http://127.0.0.1:8731/api/state?t='+t).then(r=>r.json());
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
let last = '';
const t0 = Date.now();
while (Date.now() - t0 < 8*60*1000) {
  try {
    const s = await st();
    const cur = (s.lessons||[]).filter(l=>l.current).map(l=>l.code).join(',');
    const sig = [s.phase, cur, Math.round(s.video.ct), s.notice].join('|');
    if (sig !== last) { last = sig; console.log(new Date().toTimeString().slice(0,8), 'phase=' + s.phase, 'cur=' + cur, 'ct=' + Math.round(s.video.ct) + '/' + Math.round(s.video.dur), s.notice ? '| ' + s.notice : ''); }
    if (s.phase === 'ENDED' || (cur && cur !== '1.3')) { console.log('CHANGED'); break; }
  } catch (e) { console.log('poll err', e.message); }
  await sleep(5000);
}
console.log('log tail:');
try { console.log(fs.readFileSync('data/runtime.log','utf8').split('\n').slice(-12).join('\n')); } catch {}
