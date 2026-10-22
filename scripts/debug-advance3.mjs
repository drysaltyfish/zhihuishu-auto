import fs from 'node:fs';
import { execSync, spawn } from 'node:child_process';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pidOnPort = () => {
  try {
    const line = execSync('netstat -ano', { encoding: 'utf8' }).split('\n').find((l) => l.includes(':8731') && /LISTENING/i.test(l));
    return line ? Number(line.trim().split(/\s+/).pop()) : null;
  } catch { return null; }
};
// 1) 先优雅退出，再清掉残留 Chrome
let pid = pidOnPort();
if (pid) {
  try {
    const u = new URL(fs.readFileSync('data/server.url', 'utf8').trim());
    await fetch('http://127.0.0.1:8731/api/control?t=' + u.searchParams.get('t'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'quit' }) });
    await sleep(9000);
  } catch {}
  pid = pidOnPort();
  if (pid) { try { execSync('taskkill /F /PID ' + pid, { stdio: 'ignore' }); } catch {} await sleep(1500); }
}
try {
  const ps = 'Get-CimInstance Win32_Process -Filter "Name=\'chrome.exe\'" | Where-Object { $_.CommandLine -like "*zhihuishu-auto*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }';
  execSync('powershell -NoProfile -Command "' + ps.replace(/"/g, '\\"') + '"', { stdio: 'ignore' });
  console.log('cleaned leftover chrome');
} catch (e) { console.log('chrome cleanup skipped'); }
await sleep(1000);
try { fs.unlinkSync('data/runtime.log'); } catch {}
const lf = fs.openSync('data/server.log', 'w');
spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, ZHS_DEBUG: '1' }, stdio: ['ignore', lf, lf], detached: true }).unref();
await sleep(3000);
const u = new URL(fs.readFileSync('data/server.url', 'utf8').trim());
const t = u.searchParams.get('t');
await fetch('http://127.0.0.1:8731/api/start?t=' + t, { method: 'POST' });
console.log('started');
let offset = 0;
const tail = () => {
  try {
    const s = fs.readFileSync('data/runtime.log', 'utf8');
    if (s.length > offset) { process.stdout.write(s.slice(offset).split('\n').filter(Boolean).map((x) => '   · ' + x).join('\n') + '\n'); offset = s.length; }
  } catch {}
};
const t0 = Date.now();
for (let i = 0; i < 26; i++) {
  await sleep(6000);
  tail();
  const s = await (await fetch('http://127.0.0.1:8731/api/state?t=' + t)).json();
  const cur = (s.lessons || []).find((l) => l.current) || {};
  console.log(((Date.now() - t0) / 1000).toFixed(0) + 's phase=' + s.phase + ' 节=' + (cur.code || '?') + ' ct=' + (s.video?.ct != null ? Math.round(s.video.ct) : '?') + '/' + (s.video?.dur ? Math.round(s.video.dur) : '?') + ' 已答=' + (s.answers?.count || 0) + (s.notice ? ' | ' + s.notice : ''));
}
tail();
