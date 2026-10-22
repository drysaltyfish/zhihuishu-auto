import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { ABNORMAL, COURSE_TREE, DIALOG, DIALOG_HTML, VERIFY, VSTATE } from '../server/worker/lib/page-scripts.mjs';

let br;
let pg;
before(async () => {
  br = await chromium.launch({ headless: true, channel: 'chrome' });
  pg = await br.newPage();
});
after(async () => { await br.close(); });

const fixture = (name) => fs.readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8');
const load = (html) => pg.setContent('<!doctype html><html><body>' + html + '</body></html>');

test('DIALOG：未作答弹窗能读到题面/选项/未作答', async () => {
  await load(fixture('dialog-open.html'));
  const d = await pg.evaluate(DIALOG);
  assert.equal(d.visible, true);
  assert.equal(d.id, 'playTopic-dialog');
  assert.ok(d.optionCount >= 2, '选项数=' + d.optionCount);
  assert.equal(d.answered, false);
  assert.equal(d.answerText, '');
  assert.match(d.title, /\S/);
  assert.ok(d.options.every((o) => typeof o.text === 'string'));
});

test('DIALOG：已作答弹窗能读到 answered/Comment 与正确答案字母', async () => {
  await load(fixture('dialog-answered.html'));
  const d = await pg.evaluate(DIALOG);
  assert.equal(d.visible, true);
  assert.equal(d.answered, true);
  assert.match(d.answerText, /正确答案/);
  assert.match(d.answerText, /[A-H]/);
});

test('DIALOG：没有弹窗的页面返回 visible=false', async () => {
  await load('<div id="foo">普通页面</div>');
  const d = await pg.evaluate(DIALOG);
  assert.equal(d.visible, false);
});

test('DIALOG：display:none 的弹窗不算弹出', async () => {
  await load(fixture('dialog-open.html').replace('style="z-index: 2001;"', 'style="display:none"'));
  const d = await pg.evaluate(DIALOG);
  assert.equal(d.visible, false);
});

test('DIALOG_HTML：返回 outerHTML 与 frameUrl；没弹窗返回 null', async () => {
  await load(fixture('dialog-open.html'));
  const info = await pg.evaluate(DIALOG_HTML);
  assert.match(info.html, /playTopic-dialog/);
  assert.equal(typeof info.frameUrl, 'string');
  await load('<div>空</div>');
  assert.equal(await pg.evaluate(DIALOG_HTML), null);
});

test('COURSE_TREE：解析章节标题、节的编号/名称/进度/时长/当前节', async () => {
  await load([
    '<div class="source-name">大学生心理素质发展</div>',
    '<div class="source-down">北京理工大学</div>',
    '<div class="videotop_lesson">第二章 自我意识</div>',
    '<div class="videotop_lesson_tit">2.1 自我意识的内涵</div>',
    '<ul>',
    '<li class="clearfix font_gray_inclined chapter">第二章 自我意识</li>',
    '<li class="clearfix video current_play"><span>2.1 自我意识的内涵</span><span>55%</span><span>00:11:17</span><b class="time_ico_half"></b></li>',
    '<li class="clearfix video"><span>2.2 自我发展理论</span><span>00:10:20</span><b class="time_icofinish"></b></li>',
    '<li class="clearfix chapter-test"><span>平时测试</span></li>',
    '</ul>',
  ].join(''));
  const info = await pg.evaluate(COURSE_TREE);
  assert.equal(info.courseName, '大学生心理素质发展');
  assert.equal(info.school, '北京理工大学');
  assert.equal(info.chapter, '第二章 自我意识');
  assert.equal(info.lesson, '2.1 自我意识的内涵');
  assert.equal(info.lessons.length, 2, '应忽略平时测试');
  const [a, b] = info.lessons;
  assert.equal(a.code, '2.1');
  assert.equal(a.name, '自我意识的内涵');
  assert.equal(a.pct, 55);
  assert.equal(a.durSec, 677);
  assert.equal(a.current, true);
  assert.equal(a.doneAttr, false);
  assert.equal(b.code, '2.2');
  assert.equal(b.pct, null);
  assert.equal(b.doneAttr, true);
  assert.equal(b.half, false);
});

test('ABNORMAL：识别「异常脚本」提示框', async () => {
  await load('<div class="el-message-box">检测到异常脚本，为保证您的正常学习进度，请您关闭插件后，回到学堂重新进入视频学习页正常学习</div>');
  assert.match(await pg.evaluate(ABNORMAL), /异常脚本/);
  await load('<div class="el-message-box">普通提示</div>');
  assert.equal(await pg.evaluate(ABNORMAL), '');
});

test('VERIFY：识别屏幕内的安全验证弹窗；拖到屏幕外的常驻 iframe 不算', async () => {
  await load('<div class="el-dialog" style="width:400px;height:300px">请完成安全验证</div>');
  assert.match(await pg.evaluate(VERIFY), /安全验证/);
  // 腾讯 tcaptcha 的 iframe 常驻在屏幕外：内联样式里的文字不在 body.innerText 中，不能误判
  await load('<iframe src="https://turing.captcha.qcloud.com/x" style="position:absolute;top:-1000000px;width:400px;height:300px"></iframe>');
  assert.equal(await pg.evaluate(VERIFY), '');
  await load('<iframe src="https://turing.captcha.qcloud.com/x" style="width:400px;height:300px"></iframe>');
  assert.equal(await pg.evaluate(VERIFY), '验证码 iframe');
});

test('VSTATE：没有 video 时返回 null', async () => {
  await load('<div>没有视频</div>');
  assert.equal(await pg.evaluate(VSTATE), null);
});
