
import fs from 'node:fs';
const u = new URL(fs.readFileSync('data/server.url','utf8').trim());
const t = u.searchParams.get('t');
const st = () => fetch('http://127.0.0.1:8731/api/state?t='+t).then(r=>r.json());
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
console.log('now', new Date().toTimeString().slice(0,8));
for (let i=0;i<5;i++){ const s=await st(); console.log(Math.round(s.video.ct*100)/100, s.video.paused, s.phase, s.notice||''); await sleep(2000); }
