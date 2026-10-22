
import fs from 'node:fs';
const u = new URL(fs.readFileSync('data/server.url','utf8').trim());
const t = u.searchParams.get('t');
const post = (p, body) => fetch('http://127.0.0.1:8731'+p+'?t='+t,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})}).then(r=>r.json());
const st = () => fetch('http://127.0.0.1:8731/api/state?t='+t).then(r=>r.json());
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const brief = (s) => JSON.stringify({ phase:s.phase, cur:(s.lessons||[]).filter(l=>l.current).map(l=>l.code), ct:Math.round(s.video.ct), dur:Math.round(s.video.dur), notice:s.notice });
console.log('restart ->', JSON.stringify(await post('/api/control', { action:'restart' })));
for (let i=0;i<40;i++){ await sleep(3000); const s=await st(); if (s.phase==='PLAYING' && s.video.dur>100) { console.log('playing after restart:', brief(s)); break; } if (i===39) console.log('timeout waiting playing:', brief(s)); }
await sleep(3000);
console.log('switch 2.1 ->', JSON.stringify(await post('/api/lesson',{code:'2.1'})));
for (let i=0;i<12;i++){ await sleep(2500); const s=await st(); console.log('  +', (i+1)*2.5, brief(s)); }
console.log('switch back 1.3 ->', JSON.stringify(await post('/api/lesson',{code:'1.3'})));
for (let i=0;i<6;i++){ await sleep(2500); const s=await st(); console.log('  back +', (i+1)*2.5, brief(s)); }
