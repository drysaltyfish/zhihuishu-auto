/** 日志环：最近 N 条给界面看，同时落一份文件方便回看 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * 打包版（Electron 主进程通过 ZHS_LOG_DIR 指定目录）用 electron-log 写 server.log，
 * 享受成熟的轮转/格式化；开发态没有 ZHS_LOG_DIR，还是写 data/runtime.log。
 */
let fileLog = null;
if (process.env.ZHS_LOG_DIR) {
  try {
    const { default: log } = await import('electron-log/node');
    const dir = path.resolve(process.env.ZHS_LOG_DIR);
    fs.mkdirSync(dir, { recursive: true });
    log.transports.file.resolvePathFn = () => path.join(dir, 'server.log');
    log.transports.file.maxSize = 5 * 1024 * 1024;
    log.transports.file.level = 'info';
    log.transports.console.level = false;
    fileLog = log;
  } catch {
    fileLog = null;
  }
}

const LEVELS = { err: 'error', warn: 'warn', ok: 'info', info: 'info', debug: 'debug' };

export function createLogRing({ dataDir, max = 300, fileMax = 2 * 1024 * 1024, onChange } = {}) {
  const rows = [];

  function push(kind, msg) {
    const line = {
      time: new Date().toTimeString().slice(0, 8),
      kind: kind || 'info',
      msg: String(msg == null ? '' : msg).slice(0, 400),
    };
    rows.push(line);
    if (rows.length > max) rows.shift();
    if (fileLog) {
      try {
        const level = LEVELS[line.kind] || 'info';
        fileLog[level]('[' + line.kind + '] ' + line.msg);
      } catch {}
    } else if (dataDir) {
      try {
        const p = path.join(dataDir, 'runtime.log');
        if (fs.existsSync(p) && fs.statSync(p).size > fileMax) fs.writeFileSync(p, '');
        fs.appendFileSync(p, line.time + ' ' + line.kind + ' ' + line.msg + '\n');
      } catch {}
    }
    if (onChange) onChange();
    return line;
  }

  return {
    push,
    list: () => rows,
    get size() {
      return rows.length;
    },
    get fileLog() {
      return fileLog;
    },
  };
}
