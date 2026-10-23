/** 更新检查：electron-updater（只对带 latest.yml 的安装包有效，免安装形态下直接禁用）。
 * 注意：0.1.0 之后只交付免安装版（Portable exe / 解压即用 zip），electron-builder 的 portable 目标
 * 不写 update info，electron-updater 也就无法自更新 —— 所以免安装形态下直接禁用并提示「下载新版覆盖」。
 * 没配置更新源时保持禁用，不影响本地使用；配置方式有两种：
 *  1) 打包时带 resources/update.json（{"url":"https://你的静态服务器/updates/"}）
 *  2) 启动前设置环境变量 ZHS_UPDATE_URL
 */
import { app } from './electron-api.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// electron-updater 也是 CJS，命名导入在 ESM 里拿不到
const { autoUpdater } = createRequire(import.meta.url)('electron-updater');

let log = null;
let configured = false;
let downloaded = false;
let last = { ok: false, state: 'disabled', message: '未配置更新源' };
let waiters = [];

function settle(patch) {
  last = { ...last, ...patch };
  const ws = waiters;
  waiters = [];
  for (const w of ws) w(last);
}

function readFeedUrl() {
  if (process.env.ZHS_UPDATE_URL) return String(process.env.ZHS_UPDATE_URL);
  try {
    const f = path.join(process.resourcesPath, 'update.json');
    if (fs.existsSync(f)) {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (j && typeof j.url === 'string') return j.url;
    }
  } catch {}
  return '';
}

export function initUpdater(appLog, opts = {}) {
  log = appLog;
  if (!app.isPackaged) {
    last = { ok: false, state: 'disabled', message: '开发模式不检查更新' };
    return;
  }
  // 免安装版没有安装器可以接管更新，覆盖安装包即可
  if (opts.isPortable) {
    last = {
      ok: false,
      state: 'disabled',
      message: '免安装版不支持自动更新：下载新版后解压覆盖即可（data/ 目录不会被覆盖）',
    };
    return;
  }
  const url = readFeedUrl();
  if (!/^https?:\/\//.test(url)) {
    last = { ok: false, state: 'disabled', message: '当前版本没有配置更新源，需要更新请重新下载安装包' };
    return;
  }
  try {
    autoUpdater.setFeedURL({ provider: 'generic', url });
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.logger = log;
    autoUpdater.on('checking-for-update', () => settle({ ok: true, state: 'checking', message: '正在检查更新…' }));
    autoUpdater.on('update-available', (info) =>
      settle({
        ok: true,
        state: 'available',
        version: info && info.version,
        message: '发现新版本 ' + (info && info.version),
        canInstall: false,
      })
    );
    autoUpdater.on('update-not-available', () =>
      settle({ ok: true, state: 'none', message: '已经是最新版本', canInstall: false })
    );
    autoUpdater.on('download-progress', (p) =>
      settle({
        ok: true,
        state: 'downloading',
        percent: Math.round((p && p.percent) || 0),
        message: '正在下载更新 ' + Math.round((p && p.percent) || 0) + '%',
        canInstall: false,
      })
    );
    autoUpdater.on('update-downloaded', (info) => {
      downloaded = true;
      settle({
        ok: true,
        state: 'ready',
        version: info && info.version,
        message: '更新已下载，重启后生效',
        canInstall: true,
      });
    });
    autoUpdater.on('error', (e) => {
      log.error('[updater] ' + ((e && e.message) || e));
      settle({ ok: false, state: 'error', message: '检查更新失败，请稍后再试', canInstall: false });
    });
    configured = true;
    last = { ok: true, state: 'idle', message: '可以检查更新' };
  } catch (e) {
    log.error('[updater] 初始化失败：' + ((e && e.message) || e));
    last = { ok: false, state: 'error', message: '更新功能没初始化成功' };
  }
}

export async function checkForUpdates() {
  if (!configured) return last;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      settle({ ok: false, state: 'error', message: '检查更新超时，请稍后再试' });
      resolve();
    }, 25000);
    waiters.push((r) => {
      clearTimeout(timer);
      resolve(r);
    });
    autoUpdater.checkForUpdates().catch((e) => {
      log.error('[updater] 检查失败：' + ((e && e.message) || e));
      settle({ ok: false, state: 'error', message: '检查更新失败，请稍后再试' });
    });
  });
  return last;
}

export async function installUpdate() {
  if (!configured) return { ok: false, message: '更新功能未启用' };
  if (downloaded) {
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (e) {
      return { ok: false, message: '启动更新失败，请手动重装' };
    }
    return { ok: true, state: 'installing' };
  }
  try {
    settle({ ok: true, state: 'downloading', percent: 0, message: '正在下载更新…', canInstall: false });
    autoUpdater
      .downloadUpdate()
      .catch((e) => settle({ ok: false, state: 'error', message: '下载更新失败，请稍后再试' }));
    return { ok: true, state: 'downloading' };
  } catch (e) {
    return { ok: false, state: 'error', message: '下载更新失败，请稍后再试' };
  }
}

export function updaterState() {
  return last;
}
