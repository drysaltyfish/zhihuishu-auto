import { chromium } from 'playwright';
import fs from 'node:fs';
const url = fs.readFileSync('data/server.url', 'utf8').trim();
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await p.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(e => console.log('goto', String(e).slice(0,200)));
await p.waitForTimeout(2500);
await p.screenshot({ path: 'docs/ui-preview.png' });
// 再等 25s 截第二张，覆盖"弹题出现 + 自动作答"那一刻
await p.waitForTimeout(26000);
await p.screenshot({ path: 'docs/ui-preview-2.png' });
await b.close();
console.log('SHOT_OK');
