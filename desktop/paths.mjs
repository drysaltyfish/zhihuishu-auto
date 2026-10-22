/** 路径解析：安装版把数据放在安装目录 data/（不碰安装目录外），开发版放在仓库 data/ */
import { app } from './electron-api.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

export function resolvePaths() {
  const appRoot = app.getAppPath();
  const exeDir = path.dirname(process.execPath);
  // 注意：这台机器上 app.getPath('userData') 在 setPath 之前调用会让主进程直接死掉，
  // 所以兜底目录用 appData 自己拼，绝不调用 getPath('userData')。
  let appDataDir;
  try {
    appDataDir = app.getPath('appData');
  } catch {
    appDataDir = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  }
  const candidates = [];
  if (process.env.ZHS_DATA) candidates.push(path.resolve(process.env.ZHS_DATA));
  if (app.isPackaged) candidates.push(path.join(exeDir, 'data'));
  else candidates.push(path.join(appRoot, 'data'));
  candidates.push(path.join(appDataDir, 'ZhihuishuAuto', 'data'));

  let dataDir = candidates[candidates.length - 1];
  for (const c of candidates) {
    if (ensureWritable(c)) {
      dataDir = c;
      break;
    }
  }
  const logDir = path.join(dataDir, 'logs');
  const electronDataDir = path.join(dataDir, 'electron');
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(electronDataDir, { recursive: true });

  const browsersDir = app.isPackaged ? path.join(process.resourcesPath, 'browsers') : path.join(appRoot, 'browsers');

  return { appRoot, exeDir, dataDir, logDir, electronDataDir, browsersDir, resourcesDir: process.resourcesPath };
}
