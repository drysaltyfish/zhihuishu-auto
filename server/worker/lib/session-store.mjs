/**
 * 登录态（Cookie）落盘与恢复。
 *
 * 为什么需要：智慧树的登录 Cookie（CASLOGC / CASTGC / jt-cas …）都是
 * **会话 Cookie（persistent=0）**，Chrome 一关就丢；而 Chrome 默认不恢复会话，
 * 所以每次重启 worker 都要重新扫码登录。这里在登录成功后把 zhihuishu 域下的
 * Cookie 存到 data/auth-cookies.json，下次启动先 addCookies 注入，就不用再扫码。
 *
 * 敏感信息：文件里是明文 Cookie（等同登录凭证），只放在 data/ 下，data/ 已被
 * .gitignore 排除，不要外传、不要提交。
 */
import fs from 'node:fs';
import path from 'node:path';

const DAY = 86400;
/** 会话 Cookie 的默认续期（服务器端会话过期后照样需要重新登录） */
export const KEEP_DAYS = 7;
const DOMAIN_KEY = 'zhihuishu.com';

export function cookiesPath(dataDir) {
  return path.join(dataDir, 'auth-cookies.json');
}

/**
 * 从 Playwright 的 ctx.cookies() 结果里挑出要保存的 Cookie。
 * - 只留智慧树域（不把别的站点的凭证写进来）
 * - 会话 Cookie 补一个 7 天后的 expires，这样即使不依赖本文件，Chrome 也会持久化
 * @param {Array<object>} cookies
 * @param {number} nowSec 当前时间（秒），便于测试
 */
export function pickCookies(cookies, nowSec = Math.floor(Date.now() / 1000)) {
  const out = [];
  for (const c of cookies || []) {
    if (!c || !c.name || !c.value) continue;
    if (!String(c.domain || '').includes(DOMAIN_KEY)) continue;
    const one = {
      name: String(c.name),
      value: String(c.value),
      domain: String(c.domain),
      path: c.path || '/',
      expires: c.expires > 0 ? c.expires : nowSec + KEEP_DAYS * DAY,
      httpOnly: !!c.httpOnly,
      secure: !!c.secure,
    };
    if (c.sameSite) one.sameSite = c.sameSite;
    out.push(one);
  }
  return out;
}

/** 保存登录态，返回保存的条数（失败不抛，返回 0） */
export function saveCookies(dataDir, cookies) {
  try {
    const list = pickCookies(cookies);
    if (!list.length) return 0;
    const file = cookiesPath(dataDir);
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ savedAt: Date.now(), cookies: list }, null, 1));
    fs.renameSync(tmp, file);
    return list.length;
  } catch { return 0; }
}

/** 读出可用的登录态；过期的不返回（失败返回 []） */
export function loadCookies(dataDir, nowSec = Math.floor(Date.now() / 1000)) {
  try {
    const raw = JSON.parse(fs.readFileSync(cookiesPath(dataDir), 'utf8'));
    const list = Array.isArray(raw.cookies) ? raw.cookies : [];
    return list.filter((c) => c && c.name && c.value && (!c.expires || c.expires > nowSec + 60));
  } catch { return []; }
}
