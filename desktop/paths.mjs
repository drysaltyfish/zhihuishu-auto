/** 路径解析：按运行形态决定数据目录（免安装版放 exe 旁边，单文件版放启动器所在目录） */
import { app } from './electron-api.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planRuntime } from './paths-plan.mjs';

function ensureWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.write-test');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function appDataFallback() {
  // 注意：这台机器上 app.getPath('userData') 在 setPath 之前调用会让主进程直接死掉，
  // 所以兜底目录用 appData 自己拼，绝不调用 getPath('userData')。
  try {
    return app.getPath('appData');
  } catch {
    return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  }
}

function tmpRoots() {
  const list = [];
  try {
    list.push(os.tmpdir());
  } catch {}
  for (const k of ['TEMP', 'TMP', 'TMPDIR']) {
    if (process.env[k]) list.push(process.env[k]);
  }
  return list.filter(Boolean);
}

function installRoots() {
  const list = [];
  if (process.env.LOCALAPPDATA) list.push(path.join(process.env.LOCALAPPDATA, 'Programs'));
  if (process.env.ProgramFiles) list.push(process.env.ProgramFiles);
  if (process.env['ProgramFiles(x86)']) list.push(process.env['ProgramFiles(x86)']);
  list.push('C:\\Program Files', 'C:\\Program Files (x86)');
  return list;
}

export function resolvePaths() {
  const appRoot = app.getAppPath();
  const exePath = process.execPath;
  const exeDir = path.dirname(exePath);

  const plan = planRuntime({
    packaged: app.isPackaged,
    appRoot,
    exeDir,
    exePath,
    appDataDir: appDataFallback(),
    envData: process.env.ZHS_DATA,
    portableDir: process.env.PORTABLE_EXECUTABLE_DIR,
    portableFile: process.env.PORTABLE_EXECUTABLE_FILE,
    tmpRoots: tmpRoots(),
    installRoots: installRoots(),
  });

  let dataDir = plan.fallbackDataDir;
  for (const c of plan.dataCandidates) {
    if (ensureWritable(c.dir)) {
      dataDir = c.dir;
      break;
    }
  }
  const logDir = path.join(dataDir, 'logs');
  const electronDataDir = path.join(dataDir, 'electron');
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(electronDataDir, { recursive: true });

  const browsersDir = app.isPackaged ? path.join(process.resourcesPath, 'browsers') : path.join(appRoot, 'browsers');

  return {
    appRoot,
    exeDir,
    exePath,
    dataDir,
    logDir,
    electronDataDir,
    browsersDir,
    resourcesDir: process.resourcesPath,
    ...plan,
  };
}
