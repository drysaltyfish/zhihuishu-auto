import test from 'node:test';
import assert from 'node:assert/strict';
import { createHub } from '../server/lib/sse.mjs';

const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));

function fakeClient() {
  const c = {
    chunks: [],
    ended: false,
    statusCode: 0,
    headers: null,
    writeHead(code, headers) {
      c.statusCode = code;
      c.headers = headers;
    },
    write(t) {
      c.chunks.push(String(t));
    },
    end() {
      c.ended = true;
    },
    on() {},
  };
  return c;
}

function framesOf(client) {
  return client.chunks
    .join('')
    .split('\n\n')
    .filter((b) => b.includes('event: '))
    .map((block) => {
      const lines = block.split('\n');
      return {
        event: (lines.find((l) => l.startsWith('event: ')) || '').slice(7),
        data: (lines.find((l) => l.startsWith('data: ')) || '').slice(6),
      };
    });
}

function mkHub(over = {}) {
  const s = { state: { phase: 'IDLE', n: 0 }, logs: [], logCalls: [] };
  const hub = createHub({
    getState: () => s.state,
    getLogs: () => s.logs,
    log: (k, m) => s.logCalls.push(k + ':' + m),
    stateDelayMs: 1,
    logsDelayMs: 1,
    ...over,
  });
  return { hub, s };
}

test('客户端连上先收到 event-stream 头 + 一份状态和日志', async () => {
  const { hub, s } = mkHub();
  s.logs = [{ time: '10:00:00', kind: 'ok', msg: '已启动' }];
  const c = fakeClient();
  hub.addClient({ on() {} }, c);
  assert.equal(c.statusCode, 200);
  assert.equal(c.headers['content-type'], 'text/event-stream');
  const f = framesOf(c);
  assert.deepEqual(
    f.map((x) => x.event),
    ['state', 'logs']
  );
  assert.deepEqual(JSON.parse(f[0].data), { phase: 'IDLE', n: 0 });
  assert.equal(JSON.parse(f[1].data)[0].msg, '已启动');
  hub.stop();
});

test('状态变了才推，重复的同一份状态不重复推', async () => {
  const { hub, s } = mkHub();
  const c = fakeClient();
  hub.addClient({ on() {} }, c);
  await tick();
  const before = framesOf(c).length;

  s.state.n = 1;
  hub.stateChanged();
  hub.stateChanged(); // 合并成一次
  await tick();
  let f = framesOf(c);
  assert.equal(f.length, before + 1);
  assert.equal(JSON.parse(f[f.length - 1].data).n, 1);

  hub.stateChanged(); // 内容没变
  await tick();
  f = framesOf(c);
  assert.equal(f.length, before + 1);
  hub.stop();
});

test('日志只在出现新的一条时推', async () => {
  const { hub, s } = mkHub();
  const c = fakeClient();
  hub.addClient({ on() {} }, c);
  await tick();
  const before = framesOf(c).length;

  s.logs.push({ time: '10:00:01', kind: 'info', msg: 'a' });
  hub.logsChanged();
  await tick();
  assert.equal(framesOf(c).length, before + 1);

  hub.logsChanged(); // 没新日志
  await tick();
  assert.equal(framesOf(c).length, before + 1);
  hub.stop();
});

test('多个客户端都收到同一个变化', async () => {
  const { hub, s } = mkHub();
  const a = fakeClient();
  const b = fakeClient();
  hub.addClient({ on() {} }, a);
  hub.addClient({ on() {} }, b);
  assert.equal(hub.clientCount, 2);

  s.state.phase = 'PLAYING';
  hub.stateChanged();
  await tick();
  for (const c of [a, b]) {
    const f = framesOf(c);
    assert.equal(JSON.parse(f[f.length - 1].data).phase, 'PLAYING');
  }
  hub.stop();
});

test('客户端断开后自己摘掉，不再往里写', async () => {
  const { hub, s } = mkHub();
  const handlers = {};
  const res = fakeClient();
  const req = {
    on(type, cb) {
      handlers[type] = cb;
    },
  };
  hub.addClient(req, res);
  assert.equal(hub.clientCount, 1);

  handlers.close();
  assert.equal(hub.clientCount, 0);
  s.state.n = 9;
  hub.stateChanged();
  await tick();
  assert.equal(framesOf(res).length, 2); // 只有首帧 state+logs
  hub.stop();
});

test('stop() 结束所有连接并清空', () => {
  const { hub } = mkHub();
  const c = fakeClient();
  hub.addClient({ on() {} }, c);
  hub.stop();
  assert.equal(c.ended, true);
  assert.equal(hub.clientCount, 0);
});

test('序列化失败记日志、不把进程带崩', async () => {
  const bad = {};
  bad.self = bad;
  const { hub, s } = mkHub({ getState: () => bad });
  const c = fakeClient();
  hub.addClient({ on() {} }, c); // 首帧被 try 吃掉
  hub.stateChanged();
  await tick();
  assert.equal(framesOf(c).filter((f) => f.event === 'state').length, 0);
  assert.equal(s.logCalls.length, 1);
  assert.match(s.logCalls[0], /^err:状态序列化失败/);
  hub.stop();
});
