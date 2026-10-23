/**
 * Electron 主进程：托盘 + 应用窗口 + 本地服务子进程 + 日志/更新/IPC。
 * 原则：任何异常都不弹原始堆栈，写日志 + 给用户一句能看懂的话；
 * 子进程用 ELECTRON_RUN_AS_NODE 跑，用户不需要自己装 Node。
 */
import { app, BrowserWindow, ipcMain, Menu, shell } from './electron-api.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolvePaths } from './paths.mjs';
import { modeLabel } from './paths-plan.mjs';
import { spawn } from 'node:child_process';
import { initLogging, exportLogs } from './logging.mjs';
import { startServer, stopServer } from './server-process.mjs';
import { initUpdater, checkForUpdates, installUpdate } from './updater.mjs';
import { createTray, trayIconPath } from './tray.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, 'assets');
const HIDDEN_START = process.argv.includes('--hidden');

let log = null;
let paths = null;
let win = null;
let trayApi = null;
let server = null;
let serverStarted = false;
let quitting = false;
let booting = null;

// 注意：这台机器上任何读取/隐式创建 userData 的调用（含 requestSingleInstanceLock）
// 在 setPath('userData') 之前都会让主进程静默死掉，所以先算路径、先 setPath，再抢单实例锁。
let earlyPaths = null;
try {
  earlyPaths = resolvePaths();
  app.setPath('userData', earlyPaths.electronDataDir);
} catch {}
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  bootstrap();
}

function bootstrap() {
  try {
    paths = earlyPaths || resolvePaths();
    app.setPath('userData', paths.electronDataDir);
    app.setAppUserModelId('com.zhihuishu.auto');
    log = initLogging(paths.logDir);
    log.info('应用启动 v' + app.getVersion() + '（' + modeLabel(paths.mode) + '）');
    log.info('启动程序：' + paths.launchExe);
    log.info('数据目录：' + paths.dataDir);
    if (paths.mode === 'temp-exe') {
      log.warn(
        '程序是从临时目录运行的（' +
          paths.exeDir +
          '），退出后会被清理，所以数据放到了 ' +
          paths.dataDir +
          '；建议解压到固定目录再运行'
      );
    }
  } catch (e) {
    console.error('初始化失败', e);
  }
  process.on('uncaughtException', (e) => safeLog('error', '未捕获异常：' + ((e && e.stack) || e)));
  process.on('unhandledRejection', (e) => safeLog('error', '未处理拒绝：' + ((e && e.stack) || e)));
  app.on('window-all-closed', () => {
    /* 留在托盘里，不退出 */
  });
  app.on('before-quit', () => {
    quitting = true;
    stopLocalServer();
    try {
      if (trayApi) trayApi.tray.destroy();
    } catch {}
  });
  app.on('activate', () => showWindow());
  app
    .whenReady()
    .then(onReady)
    .catch((e) => {
      safeLog('error', '启动失败：' + ((e && e.stack) || e));
      showError(friendly(e));
    });
}

function safeLog(level, msg) {
  try {
    if (log && typeof log[level] === 'function') log[level](msg);
    else console.error(msg);
  } catch {}
}

function friendly(e) {
  const s = String((e && e.message) || e || '未知错误');
  if (/ENOENT|no such file/i.test(s)) return '缺少必要的文件，可能是程序不完整，建议重新解压一份';
  if (/EACCES|EPERM|denied/i.test(s)) return '没有权限访问程序目录，请把程序装在你有写权限的位置';
  if (/timeout|超时/i.test(s)) return '启动太慢了，请重试一次';
  return '启动时遇到一点问题，已经记录到日志';
}

/* ---------------- 窗口 ---------------- */
const SPLASH =
  'data:text/html;charset=utf-8,' +
  encodeURIComponent(
    '<!doctype html><html><head><meta charset="utf-8"><style>' +
      'html,body{height:100%;margin:0;background:#0f1117;color:#e8eefc;font:14px/1.6 "Microsoft YaHei UI",sans-serif}' +
      '.b{height:100%;display:grid;place-items:center}.c{text-align:center}' +
      '.l{width:44px;height:44px;margin:0 auto 16px;border-radius:12px;background:linear-gradient(135deg,#3b82f6,#22c55e);box-shadow:0 10px 30px rgba(59,130,246,.35)}' +
      '.s{margin-top:8px;color:#8ea3c8;font-size:13px}</style></head><body><div class="b"><div class="c">' +
      '<div class="l"></div><div>智慧树自动听课</div><div class="s" id="s">正在启动本地服务…</div>' +
      '</div></div></body></html>'
  );

function windowStateFile() {
  return path.join(paths.dataDir, 'window.json');
}

function loadBounds() {
  try {
    const j = JSON.parse(fs.readFileSync(windowStateFile(), 'utf8'));
    if (j && Number.isFinite(j.width) && Number.isFinite(j.height)) return j;
  } catch {}
  return { width: 1440, height: 900 };
}

