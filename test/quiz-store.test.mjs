import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadQuizzes, saveQuizzes, quizzesPath } from '../server/worker/lib/quiz-store.mjs';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'zhs-quizstore-'));

test('存盘后能读回来', () => {
  const dir = tmpDir();
  const data = { 第一章: { status: 'done', score: 12, total: 12, at: 123 } };
  assert.equal(saveQuizzes(dir, data), true);
  assert.deepEqual(loadQuizzes(dir), data);
  assert.ok(fs.existsSync(quizzesPath(dir)));
});

test('文件不存在时返回空对象', () => {
  assert.deepEqual(loadQuizzes(tmpDir()), {});
});

test('文件坏了也不抛错', () => {
  const dir = tmpDir();
  fs.writeFileSync(quizzesPath(dir), '{not json');
  assert.deepEqual(loadQuizzes(dir), {});
  fs.writeFileSync(quizzesPath(dir), '[1,2,3]');
  assert.deepEqual(loadQuizzes(dir), {});
});

test('只保留对象类型的条目（防止手改坏）', () => {
  const dir = tmpDir();
  fs.writeFileSync(quizzesPath(dir), JSON.stringify({ a: { status: 'done' }, b: 1, c: null }));
  assert.deepEqual(loadQuizzes(dir), { a: { status: 'done' } });
});

test('二次保存覆盖旧内容且不留临时文件', () => {
  const dir = tmpDir();
  saveQuizzes(dir, { a: { status: 'todo' } });
  saveQuizzes(dir, { a: { status: 'done' } });
  assert.equal(loadQuizzes(dir).a.status, 'done');
  assert.equal(fs.existsSync(quizzesPath(dir) + '.tmp'), false);
});
