import fs from 'node:fs';
const u = new URL(fs.readFileSync('data/server.url', 'utf8').trim());
const t = u.searchParams.get('t');
const base = 'http://127.0.0.1:8731';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = () => fetch(base + '/api/state?t=' + t).then((r) => r.json());
const ctrl = (action, data) => fetch(base + '/api/control?t=' + t, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, data }) }).then((r) => r.text());

console.log('quit ->', await ctrl('quit'));
for (let i = 0; i < 20; i++) { const s = await state(); if (s.phase === 'STOPPED') { console.log('stopped'); break; } await sleep(1000); }

console.log('start ->', await fetch(base + '/api/start?t=' + t, { method: 'POST' }).then((r) => r.text()));
let s = null;
for (let i = 0; i < 90; i++) {
  s = await state();
  if (i % 5 === 0) console.log(' phase=' + s.phase, s.notice || '');
  if (s.phase === 'PLAYING' || s.phase === 'PAUSED' || s.phase === 'ENDED') break;
  await sleep(2000);
}
if (!s || !['PLAYING', 'PAUSED', 'ENDED'].includes(s.phase)) { console.log('did not reach playing, abort'); process.exit(1); }
console.log('probe ->', await ctrl('probe'));
await sleep(30000);
const dir = 'data/debug';
console.log('--- afterclick ---');
try { console.log(fs.readFileSync(dir + '/learnhome-afterclick.json', 'utf8').slice(0, 1500)); } catch (e) { console.log('no afterclick json'); }
console.log('--- log tail ---');
try { console.log(fs.readFileSync('data/runtime.log','utf8').split('\n').filter(l=>l.includes('探针')).slice(-12).join('\n')); } catch {}
const files = fs.readdirSync(dir).filter((f) => f.startsWith('learnhome-') && f.endsWith('.json')).sort();
console.log('files:', files.slice(-3).join(', '));
const last = files[files.length - 1];
if (last) {
  const j = JSON.parse(fs.readFileSync(dir + '/' + last, 'utf8'));
  console.log('URL:', j.url);
  console.log('first:', JSON.stringify(j.first));
  console.log('cards:', j.cards.length, 'links:', j.links.length);
  console.log(JSON.stringify(j.links.slice(0, 8), null, 1));
  console.log(JSON.stringify(j.cards.slice(0, 12), null, 1));
  console.log('res:', JSON.stringify(j.res.slice(0, 20), null, 1));
  console.log('ls keys:', Object.keys(j.ls || {}));
}
