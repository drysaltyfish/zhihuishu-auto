/** 日志环：最近 N 条给界面看，同时落一份文件方便回看 */
import fs from 'node:fs';
import path from 'node:path';

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
    if (dataDir) {
      try {
        const p = path.join(dataDir, 'runtime.log');
        if (fs.existsSync(p) && fs.statSync(p).size > fileMax) fs.writeFileSync(p, '');
        fs.appendFileSync(p, line.time + ' ' + line.kind + ' ' + line.msg + '\n');
      } catch {}
    }
    if (onChange) onChange();
    return line;
  }

  return { push, list: () => rows, get size() { return rows.length; } };
}