function saveBounds() {
  if (!win || win.isDestroyed()) return;
  try {
    const b = win.getBounds();
    fs.writeFileSync(
      windowStateFile(),
      JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() })
    );
  } catch {}
}

function createWindow() {
  const bounds = loadBounds();
  win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    backgroundColor: '#0f1117',
    title: '智慧树自动听课',
    autoHideMenuBar: true,
    icon: path.join(ASSETS, 'icon.ico'),
    webPreferences: {
      preload: path.join(HERE, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      additionalArguments: ['--zhs-version=' + app.getVersion()],
    },
  });
  Menu.setApplicationMenu(null);
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    saveBounds();
    win.hide();
  });
  win.on('resize', debounce(saveBounds, 600));
  win.on('move', debounce(saveBounds, 600));
  win.webContents.on('render-process-gone', (_e, d) => safeLog('error', '界面进程异常退出：' + JSON.stringify(d)));
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    if (/^https?:\/\/127\.0\.0\.1/.test(url || '')) showError('本地页面加载失败（' + desc + '）');
  });
  win.loadURL(SPLASH).catch(() => {});
  win.once('ready-to-show', () => {
    if (!HIDDEN_START) win.show();
  });
  return win;
}

function showSplash(text) {
  if (!win || win.isDestroyed()) return;
  const html = SPLASH.replace('正在启动本地服务…', text || '正在启动…');
  win.loadURL(html).catch(() => {});
  win.show();
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function showError(msg) {
  safeLog('error', '显示错误页：' + msg);
  if (!win || win.isDestroyed()) return;
  const file = path.join(HERE, 'error.html');
  win.loadFile(file, { query: { msg: String(msg || '').slice(0, 300) } }).catch(() => {});
  win.show();
}

/* ---------------- 本地服务 ---------------- */
function stopLocalServer() {
  if (server) {
    try {
      stopServer({ child: server.child, log });
    } catch {}
    server = null;
    serverStarted = false;
  }
}

async function bootServer() {
  if (booting) return booting;
  booting = (async () => {
    stopLocalServer();
    showSplash('正在启动本地服务…');
    const s = await startServer({ paths, log, appVersion: app.getVersion() });
    server = s;
    serverStarted = true;
    s.child.on('exit', (code) => {
      if (quitting || !server || server.child !== s.child) return;
      server = null;
      serverStarted = false;
      if (code === 0) return;
      showError('本地服务意外退出（code=' + code + '），点「重试」重新启动');
    });
    return s;
  })();
  try {
    return await booting;
  } finally {
    booting = null;
  }
}

async function loadApp() {
  if (!win || win.isDestroyed()) return;
  if (!serverStarted) return;
  await win.loadURL(server.url);
  win.show();
  win.focus();
}

async function onReady() {
  initUpdater(log, { isPortable: paths.isPortable, mode: paths.mode });
  createWindow();
  setupTray();
  try {
    await bootServer();
    await loadApp();
  } catch (e) {
    safeLog('error', '本地服务启动失败：' + ((e && e.stack) || e));
    showError(friendly(e));
  }
}

function setupTray() {
  try {
    trayApi = createTray({
      iconPath: trayIconPath(ASSETS),
      log,
      onOpen: showWindow,
      onQuit: quitApp,
      getAutoStart: () => isAutoStart(),
      setAutoStart: (v) => applyAutoStart(v),
    });
  } catch (e) {
    safeLog('error', '托盘创建失败：' + ((e && e.message) || e));
  }
}

/* ---------------- 开机自启 / 退出 ---------------- */
/** 开机自启要注册的 exe：单文件免安装版不能用 %TEMP% 里的 process.execPath（重启后就没了） */
function autoStartPath() {
  return (paths && paths.launchExe) || process.execPath;
}

function isAutoStart() {
  try {
    if (app.isPackaged) return !!app.getLoginItemSettings({ path: autoStartPath() }).openAtLogin;
  } catch {}
  return false;
}

function applyAutoStart(enabled) {
  const want = !!enabled;
  if (!app.isPackaged) return { ok: true, enabled: want, note: '开发模式不写开机自启' };
  const exe = autoStartPath();
  try {
    app.setLoginItemSettings({ openAtLogin: want, path: exe, args: ['--hidden'] });
    const now = !!app.getLoginItemSettings({ path: exe }).openAtLogin;
    safeLog('info', '开机自启：' + (now ? '已开启' : '已关闭'));
    return { ok: true, enabled: now };
  } catch (e) {
    safeLog('error', '设置开机自启失败：' + ((e && e.message) || e));
    return { ok: false, message: '设置开机自启失败，可以稍后再试' };
  }
}

function quitApp() {
  quitting = true;
  try {
    app.quit();
  } catch {
    process.exit(0);
  }
}

/** 单文件免安装版：启动器要等本进程退出后才清理 %TEMP%，所以延迟几秒再拉起原始 exe */
function relaunchAfterExit(exe) {
  try {
    const cmd = 'ping -n 5 127.0.0.1 >nul & start "" "' + exe + '"';
    const cp = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', cmd], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
    cp.unref();
  } catch (e) {
    safeLog('error', '延迟重启失败：' + ((e && e.message) || e));
  }
}

function restartApp() {
  try {
    stopLocalServer();
  } catch {}
  quitting = true;
  const exe = (paths && paths.launchExe) || process.execPath;
  const args = process.argv.slice(1).filter((a) => a !== '--hidden');
  if (paths && paths.mode === 'portable-file') {
    relaunchAfterExit(exe);
  } else {
    try {
      app.relaunch({ execPath: exe, args });
    } catch {}
  }
  setTimeout(() => {
    try {
      app.exit(0);
    } catch {}
  }, 400);
}

/* ---------------- IPC ---------------- */
function ok(data) {
  return { ok: true, ...(data || {}) };
}
function bad(message) {
  return { ok: false, message };
}
function guard(fn, fallback) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      safeLog('error', 'IPC 失败：' + ((e && e.stack) || e));
      return bad(fallback || '操作没成功，请稍后再试');
    }
  };
}

