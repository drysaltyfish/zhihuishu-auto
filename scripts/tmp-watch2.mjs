import fs from 'node:fs';
const u = new URL(fs.readFileSync('data/server.url','utf8').trim());
const t = u.searchParams.get('t');
const st = async () => (await fetch('http://127.0.0.1:8731/api/state?t='+t)).json();
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
let last='';
for (let i=0;i<40;i++){
  const a = await st();
  const k = a.phase+'|'+Math.round((a.video&&a.video.ct)||0)+'|'+(a.notice||'').slice(0,24);
  if (k!==last){ last=k; console.log(a.phase,'ct='+Math.round((a.video&&a.video.ct)||0)+'/'+Math.round((a.video&&a.video.dur)||0),'paused='+(a.video&&a.video.paused),'|',(a.notice||'—').slice(0,36)); }
  await sleep(4000);
}
console.log('--- log tail ---');
console.log(fs.readFileSync('data/runtime.log','utf8').trim().split('\n').slice(-12).join('\n'));