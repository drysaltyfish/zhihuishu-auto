
import fs from 'node:fs';
const u = new URL(fs.readFileSync('data/server.url','utf8').trim());
const t = u.searchParams.get('t');
const post = (p, body) => fetch('http://127.0.0.1:8731'+p+'?t='+t,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body||{})}).then(r=>r.json());
console.log('start ->', JSON.stringify(await post('/api/start')));
