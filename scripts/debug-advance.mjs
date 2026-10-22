import fs from 'node:fs';
import { execSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const out = execSync('netstat -ano', { encoding: 'utf8' });
  const line = out.split('\n').find((l) => l.includes(':8731') && /LISTENING/i.test(l));
  if (line) {
    const pid = line.trim().split(/\s+/).pop();
    execSync('taskkill /F /PID ' + pid, { stdio: 'ignore' });
    console.log('killed old server', pid);
    await sleep(1200);
  }
} catch {}
for (const f of fs.readdirSync('data/debug').filter((f) => f.startsWith('pageinfo-'))) fs.unlinkSync('data/debug/' + f);

const { spawn } = await import('node:child_process');
const log = fs.openSync('data/server.log', 'w');
const child = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, ZHS_DEBUG: '1' }, stdio: ['ignore', log, log], detached: true });
child.unref();
await sleep(3000);
const url = fs.readFileSync('data/server.url', 'utf8').trim();
console.log('url', url);
const t = new URL(url).searchParams.get('t');
const r = await fetch('http://127.0.0.1:8731/api/start?t=' + t, { method: 'POST' });
console.log('start ->', r.status, await r.text());
for (let i = 0; i < 40; i++) {
  await sleep(5000);
  const files = fs.readdirSync('data/debug').filter((f) => f.startsWith('pageinfo-'));
  if (files.length) { console.log('dumped after', (i + 1) * 5, 's', files); break; }
}
console.log('--- server.log tail ---');
console.log(fs.readFileSync('data/server.log', 'utf8').split('\n').slice(-25).join('\n'));
