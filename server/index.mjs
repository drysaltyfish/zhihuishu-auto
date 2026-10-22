/**
 * 本地服务入口（组合根）：把日志环、状态、引擎、SSE、路由拼起来。
 * HTTP 细节在 lib/http.mjs + lib/router.mjs，动作规则在 lib/actions.mjs，
 * 这里只做装配和每个接口几行的「校验 → 转给引擎 → 回执」。
 *   node server/index.mjs          真实引擎（Playwright worker 独占 Chrome）
 *   node server/index.mjs --mock    mock 引擎（自检/联调）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { initialState, applyPatch } from './state.mjs';
import { createMockEngine } from './mock-engine.mjs';
import { createRealEngine } from './real-engine.mjs';
import { createLogRing } from './lib/logs.mjs';
import { createHub } from './lib/sse.mjs';
import { createRouter } from './lib/router.mjs';
import { createConfigStore } from './lib/config.mjs';
import { runLlmCheck, SAMPLE_CHECK } from './lib/llm-check.mjs';
import { httpError, json, fail, serveStatic } from './lib/http.mjs';
import { resolveControl, actionPatch, requireRunning } from './lib/actions.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PUBLIC = path.join(HERE, 'public');
// 允许用 ZHS_DATA 指定数据目录（自检/多实例互不干扰；默认 ./data）
const DATA = process.env.ZHS_DATA ? path.resolve(process.env.ZHS_DATA) : path.join(ROOT, 'data');

const argv = process.argv.slice(2);
const argN = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const PORT = Number(argN('port', '8731'));
const MOCK = argv.includes('--mock');
const DEBUG = process.env.ZHS_DEBUG === '1';
const TOKEN = crypto.randomBytes(12).toString('hex');

fs.mkdirSync(DATA, { recursive: true });

/* ---------------- 日志 / 配置 / 状态 ---------------- */
let hub = null;
const logs = createLogRing({ dataDir: DATA, onChange: () => hub && hub.logsChanged() });
const config = createConfigStore({ dataDir: DATA, log: logs.push });
if (config.ensureTemplate()) logs.push('info', '已生成 data/config.json，填好 llm.apiKey 就能让模型答题');

const state = initialState();
state.mode = MOCK ? 'mock' : 'real';

/* ---------------- 引擎（契约：start() / ready() / control() / stop()） ---------------- */
const engine = MOCK
  ? createMockEngine(state, () => hub && hub.stateChanged(), logs.push)
  : createRealEngine({ state, emit: () => hub && hub.stateChanged(), pushLog: logs.push, dataDir: DATA });

/* ---------------- SSE ---------------- */
hub = createHub({ getState: () => state, getLogs: logs.list, log: logs.push });

/* ---------------- 接口实现 ---------------- */
function openEvents({ req, res }) { hub.addClient(req, res); }

function getState({ res }) { json(res, 200, state); }

function startTask({ res }) {
  if (state.phase !== 'IDLE' && state.phase !== 'STOPPED') throw httpError(409, '任务已经在运行了');
  applyPatch(state, { notice: '', phase: 'LAUNCHING', verifyHint: '' });
  hub.stateChanged();
  engine.start();
  // worker 真正 ready 后再把当前开关推过去（不再赌 1.5 秒；崩溃恢复后也会补上）
  engine.ready().then(() => engine.control('settings', {
    autoAnswer: state.answers.auto,
    autoAdvance: state.answers.advance,
  })).catch((e) => logs.push('warn', '推送开关失败：' + String((e && e.message) || e).slice(0, 120)));
  json(res, 200, { ok: true });
}

function controlTask({ res, body }) {
  const name = String(body.action || '');
  const r = resolveControl(name, { phase: state.phase, mock: MOCK, debug: DEBUG });
  if (!r.ok) throw httpError(r.status, r.message, r.hint);
  engine.control(name);
  const patch = actionPatch(name);
  if (patch) { applyPatch(state, patch); hub.stateChanged(); }
  json(res, 200, { ok: true });
}

function updateSettings({ res, body }) {
  const out = {};
  if (typeof body.autoAnswer === 'boolean') {
    out.autoAnswer = body.autoAnswer;
    applyPatch(state, { answers: { auto: body.autoAnswer } });
    logs.push('info', body.autoAnswer ? '已开启自动答题' : '已关闭自动答题（弹题会停下等你手动答）');
  }
  if (typeof body.autoAdvance === 'boolean') {
    out.autoAdvance = body.autoAdvance;
    applyPatch(state, { answers: { advance: body.autoAdvance } });
    logs.push('info', body.autoAdvance ? '已开启「看完自动跳下一节」' : '已关闭自动跳节（看完这一节会停下等你选）');
  }
  if (Object.keys(out).length) { engine.control('settings', out); hub.stateChanged(); }
  json(res, 200, { ok: true });
}

