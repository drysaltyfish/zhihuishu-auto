/** 本地服务子进程：用打包进来的 Electron 当 Node 跑 server/index.mjs，不弹黑框 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

export async function startServer({ paths, log, appVersion }) {
  const port = await getFreePort();
  const entry = path.join(paths.appRoot, 'server', 'index.mjs');
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    ZHS_DATA: paths.dataDir,
    ZHS_LOG_DIR: paths.logDir,
    ZHS_APP_VERSION: appVersion,
    ZHS_DESKTOP: '1',
  };
  const fs = await import('node:fs');
  try {
    if (paths.browsersDir && fs.existsSync(paths.browsersDir)) {
      env.PLAYWRIGHT_BROWSERS_PATH = paths.browsersDir;
    }
  } catch {}
  // TEMP/TMP 必须真的可写：某些被限制的环境里系统 Temp 会 EPERM（Playwright 建临时目录会失败），
  // 这时退回到程序数据目录里的 data/tmp。
  try {
    const candidates = [env.TEMP, env.TMP].filter((c) => c && /^[a-zA-Z]:[\\/]/.test(c));
    candidates.push(path.join(paths.dataDir, 'tmp'));
    let tmp = null;
    for (const c of candidates) {
      try {
        fs.mkdirSync(c, { recursive: true });
        const probe = fs.mkdtempSync(path.join(c, 'zhs-probe-'));
        fs.rmdirSync(probe);
        tmp = c;
        break;
      } catch {}
    }
    if (tmp) {
      env.TEMP = tmp;
      env.TMP = tmp;
    }
  } catch {}

  const child = spawn(process.execPath, [entry, '--port', String(port)], {
    cwd: paths.appRoot,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  log.info('[server] 子进程已启动 pid=' + child.pid + ' port=' + port);

  let url = '';
  let stderrBuf = '';
  const waiter = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('本地服务启动超时（45 秒）')), 45000);
    child.stdout.on('data', (buf) => {
      const text = buf.toString('utf8');
      const m = text.match(/http:\/\/127\.0\.0\.1:\d+\/\?t=[a-f0-9]+/);
      if (m && !url) {
        url = m[0];
        clearTimeout(timer);
        resolve(url);
      }
    });
    child.stderr.on('data', (buf) => {
      const text = buf.toString('utf8');
      stderrBuf = (stderrBuf + text).slice(-4000);
      log.error('[server] ' + text.trim());
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (!url)
        reject(new Error('本地服务退出了（code=' + code + '）' + (stderrBuf ? '：' + stderrBuf.slice(-300) : '')));
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });

  try {
    await waiter;
  } catch (e) {
    stopServer({ child, log });
    throw e;
  }
  return { child, port, url };
}

export function stopServer({ child, log }) {
  if (!child || child.exitCode !== null) return;
  try {
    log.info('[server] 正在停止本地服务…');
  } catch {}
  try {
    child.kill('SIGTERM');
  } catch {}
  setTimeout(() => {
    if (child.exitCode !== null) return;
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } catch {}
  }, 5000);
}