function underData(p) {
  try {
    const abs = path.resolve(String(p || ''));
    return abs.startsWith(path.resolve(paths.dataDir) + path.sep) || abs === path.resolve(paths.dataDir);
  } catch {
    return false;
  }
}

function shortReason(s) {
  const t = String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > 80 ? t.slice(0, 80) + '…' : t;
}

ipcMain.handle(
  'desktop:openDataDir',
  guard(async () => {
    try {
      fs.mkdirSync(paths.dataDir, { recursive: true });
    } catch (e) {
      safeLog('error', '创建数据目录失败：' + ((e && e.message) || e));
    }
    const err = await shell.openPath(paths.dataDir);
    if (err) {
      safeLog('warn', '打开数据目录失败：' + err);
      return bad('打不开数据目录：' + shortReason(err));
    }
    safeLog('info', '打开数据目录：' + paths.dataDir);
    return ok({ path: paths.dataDir });
  })
);

// 打开「数据目录里的某个位置」：目录 → 资源管理器打开；文件 → 在资源管理器里选中它。
// 之前一律 shell.openPath，导出日志后会被压缩软件接管，看着不像「打开文件管理器」。
ipcMain.handle(
  'desktop:openPath',
  guard(async (_e, p) => {
    const abs = path.resolve(String(p || ''));
    if (!underData(abs)) return bad('只能打开本程序数据目录里的位置');
    if (!fs.existsSync(abs)) return bad('这个位置已经不在了，可能被移动或删除了');
    let isDir = false;
    try {
      isDir = fs.statSync(abs).isDirectory();
    } catch {}
    if (isDir) {
      const err = await shell.openPath(abs);
      if (err) {
        safeLog('warn', '打开目录失败：' + err);
        return bad('打不开这个目录：' + shortReason(err));
      }
      return ok({ path: abs });
    }
    shell.showItemInFolder(abs);
    safeLog('info', '在资源管理器中定位：' + abs);
    return ok({ path: abs, revealed: true });
  })
);

ipcMain.handle(
  'desktop:exportLogs',
  guard(async () => {
    const out = exportLogs({
      logDir: paths.logDir,
      dataDir: paths.dataDir,
      appInfo: {
        version: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        platform:
          process.platform + ' ' + process.arch + ' ' + (process.getSystemVersion ? process.getSystemVersion() : ''),
        packaged: app.isPackaged,
        runtime: modeLabel(paths.mode),
        launchExe: paths.launchExe,
      },
    });
    safeLog('info', '日志已导出：' + out.path);
    return ok(out);
  })
);

ipcMain.handle(
  'desktop:checkUpdate',
  guard(async () => checkForUpdates(), '检查更新失败，请稍后再试')
);
ipcMain.handle(
  'desktop:installUpdate',
  guard(async () => installUpdate(), '安装更新失败，请稍后再试')
);

ipcMain.handle(
  'desktop:restartApp',
  guard(async () => {
    setTimeout(restartApp, 120);
    return ok();
  })
);

ipcMain.handle(
  'desktop:quitApp',
  guard(async () => {
    setTimeout(quitApp, 120);
    return ok();
  })
);

ipcMain.handle(
  'desktop:retryServer',
  guard(async () => {
    try {
      await bootServer();
      await loadApp();
      return ok();
    } catch (e) {
      showError(friendly(e));
      return bad('还是没起来：' + friendly(e));
    }
  }, '重试没成功')
);

ipcMain.handle(
  'desktop:getAutoStart',
  guard(async () => ok({ enabled: isAutoStart() }))
);
ipcMain.handle(
  'desktop:setAutoStart',
  guard(async (_e, v) => {
    const r = applyAutoStart(v);
    if (!r.ok) return r;
    if (trayApi) trayApi.rebuild();
    return ok({ enabled: r.enabled, note: r.note });
  })
);

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
