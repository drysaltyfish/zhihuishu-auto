/** HTTP 小工具：JSON 响应、带用户提示的错误、请求体解析、静态文件 */
import fs from 'node:fs';
import path from 'node:path';

export const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

/**
 * 能直接给前端看的错误。router 只把这个对象的 message/hint 透出去，
 * 其它异常一律记日志 + 通用提示（不把堆栈丢给用户）。
 */
export function httpError(status, message, hint) {
  const e = new Error(message);
  e.status = status;
  e.hint = hint || '';
  e.expose = true;
  return e;
}

export function json(res, status, body) {
  if (res.writableEnded) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function fail(res, status, message, hint) {
  json(res, status, { code: status, message, hint: hint || '' });
}

/** 读请求体；坏 JSON 当空对象（老行为，接口自己校验字段） */
export function readJson(req, limit = 1e6) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > limit) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

/** 静态文件托管：越界路径一律当成不存在 */
export function serveStatic(res, publicDir, pathname) {
  const missing = () => httpError(404, '页面不存在', '请先执行 npm run web:build 生成前端');
  const rel = pathname === '/' ? '/index.html' : pathname;
  const safe = path.normalize(rel).replace(/^(\.\.[\/\\])+/, '');
  const fp = path.join(publicDir, safe);
  if (!fp.startsWith(publicDir)) throw missing();
  let st = null;
  try { st = fs.statSync(fp); } catch { throw missing(); }
  if (st.isDirectory()) throw missing();
  res.writeHead(200, {
    'content-type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  fs.createReadStream(fp).pipe(res);
}
