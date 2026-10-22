import fs from 'node:fs';
import { execSync, spawn } from 'node:child_process';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function state(t) {
  const r = await fetch('http://127.0.0.1:8731/api/state?t=' + t);
  return r.ok ? r.json() : null;
}
function pidOnPort() {
  try {
    const line = execSync('netstat -ano', { encoding: 'utf8' }).split('\n').find((l) => l.includes(':8731') && /LISTENING/i.test(l));
    return line ? Number(line.trim().split(/\s+/).pop()) : null;
  } catch { return null; }
}

// 1) graceful quit if a server is running
let pid = pidOnPort();
if (pid) {
  try {
    const url = fs.readFileSync('data/server.url', 'utf8').trim();
    const t = new URL(url).searchParams.get('t');
    await fetch('http://127.0.0.1:8731/api/control?t=' + t, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd: 'quit' }) });
    console.log('sent quit');
    await sleep(9000);
  } catch (e) { console.log('quit failed', e.message); }
  pid = pidOnPort();
  if (pid) { try { execSync('taskkill /F /PID ' + pid, { stdio: 'ignore' }); console.log('killed server', pid); } catch {} await sleep(1500); }
}

// 2) fresh server + start
const log = fs.openSync('data/server.log', 'w');
const child = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, ZHS_DEBUG: '1' }, stdio: ['ignore', log, log], detached: true });
child.unref();
await sleep(3000);
const url = fs.readFileSync('data/server.url', 'utf8').trim();
const t = new URL(url).searchParams.get('t');
console.log('server', url);
const rs = await fetch('http://127.0.0.1:8731/api/start?t=' + t, { method: 'POST' });
console.log('start', rs.status, await rs.text());

// 3) observe
const t0 = Date.now();
let last = '';
for (let i = 0; i < 40; i++) {
  await sleep(5000);
  const s = await state(t).catch(() => null);
  if (!s) continue;
  const cur = (s.lessons || []).find((l) => l.current) || {};
  const line = [
    ((Date.now() - t0) / 1000).toFixed(0) + 's',
    s.phase,
    '节=' + (cur.code || '?') + (cur.pct != null ? '(' + cur.pct + '%)' : ''),
    'ct=' + (s.video && s.video.ct != null ? Math.round(s.video.ct) : '?') + '/' + (s.video && s.video.dur ? Math.round(s.video.dur) : '?'),
    '弹题=' + (s.nextQuestion ? s.nextQuestion.atSec : '-'),
    'notice=' + (s.notice || ''),
  ].join(' | ');
  if (line.slice(4) !== last) { console.log(line); last = line.slice(4); }
}
console.log('--- server.log ---');
console.log(fs.readFileSync('data/server.log', 'utf8').split('\n').filter(Boolean).slice(-30).join('\n'));
