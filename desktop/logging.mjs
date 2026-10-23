/** 日志：electron-log（成熟库）落盘 + 限制单文件大小 + 清理陈旧日志 + 导出 zip */
import log from 'electron-log/main';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';

const MAX_FILE = 5 * 1024 * 1024;
const MAX_TOTAL = 30 * 1024 * 1024;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export function cleanOldLogs(logDir) {
  let files;
  try {
    files = fs.readdirSync(logDir);
  } catch {
    return;
  }
  const now = Date.now();
  const kept = [];
  for (const name of files) {
    if (!/\.log(\.\d+)?$|\.old\.log$/.test(name)) continue;
    const fp = path.join(logDir, name);
    let st;
    try {
      st = fs.statSync(fp);
    } catch {
      continue;
    }
    if (now - st.mtimeMs > MAX_AGE_MS) {
      try {
        fs.unlinkSync(fp);
      } catch {}
      continue;
    }
    kept.push({ fp, size: st.size, mtime: st.mtimeMs });
  }
  let total = kept.reduce((n, f) => n + f.size, 0);
  kept.sort((a, b) => a.mtime - b.mtime);
  for (const f of kept) {
    if (total <= MAX_TOTAL) break;
    try {
      fs.unlinkSync(f.fp);
      total -= f.size;
    } catch {}
  }
}

export function initLogging(logDir) {
  fs.mkdirSync(logDir, { recursive: true });
  log.transports.file.resolvePathFn = () => path.join(logDir, 'main.log');
  log.transports.file.maxSize = MAX_FILE;
  log.transports.file.level = 'info';
  log.transports.file.format = '{y}-{m}-{d} {h}:{i}:{s}.{ms} [{level}] {text}';
  log.transports.console.level = 'info';
  log.transports.console.format = '{h}:{i}:{s} [{level}] {text}';
  try {
    log.errorHandler.startCatching({ showDialog: false });
  } catch {}
  cleanOldLogs(logDir);
  return log;
}

function redactConfig(dataDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
    if (raw && raw.llm && typeof raw.llm === 'object') {
      const k = String(raw.llm.apiKey || '');
      raw.llm.apiKey = k ? k.slice(0, 3) + '****' + k.slice(-4) : '';
    }
    return raw;
  } catch {
    return null;
  }
}

/** 把日志 + 环境信息（配置里的 Key 已脱敏）打成一个 zip，方便用户反馈问题 */
export function exportLogs({ logDir, dataDir, appInfo }) {
  const zip = new AdmZip();
  let count = 0;
  try {
    for (const name of fs.readdirSync(logDir)) {
      if (!/\.log(\.\d+)?$|\.old\.log$/.test(name)) continue;
      zip.addLocalFile(path.join(logDir, name), 'logs');
      count++;
    }
  } catch {}
  zip.addFile(
    'system.txt',
    Buffer.from(
      [
        '应用版本：' + (appInfo.version || ''),
        'Electron：' + (appInfo.electron || ''),
        'Chrome：' + (appInfo.chrome || ''),
        'Node：' + (appInfo.node || ''),
        '系统：' + (appInfo.platform || ''),
        '打包版：' + (appInfo.packaged ? '是' : '否'),
        '运行形态：' + (appInfo.runtime || '未知'),
        '启动程序：' + (appInfo.launchExe || ''),
        '数据目录：' + dataDir,
        '日志目录：' + logDir,
        '生成时间：' + new Date().toLocaleString('zh-CN', { hour12: false }),
        '',
      ].join('\r\n'),
      'utf8'
    )
  );
  const cfg = redactConfig(dataDir);
  if (cfg) zip.addFile('config（已隐藏 Key）.json', Buffer.from(JSON.stringify(cfg, null, 2), 'utf8'));
  try {
    const stateFile = path.join(dataDir, 'state.json');
    if (fs.existsSync(stateFile)) zip.addLocalFile(stateFile, '', 'state.json');
  } catch {}
  const exportDir = path.join(dataDir, 'exports');
  fs.mkdirSync(exportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = path.join(exportDir, 'zhihuishu-logs-' + stamp + '.zip');
  zip.writeZip(out);
  return { ok: true, path: out, logFiles: count };
}
