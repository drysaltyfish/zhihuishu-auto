import fs from 'node:fs';
const u = new URL(fs.readFileSync('data/server.url','utf8').trim());
const t = u.searchParams.get('t');
const r = await fetch('http://127.0.0.1:8731/api/control?t='+t, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({action:'quit'}) });
console.log('quit', r.status, await r.text());
await new Promise(x=>setTimeout(x,9000));
const s = await (await fetch('http://127.0.0.1:8731/api/state?t='+t)).json().catch(()=>null);
console.log('phase now:', s && s.phase);