async function llmCheck({ res }) {
  const r = await runLlmCheck(config.llm());
  const detail = r.ok
    ? '选了 ' + r.letter + '（正确）'
    : (r.letter ? '选了 ' + r.letter + '（应为 ' + 'ABCDEFGH'[SAMPLE_CHECK.answerIdx] + '）' : r.why);
  logs.push(r.ok ? 'ok' : 'warn', '模型自检：' + detail + (r.ms ? ' · ' + r.ms + 'ms' : ''));
  json(res, 200, r);
}

function readCourses({ res }) {
  requireRunning(state, '先点「开始听课」，登录后才能读到你的课程');
  engine.control('courses');
  logs.push('info', '正在读取你的课程列表…');
  json(res, 200, { ok: true, courses: state.courses || [] });
}

function pickCourse({ res, body }) {
  const idx = Number(body.index);
  if (!Number.isInteger(idx) || idx < 0) throw httpError(400, '课程序号不对', '请刷新页面后重试');
  requireRunning(state, '先点「开始听课」再换课程');
  const pick = (state.courses || [])[idx];
  engine.control('course', { index: idx });
  logs.push('info', '按你的选择切换课程：' + (pick ? pick.name : '第 ' + (idx + 1) + ' 门'));
  applyPatch(state, { coursePicking: false });
  hub.stateChanged();
  json(res, 200, { ok: true });
}

function pickLesson({ res, body }) {
  const code = String(body.code || '');
  if (!/^\d+\.\d+$/.test(code)) throw httpError(400, '小节编号不对', '请刷新页面后重试');
  requireRunning(state, '先点「开始听课」，再选要看的小节');
  engine.control('lesson', { code });
  logs.push('info', '按你的选择切换小节：' + code);
  json(res, 200, { ok: true });
}

/* ---------------- 路由表 ---------------- */
const routes = [
  { path: '/api/events', methods: ['GET'], handler: openEvents },
  { path: '/api/state', methods: ['GET'], handler: getState },
  { path: '/api/start', methods: ['POST'], handler: startTask },
  { path: '/api/control', methods: ['POST'], handler: controlTask },
  { path: '/api/settings', methods: ['POST'], handler: updateSettings },
  { path: '/api/llmcheck', methods: ['GET'], handler: llmCheck },
  // 前端「刷新课程」用 POST、自检脚本用 GET，两种都收
  { path: '/api/courses', methods: ['GET', 'POST'], handler: readCourses },
  { path: '/api/course', methods: ['POST'], handler: pickCourse },
  { path: '/api/lesson', methods: ['POST'], handler: pickLesson },
];

const handleApi = createRouter({
  routes,
  token: TOKEN,
  log: logs.push,
  context: () => ({ state, engine, logs, config, hub, mock: MOCK, debug: DEBUG }),
});

/* ---------------- HTTP ---------------- */
const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://127.0.0.1'); }
  catch { return fail(res, 400, '请求地址不对'); }

  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);

  try {
    serveStatic(res, PUBLIC, url.pathname);
  } catch (e) {
    if (e && e.expose) return fail(res, e.status || 404, e.message, e.hint);
    logs.push('err', '静态文件读取失败：' + String((e && e.message) || e).slice(0, 160));
    try { if (!res.headersSent) fail(res, 500, '服务出了一点问题，已记录，请重试'); } catch {}
  }
});

process.on('uncaughtException', (e) => logs.push('err', '未捕获异常：' + String((e && e.message) || e).slice(0, 160)));
process.on('unhandledRejection', (e) => logs.push('err', '未处理拒绝：' + String((e && e.message) || e).slice(0, 160)));
process.on('SIGINT', () => {
  try { engine.stop(); } catch {}
  try { hub.stop(); } catch {}
  process.exit(0);
});

if (!fs.existsSync(path.join(PUBLIC, 'index.html'))) logs.push('warn', '前端还没构建：请先执行 npm run web:build');

if (MOCK) {
  logs.push('ok', '本地服务已启动（mock 引擎，不连智慧树）');
  engine.start();
} else {
  logs.push('ok', '本地服务已启动（真实引擎，尚未开始听课）');
  logs.push('info', '点页面上的「开始听课」后才会启动浏览器');
}

server.listen(PORT, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + PORT + '/?t=' + TOKEN;
  console.log('\n  智慧树自动听课 · 本地服务已启动' + (MOCK ? '（mock）' : ''));
  console.log('  ' + url + '\n');
  try { fs.writeFileSync(path.join(DATA, 'server.url'), url); } catch {}
});
