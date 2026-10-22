import fs from 'node:fs';
import { chromium } from 'playwright';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 8739;
let url = '';
for (let i = 0; i < 40; i++) {
  try {
    const u = fs.readFileSync('data/server.url', 'utf8').trim();
    if (u.includes(':' + PORT + '/')) { url = u; break; }
  } catch {}
  await sleep(500);
}
if (!url) throw new Error('mock 服务没起来（没拿到 server.url）');
const token = new URL(url).searchParams.get('t');
const call = async (p, body) => (await fetch('http://127.0.0.1:' + PORT + p + '?t=' + token, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })).json();

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(url);
await page.waitForSelector('.nextq', { timeout: 15000 });
await sleep(1200);

const h1 = await page.evaluate(() => document.documentElement.scrollHeight);
const nextq1 = (await page.locator('.nextq').innerText()).replace(/\n/g, ' | ');
console.log('A. 下一题面板:', nextq1);
console.log('A. 文档高度:', h1);

// 触发一条提示（mock 人机验证）
await call('/api/control', { action: 'verify' });
await sleep(1200);
const visible = await page.locator('.hintwrap .hintbar').isVisible();
const h2 = await page.evaluate(() => document.documentElement.scrollHeight);
const box = await page.locator('.hintbar').boundingBox();
const pos = await page.locator('.hintbar').evaluate((el) => getComputedStyle(el.parentElement).position);
console.log('B. 提示条可见:', visible, '| 定位方式:', pos, '| 文档高度:', h2, '| 高度未变:', h1 === h2);
console.log('B. 提示条位置:', JSON.stringify(box));
const txtB = (await page.locator('.hintbar').innerText()).replace(/\n/g, ' | ');
console.log('B. 提示内容:', txtB.slice(0, 90));
await page.screenshot({ path: 'docs/ui-hint.png', fullPage: false });

// 关闭按钮
await page.locator('.hint-x').click();
await sleep(500);
const afterClose = await page.locator('.hintwrap .hintbar').count();
console.log('C. 点×后提示条数量:', afterClose, '(应为 0)');

// 切到另一节 → 下一题应立即变成新视频的弹题点
await call('/api/control', { action: 'unverify' });
await sleep(600);
await call('/api/lesson', { code: '2.1' });
await sleep(1500);
const nextq2 = (await page.locator('.nextq').innerText()).replace(/\n/g, ' | ');
console.log('D. 切到 2.1 后的下一题:', nextq2, '(应为 677s*33%≈223s 附近，而不是旧视频)');
await page.screenshot({ path: 'docs/ui-nextq.png', fullPage: false });

// 切到没有弹题点的一节（mock 都带点，这里改测验「读取中/没有更多」文案）
console.log('E. 页面报错:', errs.length ? errs : '无');
await browser.close();
