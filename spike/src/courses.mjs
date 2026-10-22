import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DATA = path.join(ROOT, 'data');
const OUT = path.join(DATA, 'debug');
fs.mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

const PROFILE = process.argv.includes('--profile') ? process.argv[process.argv.indexOf('--profile') + 1] : path.join(DATA, 'profile');
console.log('profile:', PROFILE);
const ctx = await chromium.launchPersistentContext(path.resolve(PROFILE), {
  channel: 'chrome',
  headless: false,
  viewport: null,
  ignoreDefaultArgs: ['--enable-automation', '--no-startup-window'],
  args: [
    '--disable-blink-features=AutomationControlled',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
    '--no-first-run',
    '--window-size=1280,860',
  ],
});
const page = ctx.pages()[0] || await ctx.newPage();
let resume = '';
try { resume = JSON.parse(fs.readFileSync(path.join(DATA, 'state.json'), 'utf8')).resumeUrl || ''; } catch {}
if (!resume) resume = 'https://www.zhihuishu.com/';
console.log('goto resume:', resume);
await page.goto(resume, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto err', e.message));
await page.waitForTimeout(8000);
console.log('url after resume:', page.url());
// 找「返回学堂」链接
const back = await page.evaluate(() => {
  for (const a of document.querySelectorAll('a[href]')) {
    const t = (a.innerText || '').trim();
    if (/返回学堂|学堂|我的课程|学习空间/.test(t)) return { href: a.href, text: t.slice(0, 40) };
  }
  return null;
});
console.log('back link:', JSON.stringify(back));
if (back && back.href) {
  await page.goto(back.href, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('goto2 err', e.message));
  await page.waitForTimeout(9000);
  console.log('url after back:', page.url());
}

// 1) 页面上的课程入口链接
const links = await page.evaluate(() => {
  const out = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.href || '';
    if (/stuStudy|recruitAndCourseId|course/i.test(href)) out.push({ href, text: (a.innerText || '').trim().slice(0, 60) });
  }
  return out.slice(0, 80);
});
// 2) 看起来像课程卡片的元素
const cards = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('[class*="course" i], [class*="card" i], li, .item')) {
    const t = (el.innerText || '').trim();
    if (!t || t.length > 200) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 80 || r.height < 40) continue;
    out.push({ cls: el.className && String(el.className).slice(0, 90), tag: el.tagName, text: t.slice(0, 120) });
  }
  return out.slice(0, 60);
});
// 3) 网络请求里带 course 的接口
const res = await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name).filter(u => /course|recruit|study|learn/i.test(u)).slice(0, 120));
// 4) storage
const storage = await page.evaluate(() => {
  const dump = (s) => { const o = {}; for (let i = 0; i < s.length; i++) { const k = s.key(i); const v = s.getItem(k); if (/course|recruit|user|study/i.test(k) && v && v.length < 4000) o[k] = v.slice(0, 2000); } return o; };
  return { local: dump(localStorage), session: dump(sessionStorage) };
});
// 5) 原始 HTML
const html = await page.content();
fs.writeFileSync(path.join(OUT, 'learnhome-' + stamp + '.html'), html, 'utf8');
const report = { url: page.url(), links, cards, res, storage };
fs.writeFileSync(path.join(OUT, 'learnhome-' + stamp + '.json'), JSON.stringify(report, null, 2), 'utf8');
console.log('links', links.length, 'cards', cards.length, 'res', res.length);
console.log(JSON.stringify({ links: links.slice(0, 20), res: res.slice(0, 40) }, null, 1).slice(0, 4000));
await ctx.close();
