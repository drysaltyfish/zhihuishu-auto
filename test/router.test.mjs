import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRouter } from '../server/lib/router.mjs';
import { httpError } from '../server/lib/http.mjs';

const TOKEN = 'abc123';

function fakeRes() {
  return {
    headersSent: false,
    writableEnded: false,
    statusCode: 0,
    headers: null,
    body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; this.headersSent = true; },
    end(body) { this.body = body || ''; this.writableEnded = true; },
    on() {},
  };
}

function fakeReq(method, payload) {
  const req = new EventEmitter();
  req.method = method;
  if (payload !== undefined) {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    setImmediate(() => { req.emit('data', Buffer.from(text)); req.emit('end'); });
  } else {
    setImmediate(() => req.emit('end'));
  }
  return req;
}

function mk(routes, log = () => {}) {
  return createRouter({ routes, token: TOKEN, log, context: () => ({ state: { phase: 'PLAYING' } }) });
}

const ROUTES = [
  { path: '/api/state', methods: ['GET'], handler: ({ res }) => { res.writeHead(200); res.end('{"ok":true}'); } },
  { path: '/api/start', methods: ['POST'], handler: ({ res, body, state }) => { res.writeHead(200); res.end(JSON.stringify({ body, phase: state.phase })); } },
  { path: '/api/boom', methods: ['GET'], handler: () => { throw new Error('数据库密码是 xxx'); } },
  { path: '/api/nope', methods: ['GET'], handler: () => { throw httpError(409, '任务还没开始', '先点「开始听课」'); } },
  { path: '/api/teapot', methods: ['GET'], handler: () => { throw httpError(418, '我是茶壶'); } },
];

test('未知接口 → 404 接口不存在', async () => {
  const res = fakeRes();
  await mk(ROUTES)(fakeReq('GET'), res, new URL('http://x/api/unknown?t=' + TOKEN));
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).message, '接口不存在');
});

test('没有令牌 → 403 并提示带 ?t= 的地址', async () => {
  const res = fakeRes();
  await mk(ROUTES)(fakeReq('GET'), res, new URL('http://x/api/state'));
  assert.equal(res.statusCode, 403);
  const b = JSON.parse(res.body);
  assert.equal(b.message, '访问令牌无效');
  assert.match(b.hint, /\?t=/);
});

test('令牌不对也拒', async () => {
  const res = fakeRes();
  await mk(ROUTES)(fakeReq('GET'), res, new URL('http://x/api/state?t=wrong'));
  assert.equal(res.statusCode, 403);
});

test('方法不对 → 405', async () => {
  const res = fakeRes();
  await mk(ROUTES)(fakeReq('POST', {}), res, new URL('http://x/api/state?t=' + TOKEN));
  assert.equal(res.statusCode, 405);
});

test('正常 GET 透传 handler', async () => {
  const res = fakeRes();
  await mk(ROUTES)(fakeReq('GET'), res, new URL('http://x/api/state?t=' + TOKEN));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, '{"ok":true}');
});

test('POST 请求体解析后交给 handler，上下文也注入', async () => {
  const res = fakeRes();
  await mk(ROUTES)(fakeReq('POST', { autoAnswer: false }), res, new URL('http://x/api/start?t=' + TOKEN));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { body: { autoAnswer: false }, phase: 'PLAYING' });
});

test('坏 JSON 当空对象，handler 自己校验', async () => {
  const res = fakeRes();
  await mk(ROUTES)(fakeReq('POST', '{not json'), res, new URL('http://x/api/start?t=' + TOKEN));
  assert.deepEqual(JSON.parse(res.body).body, {});
});

test('普通异常 → 500 通用文案，不把内部细节丢给前端，但日志留证据', async () => {
  const logs = [];
  const res = fakeRes();
  await mk(ROUTES, (kind, msg) => logs.push(kind + ':' + msg))(fakeReq('GET'), res, new URL('http://x/api/boom?t=' + TOKEN));
  assert.equal(res.statusCode, 500);
  const b = JSON.parse(res.body);
  assert.equal(b.message, '服务出了一点问题，已记录，请重试');
  assert.doesNotMatch(b.message, /密码/);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^err:接口 \/api\/boom 处理失败：数据库密码是 xxx/);
});

test('expose 错误原样透出 status/message/hint', async () => {
  const res = fakeRes();
  await mk(ROUTES)(fakeReq('GET'), res, new URL('http://x/api/nope?t=' + TOKEN));
  assert.equal(res.statusCode, 409);
  assert.deepEqual(JSON.parse(res.body), { code: 409, message: '任务还没开始', hint: '先点「开始听课」' });
});

test('没有 hint 的 expose 错误 hint 为空串', async () => {
  const res = fakeRes();
  await mk(ROUTES)(fakeReq('GET'), res, new URL('http://x/api/teapot?t=' + TOKEN));
  assert.equal(res.statusCode, 418);
  assert.equal(JSON.parse(res.body).hint, '');
});
