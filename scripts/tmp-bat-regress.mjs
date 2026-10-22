import fs from 'node:fs';
const u = new URL(fs.readFileSync('data/server.url','utf8').trim());
const base = 'http://127.0.0.1:8731';
const t = u.searchParams.get('t');
const api = (p, body) => fetch(base+p+'?t='+t, body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{}).then(async r=>({s:r.status,b:await r.json()}));
console.log('start:', JSON.stringify((await api('/api/start',{})).b));
let last='';
for (let i=0;i<40;i++){
  await new Promise(r=>setTimeout(r,2000));
  const st=(await api('/api/state')).b;
  const line=[st.phase, st.notice||'', st.course&&st.course.name||'—', 'lessons='+((st.lessons||[]).length)].join(' | ');
  if(line!==last){ console.log(i*2+'s', line); last=line; }
  if(st.phase==='PLAYING' && (st.video&&st.video.currentTime>0)) { console.log('PLAYING ct=', st.video.currentTime); break; }
}