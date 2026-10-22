import fs from 'node:fs';
import { chromium } from 'playwright';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 8739;
let url = '';
for (let i = 0; i < 40; i++) {
  try { const u = fs.readFileSync('data/server.url', 'utf8').trim(); if (u.includes(':' + PORT + '/')) { url = u; break; } } catch {}
  await sleep(500);
}
const token = new URL(url).searchParams.get('t');
const call = async (p, body) => (await fetch('http://127.0.0.1:' + PORT + p + '?t=' + token, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })).json();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
await page.goto(url);
await page.waitForSelector('.grid', { timeout: 15000 });
await sleep(1200);
const geom = async () => page.evaluate(() => {
  const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  return { grid: r('.grid'), course: r('.card.course'), nextq: r('.nextq'), foot: r('.foot'), top: r('.top') };
});
const g1 = await geom();
await call('/api/control', { action: 'verify' });
await sleep(1000);
const g2 = await geom();
const same = JSON.stringify(g1) === JSON.stringify(g2);
console.log('布局坐标 前:', JSON.stringify(g1));
console.log('布局坐标 后:', JSON.stringify(g2));
console.log('元素是否纹丝不动（无重排）:', same);
const bannerBox = await page.locator('.hintbar').boundingBox();
const vp = page.viewportSize();
console.log('提示条是否贴在视口内（不滚动就看得见）:', bannerBox.y + bannerBox.height <= vp.height, JSON.stringify(bannerBox));
await page.screenshot({ path: 'docs/ui-hint.png' });
await browser.close();
