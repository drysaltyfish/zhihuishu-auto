import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOCK_HINTS,
  DISMISS_TEXTS,
  NOTICE_KEYWORDS,
  isBlocked,
  isNotice,
  normalizeText,
  noticeLabel,
  planNoticeClose,
} from '../server/worker/lib/notice.mjs';

const notice = (text, buttons, checkbox) => ({ text, buttons: buttons || [], checkbox: checkbox || null });

test('isNotice：认得学前必读/学习须知这类提示', () => {
  assert.equal(isNotice('学前必读 本课程为在线课程，请诚信学习'), true);
  assert.equal(isNotice('学习须知：禁止使用外挂'), true);
  assert.equal(isNotice('温馨提示'), true);
  for (const k of NOTICE_KEYWORDS) assert.equal(isNotice('关于' + k), true, k);
});

test('isNotice：弹题与验证一律不算提示弹窗', () => {
  assert.equal(isNotice('请提交答案后再继续'), false);
  assert.equal(isNotice('安全验证：请拖动滑块'), false);
  assert.equal(isNotice('检测到异常脚本，请完成验证'), false);
  assert.equal(isNotice(''), false);
  assert.equal(isNotice('这是一段普通正文'), false);
  for (const k of BLOCK_HINTS) assert.equal(isBlocked('x' + k + 'y'), true, k);
});

test('planNoticeClose：学前必读 + 「我知道了」→ 关', () => {
  const p = planNoticeClose(notice('学前必读 请诚信学习', [{ text: '我知道了' }]));
  assert.equal(p.close, true);
  assert.equal(p.button.index, 0);
  assert.equal(p.button.kind, 'dismiss');
  assert.equal(p.checkFirst, false);
});

test('planNoticeClose：没有关闭按钮但有「开始学习」→ 点开始学习', () => {
  const p = planNoticeClose(notice('学前必读 本课程为在线课程', [{ text: '开始学习' }]));
  assert.equal(p.close, true);
  assert.equal(p.button.kind, 'start');
});

test('planNoticeClose：关闭文案优先于开始学习', () => {
  const p = planNoticeClose(notice('学习须知', [{ text: '开始学习' }, { text: '关闭' }]));
  assert.equal(p.close, true);
  assert.equal(p.button.index, 1);
  assert.equal(p.button.kind, 'dismiss');
});

test('planNoticeClose：弹题/验证绝不关', () => {
  const p = planNoticeClose(notice('安全验证：请拖动滑块', [{ text: '关闭' }]));
  assert.equal(p.close, false);
  assert.match(p.reason, /不能碰/);
});

test('planNoticeClose：不认识的内容不关', () => {
  const p = planNoticeClose(notice('系统公告：今晚维护', [{ text: '关闭' }]));
  assert.equal(p.close, false);
  assert.match(p.reason, /不是认得出/);
});

test('planNoticeClose：按钮 disabled / 文字过长（正文块）都不点', () => {
  const p = planNoticeClose(
    notice('学前必读', [
      { text: '关闭', disabled: true },
      { text: '我已阅读并同意以上全部条款并且承诺诚信学习不违规', disabled: false },
    ])
  );
  assert.equal(p.close, false);
  assert.match(p.reason, /没有可用/);
});

test('planNoticeClose：要先勾「已阅读」时给出 checkFirst', () => {
  const p = planNoticeClose(notice('学前必读 请先阅读', [{ text: '开始学习' }], { visible: true, checked: false }));
  assert.equal(p.checkFirst, true);
  assert.equal(p.close, true);
});

test('planNoticeClose：只有勾选框、没按钮 → 不关（留着让日志提示）', () => {
  const p = planNoticeClose(notice('学前必读', [], { visible: true, checked: false }));
  assert.equal(p.close, false);
  assert.equal(p.checkFirst, true);
  assert.match(p.reason, /勾选/);
});

test('planNoticeClose：已勾选就不必再点勾选框', () => {
  const p = planNoticeClose(notice('学前必读', [{ text: '关闭' }], { visible: true, checked: true }));
  assert.equal(p.checkFirst, false);
  assert.equal(p.close, true);
});

test('noticeLabel：取正文第一句并截断到 40 字', () => {
  assert.equal(noticeLabel('学前必读。本课程为在线课程'), '学前必读');
  assert.equal(noticeLabel(''), '提示弹窗');
  const long = '学'.repeat(80);
  assert.equal(noticeLabel(long).length, 40);
});

test('normalizeText：压缩空白', () => {
  assert.equal(normalizeText('  学前 \n 必读  '), '学前 必读');
  assert.equal(normalizeText(null), '');
  assert.ok(DISMISS_TEXTS.includes('我知道了'));
});
