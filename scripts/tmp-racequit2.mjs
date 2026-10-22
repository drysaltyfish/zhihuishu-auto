import fs from 'node:fs';
const u = new URL(fs.readFileSync('data/server.url','utf8').trim());
const t = u.searchParams.get('t');
const api = (p, body) => fetch('http://127.0.0.1:8731'+p+'?t='+t, body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{}).then(async r=>({s:r.status,b:await r.json()}));
const st = async () => (await api('/api/state')).b;
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const before = await st(); console.log('running?', before.phase, 'ct=', before.video&&Math.round(before.video.ct));
const mark = fs.readFileSync('data/runtime.log','utf8').length;
console.log('quit', (await api('/api/control',{action:'quit'})).s);
let t0=Date.now(); let a;
while (Date.now()-t0<45000) { a = await st(); if (a.phase==='STOPPED') break; await sleep(800); }
console.log('after quit:', a.phase);
console.log('start', (await api('/api/start',{})).s);
t0=Date.now();
while (Date.now()-t0<120000) { a = await st(); if (a.phase==='PLAYING') break; await sleep(1500); }
console.log('after start:', a.phase, '| notice=', JSON.stringify(a.notice), '| verifyHint=', JSON.stringify(a.verifyHint));
await sleep(6000);
a = await st();
console.log('6s later:', a.phase, '| notice=', JSON.stringify(a.notice), '| ct=', a.video&&Math.round(a.video.ct), '/', a.video&&Math.round(a.video.dur));
const tail = fs.readFileSync('data/runtime.log','utf8').slice(mark).trim().split('\n');
console.log('--- 新一轮日志 ---'); console.log(tail.join('\n'));
console.log('含「异常退出」行数:', tail.filter(l=>l.includes('异常退出')).length);