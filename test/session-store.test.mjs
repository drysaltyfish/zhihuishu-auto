import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pickCookies, saveCookies, loadCookies, cookiesPath } from '../server/worker/lib/session-store.mjs';

const NOW = 1_700_000_000;

test('pickCookies 只保留智慧树域，会话 Cookie 补 7 天过期', () => {
  const list = pickCookies([
    { name: 'CASLOGC', value: 'v1', domain: '.zhihuishu.com', path: '/', expires: -1, httpOnly: true, secure: true },
    { name: 'other', value: 'x', domain: '.example.com', path: '/' },
    { name: 'empty', value: '', domain: '.zhihuishu.com' },
  ], NOW);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'CASLOGC');
  assert.equal(list[0].expires, NOW + 7 * 86400);
  assert.equal(list[0].httpOnly, true);
  assert.equal(list[0].secure, true);
});

test('pickCookies 保留已有过期时间', () => {
  const list = pickCookies([{ name: 'a', value: '1', domain: 'x.zhihuishu.com', expires: NOW + 100 }], NOW);
  assert.equal(list[0].expires, NOW + 100);
  assert.equal(list[0].path, '/');
});

test('saveCookies / loadCookies 往返，空列表不落盘', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhs-ck-'));
  assert.equal(saveCookies(dir, []), 0);
  assert.equal(fs.existsSync(cookiesPath(dir)), false);

  const n = saveCookies(dir, [
    { name: 'CASLOGC', value: 'abc', domain: '.zhihuishu.com' },
    { name: 'jt-cas', value: 'def', domain: '.zhihuishu.com' },
  ]);
  assert.equal(n, 2);
  const back = loadCookies(dir);
  assert.deepEqual(back.map((c) => c.name).sort(), ['CASLOGC', 'jt-cas']);
  assert.ok(back[0].expires > Math.floor(Date.now() / 1000));
});

test('loadCookies 跳过过期与坏文件', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhs-ck2-'));
  fs.writeFileSync(cookiesPath(dir), JSON.stringify({ cookies: [
    { name: 'old', value: '1', domain: '.zhihuishu.com', expires: 100 },
    { name: 'ok', value: '2', domain: '.zhihuishu.com', expires: NOW + 9999 },
  ] }));
  assert.deepEqual(loadCookies(dir, NOW).map((c) => c.name), ['ok']);
  fs.writeFileSync(cookiesPath(dir), '{not json');
  assert.deepEqual(loadCookies(dir, NOW), []);
});
