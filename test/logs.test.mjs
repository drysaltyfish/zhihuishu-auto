import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogRing } from '../server/lib/logs.mjs';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zhs-logs-'));
}

test('push 记下时间/类型/内容，list 按顺序返回', () => {
  const ring = createLogRing();
  ring.push('ok', '已启动');
  ring.push('warn', '弹题出现');
  const rows = ring.list();
  assert.equal(rows.length, 2);
  assert.match(rows[0].time, /^\d{2}:\d{2}:\d{2}$/);
  assert.equal(rows[0].kind, 'ok');
  assert.equal(rows[1].msg, '弹题出现');
  assert.equal(ring.size, 2);
});

test('超过上限丢最旧的，界面不会越堆越长', () => {
  const ring = createLogRing({ max: 3 });
  for (const s of ['a', 'b', 'c', 'd']) ring.push('info', s);
  assert.deepEqual(ring.list().map((r) => r.msg), ['b', 'c', 'd']);
});

test('type 缺省为 info，null 内容变空串，超长截断 400', () => {
  const ring = createLogRing();
  ring.push(undefined, null);
  ring.push('ok', 'x'.repeat(600));
  assert.equal(ring.list()[0].kind, 'info');
  assert.equal(ring.list()[0].msg, '');
  assert.equal(ring.list()[1].msg.length, 400);
});

test('落盘到 dataDir/runtime.log，一行一条', () => {
  const dir = tmpDir();
  const ring = createLogRing({ dataDir: dir });
  ring.push('ok', '第一行');
  ring.push('err', '第二行');
  const text = fs.readFileSync(path.join(dir, 'runtime.log'), 'utf8');
  const lines = text.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], / ok 第一行$/);
  assert.match(lines[1], / err 第二行$/);
});

test('文件超过上限时清空重写，不无限增长', () => {
  const dir = tmpDir();
  const p = path.join(dir, 'runtime.log');
  fs.writeFileSync(p, 'x'.repeat(100));
  const ring = createLogRing({ dataDir: dir, fileMax: 50 });
  ring.push('info', '新的');
  const text = fs.readFileSync(p, 'utf8');
  assert.equal(text.trim().split('\n').length, 1);
  assert.match(text, /新的/);
});

test('每次都通知 onChange（SSE 靠它推日志）', () => {
  let n = 0;
  const ring = createLogRing({ onChange: () => { n++; } });
  ring.push('info', 'a');
  ring.push('info', 'b');
  assert.equal(n, 2);
});

test('dataDir 不可写也不炸（只是没落盘）', () => {
  const ring = createLogRing({ dataDir: path.join(tmpDir(), 'no', 'such', 'dir') });
  assert.doesNotThrow(() => ring.push('info', '照常记'));
  assert.equal(ring.list().length, 1);
});
