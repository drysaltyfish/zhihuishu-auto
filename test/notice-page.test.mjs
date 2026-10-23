import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { NOTICES } from '../server/worker/lib/page-scripts.mjs';
import { NOTICE_KEYWORDS, noticeLabel, planNoticeClose } from '../server/worker/lib/notice.mjs';

let br;
let pg;
before(async () => {
  br = await chromium.launch({ headless: true, channel: 'chrome' });
  pg = await br.newPage({ viewport: { width: 1440, height: 900 } });
});
after(async () => {
  await br.close();
});

const fixture = (name) => fs.readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8');
const load = (html) => pg.setContent('<!doctype html><html><body>' + html + '</body></html>');

test('NOTICES：读到「学前必读」弹窗的正文/按钮/勾选框，并给出可按的 path', async () => {
  await load(fixture('notice-prelecture.html'));
  const rows = await pg.evaluate(NOTICES);
  assert.equal(rows.length, 1, JSON.stringify(rows));
  const n = rows[0];
  assert.match(n.text, /学前必读/);
  assert.match(n.text, /诚信学习/);
  assert.equal(n.path.startsWith('html > body'), true, n.path);
  assert.equal(typeof n.area, 'number');
  const start = n.buttons.find((b) => b.text === '开始学习');
  assert.ok(start, '按钮：' + JSON.stringify(n.buttons));
  assert.equal(start.disabled, false);
  assert.ok(start.path);
  assert.ok(n.checkbox, '勾选框没读到');
  assert.equal(n.checkbox.visible, true);
  assert.equal(n.checkbox.checked, false);
  assert.equal(n.closeIcons.length, 1);
});

test('NOTICES：扫到的弹窗能交给 notice.mjs 定出关闭方案，并按 path 真的点掉', async () => {
  await load(fixture('notice-prelecture.html'));
  const rows = await pg.evaluate(NOTICES);
  const n = rows[0];
  const plan = planNoticeClose(n);
  assert.equal(plan.close, true);
  assert.equal(plan.button.kind, 'start');
  const btn = n.buttons[plan.button.index];
  await pg.click(btn.path);
  const after = await pg.evaluate(NOTICES);
  assert.deepEqual(after, []);
  assert.equal(await pg.isVisible('#prelecture-notice'), false);
  assert.ok(NOTICE_KEYWORDS.some((k) => n.text.includes(k)));
  assert.equal(noticeLabel(n.text), '学前必读');
});

test('NOTICES：弹题弹窗不算提示弹窗（不扫进来）', async () => {
  await load(fixture('dialog-open.html'));
  assert.deepEqual(await pg.evaluate(NOTICES), []);
});

test('NOTICES：display:none 的弹窗扫不到', async () => {
  await load(fixture('notice-prelecture.html').replace('style="z-index: 2005;', 'style="display:none; z-index: 2005;'));
  assert.deepEqual(await pg.evaluate(NOTICES), []);
});

test('NOTICES：普通页面返回空数组', async () => {
  await load('<div id="app">课程列表</div>');
  assert.deepEqual(await pg.evaluate(NOTICES), []);
});
