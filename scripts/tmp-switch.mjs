
import fs from 'node:fs';
const u = new URL(fs.readFileSync('data/server.url','utf8').trim());
const t = u.searchParams.get('t');
const post = (p, body) => fetch('http://127.0.0.1:8731' + p + '?t=' + t, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body||{}) }).then(r=>r.json());
const st = () => fetch('http://127.0.0.1:8731/api/state?t='+t).then(r=>r.json());
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
console.log('switch 2.1 ->', JSON.stringify(await post('/api/lesson', { code:'2.1' })));
await sleep(14000);
let s = await st();
console.log('after 2.1:', JSON.stringify({ phase:s.phase, cur:(s.lessons||[]).filter(l=>l.current).map(l=>l.code), ct:Math.round(s.video.ct), dur:Math.round(s.video.dur), notice:s.notice }));
console.log('switch back 1.3 ->', JSON.stringify(await post('/api/lesson', { code:'1.3' })));
await sleep(14000);
s = await st();
console.log('after 1.3:', JSON.stringify({ phase:s.phase, cur:(s.lessons||[]).filter(l=>l.current).map(l=>l.code), ct:Math.round(s.video.ct), dur:Math.round(s.video.dur), answers:s.answers }));
