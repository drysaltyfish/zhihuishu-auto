/** V1 验证：真实 worker 能否把 Chrome 拉起来并进入「等待登录」（不登录、不进课程） */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const p = spawn(process.execPath, ['server/index.mjs', '--port', '8792'], { cwd: process.cwd() });
let url = '';
p.stdout.on('data', (d) => {
  const m = String(d).match(/http:\/\/127\.0\.0\.1:8792\/\?t=[0-9a-f]+/);
  if (m) url = m[0];
});
p.stderr.on('data', (d) => process.stdout.write('[srv] ' + String(d).slice(0, 200) + '\n'));

for (let i = 0; i < 40 && !url; i++) await sleep(500);
if (!url) {
  console.log('FAIL 服务没起来');
  process.exit(1);
}
const token = new URL(url).searchParams.get('t');
const base = 'http://127.0.0.1:8792';
const api = async (path, body) => {
  const r = await fetch(
    base + path + '?t=' + token,
    body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}
  );
  return r.json();
};

console.log('点击开始听课…');
console.log(await api('/api/start', {}));

let phase = '',
  st = null;
const t0 = Date.now();
while (Date.now() - t0 < 75000) {
  st = await api('/api/state');
  if (st.phase !== phase) {
    phase = st.phase;
    console.log('  phase ->', phase, st.loginHint || st.notice || '');
  }
  if (phase === 'WAIT_LOGIN') break;
  if (phase === 'STOPPED') break;
  await sleep(1500);
}

const okLogin = phase === 'WAIT_LOGIN';
console.log(okLogin ? 'PASS 已进入等待登录（Chrome 已由 worker 拉起）' : 'FAIL 没到 WAIT_LOGIN，最后 phase=' + phase);

// 截图界面
const br = await chromium.launch({ headless: true, channel: 'chrome' });
const pg = await br.newPage({ viewport: { width: 1440, height: 900 } });
await pg.goto(url, { waitUntil: 'networkidle' });
await sleep(1200);
await pg.screenshot({ path: 'docs/ui-wait-login.png', fullPage: true });
const txt = await pg.locator('.wrap').innerText();
console.log(txt.includes('等待登录') || txt.includes('扫码') ? 'PASS 界面显示登录提示' : 'WARN 界面没显示登录提示');
await br.close();

console.log('退出…');
await api('/api/control', { action: 'quit' });
await sleep(4000);
const st2 = await api('/api/state');
console.log(st2.phase === 'STOPPED' ? 'PASS 退出后 phase=STOPPED' : 'FAIL 退出后 phase=' + st2.phase);
p.kill();
setTimeout(() => process.exit(0), 500);
