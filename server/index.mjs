/**
 * 本地服务：静态托管 Vue 构建产物 + 状态推送 + 控制接口。
 * 引擎二选一：真实（Playwright worker，独占 Chrome）或 mock（联调用）。
 *   node server/index.mjs          真实引擎
 *   node server/index.mjs --mock    mock 引擎
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { initialState, applyPatch } from './state.mjs';
import { createMockEngine } from './mock-engine.mjs';
import { createRealEngine } from './real-engine.mjs';
import { askLLM } from './llm.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PUBLIC = path.join(HERE, 'public');
// 允许用 ZHS_DATA 指定数据目录（自检/多实例互不干扰；默认 ./data）
const DATA = process.env.ZHS_DATA ? path.resolve(process.env.ZHS_DATA) : path.join(ROOT, 'data');

const argv = process.argv.slice(2);
const argN = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const PORT = Number(argN('port', '8731'));
const MOCK = argv.includes('--mock');
const TOKEN = crypto.randomBytes(12).toString('hex');

fs.mkdirSync(DATA, { recursive: true });

/* ---------------- 日志环 ---------------- */
const logs = [];
function pushLog(kind, msg) {
  const line = { time: new Date().toTimeString().slice(0, 8), kind, msg: String(msg == null ? '' : msg).slice(0, 400) };
  logs.push(line);
  if (logs.length > 300) logs.shift();
  // 同时落一份文件，出问题时方便回看（data/runtime.log，超过 2MB 自动清空重来）
  try {
    const p = path.join(DATA, 'runtime.log');
    if (fs.existsSync(p) && fs.statSync(p).size > 2 * 1024 * 1024) fs.writeFileSync(p, '');
    fs.appendFileSync(p, line.time + ' ' + kind + ' ' + line.msg + '\n');
  } catch {}
}

/* ---------------- 状态 ---------------- */
const state = initialState();
state.mode = MOCK ? 'mock' : 'real';
let dirty = true;
function emit() { dirty = true; }
emit();

/* ---------------- 引擎 ---------------- */
const engine = MOCK
  ? (() => { const e = createMockEngine(state, emit, pushLog); return { start: e.start, control: (a, d) => e.control(a, d), stop: e.stop }; })()
  : createRealEngine({ state, emit, pushLog, dataDir: DATA });

/* ---------------- HTTP ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const sseClients = new Set();
function broadcast(event, payload) {
  const frame = 'event: ' + event + '\ndata: ' + JSON.stringify(payload) + '\n\n';
  for (const res of sseClients) { try { res.write(frame); } catch { sseClients.delete(res); } }
}

setInterval(() => {
  if (dirty || MOCK) { dirty = false; broadcast('state', state); }
}, 500);

let lastLogSig = '';
setInterval(() => {
  const sig = logs.length + ':' + (logs[logs.length - 1] ? logs[logs.length - 1].time : '');
  if (sig !== lastLogSig) { lastLogSig = sig; broadcast('logs', logs); }
}, 600);

function json(res, code, body) {
  const b = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(b);
}
function fail(res, code, userMessage, hint) {
  json(res, code, { code, message: userMessage, hint: hint || '' });
}
function readJson(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname;

    if (p.startsWith('/api/')) {
      const t = url.searchParams.get('t') || '';
      if (t !== TOKEN) return fail(res, 403, '访问令牌无效', '请用启动时自动打开的页面地址进入（地址里带 ?t=…）');

      if (p === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.write(':ok\n\n');
        sseClients.add(res);
        res.write('event: state\ndata: ' + JSON.stringify(state) + '\n\n');
        res.write('event: logs\ndata: ' + JSON.stringify(logs) + '\n\n');
        req.on('close', () => sseClients.delete(res));
        return;
      }

      if (p === '/api/state') return json(res, 200, state);

      if (p === '/api/start') {
        if (state.phase !== 'IDLE' && state.phase !== 'STOPPED') {
          return fail(res, 409, '任务已经在运行了');
        }
        applyPatch(state, { notice: '', phase: 'LAUNCHING', verifyHint: '' });
        emit();
        engine.start();
        setTimeout(() => { try { engine.control('settings', { autoAnswer: state.answers.auto, autoAdvance: state.answers.advance }); } catch {} }, 1500);
        return json(res, 200, { ok: true });
      }

      if (p === '/api/control') {
        const body = await readJson(req);
        const action = body.action;
        // probe 只在调试模式开放（摸页面结构用，正常使用不出现）
        const allowed = ['pause', 'resume', 'restart', 'quit'];
        if (MOCK) { allowed.push('verify'); allowed.push('unverify'); } // selftest 用：模拟人机验证弹窗
        if (process.env.ZHS_DEBUG === '1' && !MOCK) { allowed.push('probe'); allowed.push('verifyprobe'); }
        if (!allowed.includes(action)) return fail(res, 400, '不支持的操作');
        if (action !== 'restart' && (state.phase === 'IDLE')) return fail(res, 409, '任务还没开始', '先点「开始听课」');
        try {
          const okc = engine.control(action);
          if (action === 'pause') applyPatch(state, { paused: true, phase: 'PAUSED' });
          if (action === 'resume') applyPatch(state, { paused: false });
          if (action === 'quit') applyPatch(state, { paused: true, phase: 'STOPPED', video: { paused: true } });
          if (action === 'restart') applyPatch(state, { notice: '', phase: 'LAUNCHING', paused: false });
          emit();
          return json(res, 200, { ok: !!okc || true });
        } catch (e) {
          pushLog('err', '操作失败：' + String(e && e.message || e).slice(0, 160));
          return fail(res, 500, '操作没成功，请稍后再试', '如果反复失败，点「退出」再重新双击 start.bat');
        }
      }

      if (p === '/api/settings') {
        const body = await readJson(req);
        const out = {};
        if (typeof body.autoAnswer === 'boolean') {
          out.autoAnswer = body.autoAnswer;
          applyPatch(state, { answers: { auto: body.autoAnswer } });
          pushLog('info', body.autoAnswer ? '已开启自动答题' : '已关闭自动答题（弹题会停下等你手动答）');
        }
        if (typeof body.autoAdvance === 'boolean') {
          out.autoAdvance = body.autoAdvance;
          applyPatch(state, { answers: { advance: body.autoAdvance } });
          pushLog('info', body.autoAdvance ? '已开启「看完自动跳下一节」' : '已关闭自动跳节（看完这一节会停下等你选）');
        }
        if (Object.keys(out).length) { engine.control('settings', out); emit(); }
        return json(res, 200, { ok: true });
      }

      if (p === '/api/llmcheck') {
        // 用一道固定题试一下模型能不能答对（只发一次请求，不动浏览器）
        let cfg = {};
        try { cfg = JSON.parse(fs.readFileSync(path.join(DATA, 'config.json'), 'utf8')).llm || {}; } catch {}
        const options = [{ label: 'A.', text: '心理健康就是永远没有烦恼' }, { label: 'B.', text: '心理健康是一种持续、积极且能适应环境的状态' }, { label: 'C.', text: '只要没有心理疾病就是心理健康' }, { label: 'D.', text: '心理健康与身体健康无关' }];
        const r = await askLLM(cfg, { question: '下列关于心理健康的说法，哪一项最准确？', options, timeoutMs: 30000 });
        const ok = !!(r.ok && r.idx === 1);
        pushLog(ok ? 'ok' : 'warn', '模型自检：' + (r.ok ? '选了 ' + r.letter + (ok ? '（正确）' : '（应为 B）') : r.why) + (r.ms ? ' · ' + r.ms + 'ms' : ''));
        return json(res, 200, { ok, model: cfg.model || '', letter: r.letter || '', why: r.why || '', raw: r.raw || '', ms: r.ms || 0 });
      }


      if (p === '/api/courses') {
        if (state.phase === 'IDLE' || state.phase === 'STOPPED') {
          return fail(res, 409, '任务还没开始', '先点「开始听课」，登录后才能读到你的课程');
        }
        try {
          engine.control('courses');
          pushLog('info', '正在读取你的课程列表…');
          return json(res, 200, { ok: true, courses: state.courses || [] });
        } catch (e) {
          return fail(res, 500, '读课程列表没成功，请稍后再试', '如果反复失败，点「退出」再重新开始');
        }
      }

      if (p === '/api/course') {
        const body = await readJson(req);
        const idx = Number(body.index);
        if (!Number.isInteger(idx) || idx < 0) return fail(res, 400, '课程序号不对', '请刷新页面后重试');
        if (state.phase === 'IDLE' || state.phase === 'STOPPED') {
          return fail(res, 409, '任务还没开始', '先点「开始听课」再换课程');
        }
        const pick = (state.courses || [])[idx];
        try {
          engine.control('course', { index: idx });
          pushLog('info', '按你的选择切换课程：' + (pick ? pick.name : '第 ' + (idx + 1) + ' 门'));
          applyPatch(state, { coursePicking: false });
          emit();
          return json(res, 200, { ok: true });
        } catch (e) {
          pushLog('err', '切换课程失败：' + String(e && e.message || e).slice(0, 140));
          return fail(res, 500, '切换课程没成功，请稍后再试', '如果反复失败，点「退出」再重新开始');
        }
      }

      if (p === '/api/lesson') {
        const body = await readJson(req);
        const code = String(body.code || '');
        if (!/^\d+\.\d+$/.test(code)) return fail(res, 400, '小节编号不对', '请刷新页面后重试');
        if (state.phase === 'IDLE' || state.phase === 'STOPPED') {
          return fail(res, 409, '任务还没开始', '先点「开始听课」，再选要看的小节');
        }
        try {
          engine.control('lesson', { code });
          pushLog('info', '按你的选择切换小节：' + code);
          return json(res, 200, { ok: true });
        } catch (e) {
          pushLog('err', '切换小节失败：' + String(e && e.message || e).slice(0, 140));
          return fail(res, 500, '切换小节没成功，请稍后再试', '如果反复失败，点「退出」再重新开始');
        }
      }

      return fail(res, 404, '接口不存在');
    }

    let fp = p === '/' ? '/index.html' : p;
    fp = path.join(PUBLIC, path.normalize(fp).replace(/^(\.\.[\/\\])+/, ''));
    if (!fp.startsWith(PUBLIC) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
      return fail(res, 404, '页面不存在', '请先执行 npm run web:build 生成前端');
    }
    const ext = path.extname(fp).toLowerCase();
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(fp).pipe(res);
  } catch (e) {
    pushLog('err', '服务内部错误：' + String(e && e.message || e).slice(0, 160));
    try { fail(res, 500, '服务出了一点问题，已记录，请重试'); } catch {}
  }
});

process.on('uncaughtException', (e) => pushLog('err', '未捕获异常：' + String(e && e.message || e).slice(0, 160)));
process.on('unhandledRejection', (e) => pushLog('err', '未处理拒绝：' + String(e && e.message || e).slice(0, 160)));
process.on('SIGINT', () => { try { engine.stop(); } catch {} process.exit(0); });

if (!fs.existsSync(path.join(PUBLIC, 'index.html'))) pushLog('warn', '前端还没构建：请先执行 npm run web:build');

if (MOCK) {
  pushLog('ok', '本地服务已启动（mock 引擎，不连智慧树）');
  engine.start();
} else {
  pushLog('ok', '本地服务已启动（真实引擎，尚未开始听课）');
  pushLog('info', '点页面上的「开始听课」后才会启动浏览器');
}

server.listen(PORT, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + PORT + '/?t=' + TOKEN;
  console.log('\n  智慧树自动听课 · 本地服务已启动' + (MOCK ? '（mock）' : ''));
  console.log('  ' + url + '\n');
  try { fs.writeFileSync(path.join(DATA, 'server.url'), url); } catch {}
});
