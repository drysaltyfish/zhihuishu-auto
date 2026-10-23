/**
 * 真实 worker：独占一个 Chrome，负责登录、选课、播放、弹题作答。
 * 铁律（见 docs/DESIGN.md）：
 *  1) 不在页面里注入任何 JS（不装 MutationObserver、不改 DOM）
 *  2) 点击只发生在真弹题时，只用 Playwright 真实输入（isTrusted=true）
 *  3) 平时只做低频只读采样
 * ZHS_DEBUG=1 时把弹窗结构/截图/接口响应存到 data/debug/，只用于排错。
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { askLLM as askLLMShared, askQuiz } from '../llm.mjs';
import { mergePoints, nearestPoint, markAnswered, nextQuestionOf, toStateList } from './lib/question-points.mjs';
import { chooseFallback, judge, labelOf, historyEntry } from './lib/answer-strategy.mjs';
import { DIALOG_BOX_CSS, PLAY_BUTTON_CSS } from './lib/page-scripts.mjs';
import { createProbe } from './lib/probe.mjs';
import { decide } from './lib/tick.mjs';
import { advanceFailStep, manualFixHint } from './lib/manual-fix.mjs';
import { saveCookies, loadCookies } from './lib/session-store.mjs';
import { createQuizRunner } from './lib/quiz-runner.mjs';
import { groupChapters, pickChapterToQuiz, quizListOf, platformDoneMap } from './lib/quiz-logic.mjs';
import { loadQuizzes, saveQuizzes } from './lib/quiz-store.mjs';

const DATA = process.env.ZHS_DATA || path.join(process.cwd(), 'data');
const PROFILE = path.join(DATA, 'profile');
const STATE_FILE = path.join(DATA, 'state.json');
const CONFIG_FILE = path.join(DATA, 'config.json');
const DEBUG = process.env.ZHS_DEBUG === '1';
const DEBUG_DIR = path.join(DATA, 'debug');
fs.mkdirSync(PROFILE, { recursive: true });
if (DEBUG) fs.mkdirSync(DEBUG_DIR, { recursive: true });

const send = (m) => {
  try {
    process.send(m);
  } catch {}
};
const log = (kind, msg) => send({ type: 'log', kind, msg: String(msg == null ? '' : msg) });
const patch = (p) => send({ type: 'state', patch: p });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toTimeString().slice(0, 8);

let ctx = null;
let page = null;
let started = false;
let userPaused = false;
let switchFails = 0; // 自动切节连续失败轮数（转人工的判据）
let manualPaused = false; // 转人工中：自动化暂停、浏览器窗口已打开，等人手动点一节
let stopped = false;
let questionPoints = [];
let autoAnswer = true;
let autoAdvance = true;
let dialogNotified = false;
let answerBusy = false;
let lastCt = 0;
let stallTicks = 0;
let lastVideoKey = '';
let lastUrl = '';
let endedLogged = false;
let pageInfoDumped = false;
let lastVideoSwitchAt = 0;
let lastPhase = 'PLAYING'; // 上一次推给前端的 phase（避免每秒重复发同一条）
let lastCookieSaveAt = 0; // 上次保存登录态的时间（Cookie 会滚动刷新，定期落盘）
let autoQuiz = true; // 自动做每章「平时测试」
let quizChapters = []; // 课程树按章归组（readCourseInfo 里更新）
let quizzes = {}; // 章节测试断点：{ [章节名]: {status,score,title,at,count,total,answered,note} }
let testDone = {}; // 课程树上标了「已交」的章节测试：{ [章节名]: true }
let lastQuizCheck = 0; // 上次检查「有没有该做的测试」的时间
let quizBusy = false; // 正在做测试（同一时间只跑一份）

/* ---------------- 配置（LLM 用） ---------------- */
const DEFAULT_CONFIG = {
  llm: {
    provider: 'deepseek',
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    timeoutMs: 20000,
  },
};
function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    const llm = { ...DEFAULT_CONFIG.llm, ...(raw.llm || {}) };
    return { llm };
  } catch {
    return { ...DEFAULT_CONFIG, llm: { ...DEFAULT_CONFIG.llm } };
  }
}
let CONFIG = loadConfig();

function readSavedUrl() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).resumeUrl || '';
  } catch {
    return '';
  }
}
function saveUrl(url) {
  try {
    const cur = (() => {
      try {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      } catch {
        return {};
      }
    })();
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...cur, resumeUrl: url, updatedAt: Date.now() }, null, 2));
  } catch {}
}
function dump(name, text) {
  if (!DEBUG) return;
  try {
    fs.writeFileSync(path.join(DEBUG_DIR, name), String(text));
  } catch {}
}
async function shot(name) {
  if (!DEBUG || !page || page.isClosed()) return;
  try {
    await page.screenshot({ path: path.join(DEBUG_DIR, name) });
  } catch {}
}

const CHROME_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
  '--autoplay-policy=no-user-gesture-required',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-session-crashed-bubble',
  '--window-size=1280,820',
  // 一启动就落在屏幕外（配合 win-window.ps1 的隐藏逻辑，避免闪一下）
  '--window-position=-32000,-32000',
];

/* ================= 只读采样 ================= */
// 页内提取脚本在 lib/page-scripts.mjs，frame 适配在 lib/probe.mjs；这里只留三个薄别名。
const probe = createProbe({ getPage: () => page });
const findDialog = () => probe.findDialog();
const findVideo = () => probe.findVideo();
const pageState = () => probe.pageState();

/* 章节测试执行器：点课程树的「平时测试」→ 新标签页逐题作答 → 提交 */
const quizRunner = createQuizRunner({
  getPage: () => page,
  getCtx: () => ctx,
  readTree: () => probe.readCourseTree(),
  log,
  patch,
  getLlm: () => CONFIG.llm,
  askQuiz,
  sleep,
  dump,
  shot,
  debug: DEBUG,
});

/* ================= 网络：只监听，不干预 ================= */
function attachNetwork(target) {
  target.on('request', (req) => {
    try {
      const u = req.url();
      if (/popupAnswer|PopupExam/i.test(u)) {
        const pd = (() => {
          try {
            return (req.postData() || '').slice(0, 800);
          } catch {
            return '';
          }
        })();
        log('info', '作答接口请求 ' + (req.method() + ' ' + u.split('?')[0].split('/').slice(-1)[0]));
        if (DEBUG) dump('req-' + Date.now() + '.txt', req.method() + ' ' + u + '\n\n' + pd);
      }
    } catch {}
  });
  target.on('response', async (resp) => {
    try {
      const u = resp.url();
      if (/loadVideoPointerInfo/i.test(u)) {
        const body = await resp.text().catch(() => '');
        dump('pointerinfo-' + Date.now() + '.json', body.slice(0, 20000));
        let j = {};
        try {
          j = JSON.parse(body || '{}');
        } catch {}
        const pts = (j && j.data && j.data.questionPoint) || [];
        const vkey = lastVideoKey || '';
        const newVideo = !!vkey && !!questionPointsKey && vkey !== questionPointsKey;
        const merged = mergePoints(questionPoints, pts, { newVideo });
        questionPoints = merged.points;
        if (merged.mode === 'merged') {
          questionPointsKey = vkey;
          patch({ questionPoints: toStateList(questionPoints), pointsLoaded: true });
          if (merged.changed)
            log(
              'ok',
              '本节弹题点：' + questionPoints.map((q) => q.timeSec + 's' + (q.answered ? '(已答)' : '')).join('、')
            );
          await applyPlaying();
        } else if (merged.mode === 'kept') {
          // 答完题后平台会再拉一次，可能回空列表：不能因此把前端的弹题点清空
          log('info', '平台这次没回弹题点（多半是已经答过），保留已读到的列表');
          patch({ pointsLoaded: true });
        } else {
          questionPointsKey = vkey;
          log('info', '本节没有弹题点');
          patch({ questionPoints: [], pointsLoaded: true });
        }
        return;
      }
      if (/popupAnswer|PopupExam|topic|exam/i.test(u)) {
        const body = await resp.text().catch(() => '');
        if (DEBUG) dump('resp-' + Date.now() + '.txt', u + '\n\n' + body.slice(0, 8000));
        if (/(save|commit|submit|answer)/i.test(u)) {
          let code = null;
          try {
            code = JSON.parse(body).code;
          } catch {}
          log('info', '作答接口返回 code=' + code);
        }
      }
    } catch {}
  });
}

/* 只挂监听，不改「当前页面」——助手标签页（读课程列表、探针）用完会关掉，
   绝不能因为它们关闭就把全局 page 指向一个死页面。 */
function watchPage(p) {
  if (!p || p.__watched) return p;
  p.__watched = true;
  p.on('framenavigated', (fr) => {
    try {
      if (fr !== p.mainFrame()) return;
      const u = p.url();
      if (u !== lastUrl) {
        log('info', '页面跳转：' + u.slice(0, 140));
        lastUrl = u;
      }
      if (/stuStudy/i.test(u)) saveUrl(u);
    } catch {}
  });
  p.on('close', () => {
    if (p !== page) return;
    if (started && !stopped) log('warn', '正在用的页面被关闭了');
    const live = ctx ? ctx.pages().filter((x) => !x.isClosed() && x !== p) : [];
    const next = live.find((x) => /stuStudy/i.test(x.url())) || live[0] || null;
    page = next;
    if (next) watchPage(next);
  });
  return p;
}

/** 指定「当前页面」 */
function setPage(p) {
  if (!p) {
    page = null;
    return;
  }
  page = p;
  watchPage(p);
}

/* ================= 用哪个浏览器 ================= */
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
].filter(Boolean);

function launchOptions(sandbox = true) {
  const opts = {
    headless: false,
    viewport: null,
    chromiumSandbox: sandbox,
    args: CHROME_ARGS,
    ignoreDefaultArgs: ['--enable-automation', '--no-startup-window'],
  };
  // 优先用系统 Chrome；机器上没有就回落到程序自带的 Chromium（PLAYWRIGHT_BROWSERS_PATH 指向 resources/browsers）
  const sys = CHROME_CANDIDATES.find((x) => {
    try {
      return fs.existsSync(x);
    } catch {
      return false;
    }
  });
  if (sys) {
    opts.channel = 'chrome';
    log('debug', '使用系统 Chrome：' + sys);
  } else log('info', '没有装 Google Chrome，改用程序自带的浏览器');
  return opts;
}

/* ================= 浏览器窗口：藏起来 / 叫出来 ================= */
// 不用 SW_HIDE/最小化：那样页面里 visibilityState 会变 hidden，既可能被反爬判定，
// 也会让后台计时器被节流。这里用「去掉任务栏按钮 + 移到屏幕外」，窗口仍算可见。
const WIN_HELPER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'win-window.ps1');
let browserHidden = process.platform === 'win32';

function winHelper(action) {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (!done) {
        done = true;
        resolve(ok);
      }
    };
    let ps;
    try {
      ps = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          WIN_HELPER,
          '-Action',
          action,
          '-ProfilePath',
          PROFILE,
        ],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
      );
    } catch {
      return finish(false);
    }
    let out = '';
    ps.stdout.on('data', (d) => {
      out += String(d);
    });
    ps.stderr.on('data', (d) => {
      out += String(d);
    });
    ps.on('error', () => finish(false));
    const timer = setTimeout(() => {
      try {
        ps.kill();
      } catch {}
      finish(false);
    }, 15000);
    ps.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0 && DEBUG) log('warn', '浏览器窗口操作没成功：' + out.replace(/\s+/g, ' ').slice(0, 160));
      finish(code === 0);
    });
  });
}

async function hideBrowserWindow(why) {
  if (process.platform !== 'win32') return false;
  browserHidden = true;
  const ok = await winHelper('hide');
  if (ok) {
    log('debug', '浏览器窗口已隐藏（任务栏也不显示）' + (why ? '：' + why : ''));
    patch({ browserVisible: false });
  }
  return ok;
}

async function showBrowserWindow(tip) {
  if (process.platform !== 'win32') {
    patch({ notice: '只有 Windows 上才能单独把浏览器窗口叫出来' });
    return false;
  }
  browserHidden = false;
  const ok = await winHelper('show');
  if (page && !page.isClosed()) {
    try {
      await page.bringToFront();
    } catch {}
  }
  if (ok) log('info', '浏览器窗口已打开，可以在里面手动登录或操作');
  else log('warn', '没找到浏览器窗口（可能已经关掉了）');
  patch({
    browserVisible: ok,
    notice: ok
      ? tip || '浏览器窗口已打开：在里面登录或点好课程后，回到这里点「继续」'
      : '没找到浏览器窗口，点「重启」再试一次',
  });
  return ok;
}

/* ================= 启动 / 登录 ================= */
async function launch() {
  patch({ phase: 'LAUNCHING' });
  log('info', '正在启动 Chrome…');
  // chromiumSandbox:true 只是让 Playwright 别自动塞 --no-sandbox（Chrome 会提示参数不支持）。
  // 但有的 Windows 环境（浏览器进程的父进程是 Electron、或系统安全策略较严）下 Chrome 沙箱起不来，
  // 表现为浏览器刚启动就退出（exitCode=2147483651）。这时退回 Playwright 默认的兼容模式再试一次。
  try {
    ctx = await chromium.launchPersistentContext(PROFILE, launchOptions(true));
  } catch (e) {
    const msg = String((e && e.message) || e);
    log('warn', '浏览器沙箱模式没起来，改用兼容模式重试：' + msg.split('\n')[0].slice(0, 120));
    ctx = await chromium.launchPersistentContext(PROFILE, launchOptions(false));
  }
  attachNetwork(ctx);
  // 智慧树的登录 Cookie 是会话 Cookie，Chrome 关掉就没了；启动时先把上次存的注入回去
  const saved = loadCookies(DATA);
  if (saved.length) {
    try {
      await ctx.addCookies(saved);
      log('info', '已恢复上次的登录态（' + saved.length + ' 个 Cookie），不用重新扫码');
    } catch (e) {
      log('warn', '恢复登录态失败：' + String((e && e.message) || e).slice(0, 120));
    }
  }
  setPage(ctx.pages()[0] || (await ctx.newPage()));
  ctx.on('page', (p) => {
    try {
      watchPage(p);
      if (!page || page.isClosed()) setPage(p);
      // 新标签页会自己冒到任务栏，等它画出来再藏一次
      if (browserHidden)
        setTimeout(() => {
          hideBrowserWindow('新标签页').catch(() => {});
        }, 900);
    } catch {}
  });
  // 窗口刚起来时 Chrome 会先画一帧，稍等一下再藏，避免屏幕上一闪
  await sleep(700);
  if (browserHidden) await hideBrowserWindow('启动时');
}

/** 把当前登录 Cookie 落盘（登录成功 / 定期 / 退出时各存一次） */
async function persistLogin(why) {
  if (!ctx) return 0;
  try {
    const n = saveCookies(DATA, await ctx.cookies());
    if (n) log('debug', '登录态已保存（' + n + ' 个 Cookie' + (why ? '，' + why : '') + '）');
    return n;
  } catch (e) {
    log('warn', '保存登录态失败：' + String((e && e.message) || e).slice(0, 120));
    return 0;
  }
}

async function hasLoginCookie() {
  try {
    const cs = await ctx.cookies();
    return cs.some((c) => /^(CASLOGC|jt-cas|SERVERID_CAS)$/i.test(c.name) && c.value && c.value.length > 10);
  } catch {
    return false;
  }
}

/* ---- 微信扫码登录：二维码截给前端显示，不用用户去浏览器窗口里找 ---- */
const QR_FILE = path.join(DATA, 'login-qr.png');
let qrAt = 0;

function clearLoginUi() {
  qrAt = 0;
  try {
    fs.rmSync(QR_FILE, { force: true });
  } catch {}
  patch({ loginNeeded: false, loginHint: '', qrUrl: '' });
}

function closeLoginDialog() {
  return (async () => {
    if (!page || page.isClosed()) return;
    try {
      const x = page.locator('.el-dialog__headerbtn, .el-dialog__close').first();
      if (await x.count()) {
        await x.click({ timeout: 3000 }).catch(() => {});
        await sleep(700);
      }
    } catch {}
  })();
}

/** 登录中心在 login.zhihuishu.com；从 onlineweb 进来会先经过 passport 再 302 过去，要等它跳完 */
const LOGIN_HOST_RE = /(login|passport)\.zhihuishu\.com/i;
async function waitLoginCenter(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms && !stopped) {
    if (!page || page.isClosed()) return false;
    if (/login\.zhihuishu\.com/i.test(page.url())) return true;
    // 有时地址还没变成 login.zhihuishu.com，但按钮已经在页面里了
    if (
      await page
        .locator('.login-by-wei')
        .count()
        .catch(() => 0)
    )
      return true;
    await sleep(500);
  }
  return false;
}

/** 打开登录中心 → 点「通过微信登录」→ 把二维码元素截到 data/login-qr.png → 让界面显示 */
async function ensureQrImage() {
  if (!page || page.isClosed()) return false;
  try {
    if (!LOGIN_HOST_RE.test(page.url())) {
      await page
        .goto('https://onlineweb.zhihuishu.com/', { waitUntil: 'domcontentloaded', timeout: 60000 })
        .catch(() => {});
    }
    // 从这里到登录中心要跳一两次（passport → login），别急着找按钮
    if (!(await waitLoginCenter(30000))) {
      log('warn', '没等到登录中心：' + String(page.url()).slice(0, 120));
      return false;
    }
    // 刚跳到登录中心时页面还在渲染，直接点会把按钮点空：等按钮真的可见再点
    await sleep(1500);
    // 弹窗已经开着就不用再点入口
    if (
      !(await page
        .locator('.wx-code-wrapper')
        .count()
        .catch(() => 0))
    ) {
      let entry = page.locator('.login-by-wei').first();
      if (!(await entry.count().catch(() => 0))) entry = page.getByText(/通过微信登录|微信登录/).first();
      if (!(await entry.count().catch(() => 0))) {
        log('warn', '登录中心里没找到「通过微信登录」按钮');
        return false;
      }
      await entry.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      try {
        await entry.click({ timeout: 8000 });
      } catch (e1) {
        try {
          await entry.click({ force: true, timeout: 8000 });
        } catch (e2) {
          log('warn', '点「通过微信登录」失败：' + String((e2 && e2.message) || e1).slice(0, 140));
        }
      }
      await sleep(2500);
    }
    const box = page.locator('.wx-code-wrapper').first();
    try {
      await box.waitFor({ state: 'visible', timeout: 25000 });
    } catch {
      log('warn', '二维码元素没出现，当前页：' + String(page.url()).slice(0, 120));
      return false;
    }
    await box.screenshot({ path: QR_FILE });
    qrAt = Date.now();
    patch({ loginNeeded: true, loginHint: '请用微信扫一扫下面的二维码登录智慧树', qrUrl: '/api/qr?v=' + Date.now() });
    log('info', '已把微信登录二维码送到界面，用手机微信扫码并确认即可');
    return true;
  } catch (e) {
    log('warn', '抓登录二维码失败：' + String((e && e.message) || e).slice(0, 140));
    return false;
  }
}

/** 二维码约 2 分钟就过期：关掉旧弹窗重新要一张 */
async function refreshQr(why) {
  if (!ctx) {
    patch({ notice: '还没启动：点「开始听课」会自动打开登录页' });
    return false;
  }
  if (await hasLoginCookie()) {
    clearLoginUi();
    return true;
  }
  await closeLoginDialog();
  const ok = await ensureQrImage();
  if (!ok) patch({ loginHint: '没拿到二维码：可以点「在浏览器窗口中登录」手动登录', qrUrl: '' });
  else if (why) log('info', '二维码已刷新（' + why + '）');
  return ok;
}

async function ensureLogin() {
  const url = page.url() || '';
  if (!/zhihuishu/i.test(url)) {
    await page.goto('https://www.zhihuishu.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  }
  if (await hasLoginCookie()) {
    log('ok', '检测到已登录');
    await persistLogin('启动时');
    clearLoginUi();
    return true;
  }
  patch({ phase: 'WAIT_LOGIN', loginNeeded: true, loginHint: '正在打开微信扫码登录…' });
  log('warn', '等待扫码登录…');
  await refreshQr('');
  const deadline = Date.now() + 20 * 60 * 1000;
  let nextQrTry = Date.now() + 15000;
  while (Date.now() < deadline && !stopped) {
    if (await hasLoginCookie()) {
      clearLoginUi();
      patch({ phase: 'COURSE_PICK' });
      log('ok', '登录成功，登录态已保存（下次不用再扫码）');
      await persistLogin('扫码登录成功');
      await sleep(1500);
      return true;
    }
    // 二维码会过期：约 95 秒换一张；如果一直没拿到就每 15 秒再试
    if (qrAt && Date.now() - qrAt > 95000) await refreshQr('二维码快过期了');
    else if (!qrAt && Date.now() > nextQrTry) {
      nextQrTry = Date.now() + 15000;
      await refreshQr('');
    }
    await sleep(1500);
  }
  patch({ phase: 'WAIT_LOGIN', loginHint: '登录超时，请点「重启」再试一次' });
  log('err', '登录超时');
  return false;
}

/* ================= 选课 ================= */
async function ensureCourse() {
  const saved = readSavedUrl();
  if (saved && (await gotoCourse(saved))) return true;
  // 浏览器窗口是藏起来的：不靠用户去窗口里点，改成把课程列表送到界面，等界面下指令
  patch({
    phase: 'COURSE_PICK',
    pickHint: '请在「选课」页选一门课；也可以点「在浏览器窗口中操作」自己点进去',
  });
  log('warn', '还没有上次的课程：打开「我的学堂」读课程列表…');
  try {
    await page.goto(LEARN_HOME, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(1500);
  } catch (e) {
    log('warn', '打开学堂页失败：' + String((e && e.message) || e).slice(0, 120));
  }
  await listCourses(true).catch(() => {});
  const deadline = Date.now() + 20 * 60 * 1000;
  let nextList = Date.now() + 60000;
  while (Date.now() < deadline && !stopped) {
    const u = (page && page.url()) || '';
    if (/stuStudy/i.test(u)) {
      saveUrl(u);
      patch({ phase: 'COURSE_PICK', pickHint: '' });
      log('ok', '已进入课程页');
      await sleep(3000);
      return true;
    }
    // 20 分钟里课程可能被学校新开/移出，隔一分钟刷新一次列表
    if (Date.now() > nextList) {
      nextList = Date.now() + 60000;
      listCourses(true).catch(() => {});
    }
    await sleep(1500);
  }
  log('err', '等待进入课程页超时');
  return false;
}

async function gotoCourse(url) {
  try {
    patch({ phase: 'COURSE_PICK', pickHint: '正在打开上次的课程…' });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(2500);
    if (/stuStudy/i.test(url === '' ? '' : page.url())) {
      log('ok', '已回到上次的课程');
      return true;
    }
  } catch (e) {
    log('warn', '上次的课程打不开了，改手动选课');
  }
  return false;
}

/** 课程树里的每一节（按平台列出的顺序） */
let lessons = [];
let courseInfo = {}; // 当前课程的 {name, school, chapter}，用于判断"选了同一门课"
let questionPointsKey = ''; // 弹题点是哪个视频（lastVideoKey）的

/** 只读地把课程/章节/课程树摘出来；顺带算出本章节、本课程的进度 */
async function readCourseInfo() {
  if (!page || page.isClosed()) return null;
  try {
    const info = await probe.readCourseTree();
    if (!info) return null;
    dump('pageinfo-' + Date.now() + '.json', JSON.stringify(info, null, 2));
    lessons = info.lessons || [];
    const course = {};
    if (info.courseName) course.name = info.courseName;
    if (info.chapter || info.lesson) course.chapter = [info.chapter, info.lesson].filter(Boolean).join(' / ');
    if (Object.keys(course).length) {
      courseInfo = { ...courseInfo, ...course };
      patch({ course });
    }

    const cur = lessons.find((l) => l.current) || null;
    const sumOf = (arr) => {
      let w = 0;
      let t = 0;
      for (const l of arr) {
        if (!l.durSec) continue;
        t += l.durSec;
        const p = l.pct != null ? l.pct : l.doneAttr ? 100 : 0;
        w += Math.round((l.durSec * p) / 100);
      }
      return { watched: w, total: t, pct: t ? Math.round((w / t) * 100) : null };
    };
    const inChapter = cur ? lessons.filter((l) => l.chapter === cur.chapter) : [];
    quizChapters = groupChapters(lessons);
    testDone = platformDoneMap(info && info.tests);
    patch({
      lessons: lessons.map((l) => ({
        code: l.code,
        name: l.name,
        pct: l.pct,
        durText: l.durText,
        durSec: l.durSec,
        current: l.current,
        chapter: l.chapter,
        done: l.doneAttr,
      })),
      summary: { chapter: sumOf(inChapter), course: sumOf(lessons) },
      quizzes: quizListOf(quizChapters, quizzes, testDone),
      quizChapters: quizChapters.map((c) => ({ chapter: c.chapter, total: c.total, done: c.done, allDone: c.allDone })),
    });
    if (DEBUG)
      log(
        'debug',
        '课程树：' +
          lessons.length +
          ' 节，已完成 ' +
          lessons.filter((l) => l.doneAttr).length +
          ' 节；当前 ' +
          (cur
            ? cur.code +
              ' ' +
              cur.name +
              '（' +
              (cur.doneAttr ? '已完成' : cur.pct == null ? '未开始' : cur.pct + '%') +
              '）'
            : '未识别')
      );
    return info;
  } catch (e) {
    log('warn', '读取课程信息失败（忽略）');
    return null;
  }
}

/** 点课程树里的某一节（真实点击） */
let switching = false;

async function clickLesson(code) {
  if (!page || page.isClosed()) return false;
  if (switching) return false;
  switching = true;
  try {
    // 弹题弹窗会盖住课程树，先把它关掉再点，否则鼠标点在遮罩上
    const dlg = await findDialog();
    if (dlg) {
      log('info', '先关掉挡住的弹题，再切小节');
      await closeDialog(dlg);
      await sleep(700);
    }
    const already = lessons.find((l) => l.current);
    if (already && already.code === code) {
      switching = false;
      log('info', '已经在 ' + code + ' 这一节，不用切');
      return true;
    }
    const before = lastVideoKey;
    const lis = page.locator('li.video');
    const n = await lis.count();
    let box = null;
    let hitText = '';
    for (let i = 0; i < n; i++) {
      const el = lis.nth(i);
      const t = ((await el.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
      if (!t.startsWith(code + ' ')) continue;
      hitText = t.slice(0, 40);
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await sleep(300);
      box = await el.boundingBox().catch(() => null);
      break;
    }
    if (!box) {
      log('warn', '课程树里没找到/看不到 ' + code);
      switching = false;
      return false;
    }
    // 必须是真实鼠标事件（isTrusted=true）：平台对脚本合成的 click 会报「检测到异常脚本」
    for (let attempt = 1; attempt <= 3; attempt++) {
      await page.mouse.click(box.x + Math.min(40, Math.max(12, box.width / 2)), box.y + box.height / 2);
      log(
        'info',
        '已用真实鼠标点课程树 ' + code + '（' + hitText + '）' + (attempt > 1 ? ' · 第 ' + attempt + ' 次' : '')
      );
      for (let k = 0; k < 12; k++) {
        await sleep(700);
        const fv = await findVideo();
        if (fv) {
          const key = fv.v.src + '|' + Math.round(fv.v.dur);
          if (before && key !== before) {
            lastVideoKey = key;
            lastCt = fv.v.ct;
            await sleep(1500);
            await readCourseInfo();
            log('ok', '已切到 ' + code + '，时长 ' + Math.round(fv.v.dur) + 's，从 ' + Math.round(fv.v.ct) + 's 继续');
            switching = false;
            await applyPlaying();
            return true;
          }
        }
      }
      log('warn', '点了 ' + code + ' 但视频没变，重试');
      const dlg2 = await findDialog();
      if (dlg2) {
        await closeDialog(dlg2);
        await sleep(600);
      }
      const box2 = await lis
        .nth(0)
        .count()
        .catch(() => 0);
      if (!box2) break;
    }
    const nowUrl = page && !page.isClosed() ? page.url() : '';
    log('warn', '点了 ' + code + ' 但视频始终没变' + (nowUrl ? '（当前页面：' + nowUrl.slice(0, 120) + '）' : ''));
    await shot('clickfail-' + Date.now() + '.png');
  } catch (e) {
    log('warn', '点课程树失败：' + String((e && e.message) || e).slice(0, 120));
  }
  switching = false;
  return false;
}

/** 平台的反脚本提示（合成事件/自动化环境会触发） */
async function detectAbnormal() {
  return probe.detectAbnormal();
}

let lastRecoverAt = 0;
let lastStudyUrl = '';
let frozenCt = -1;
let frozenTicks = 0;
let verifyPending = false;
let verifySince = 0;

/** 人机验证：平台风控弹出「请完成安全验证」点选验证码，AI 不硬刚，转人工点掉后自动继续
 *  注意腾讯 tcaptcha 的 iframe 是常驻的，平时被放到 y=-1000000，必须判断「在屏幕内」才算弹出 */
async function detectVerify() {
  return probe.detectVerify();
}

async function pauseVideoQuiet() {
  await probe.pauseVideoQuiet();
}

/** 被平台判定异常后：重新进入视频页，接着看 */
async function recoverFromAbnormal(why) {
  if (Date.now() - lastRecoverAt < 30000) return false;
  lastRecoverAt = Date.now();
  log('err', '平台弹出了反脚本提示（' + why + '）——正在重新进入视频页');
  patch({ phase: 'RECOVERING', notice: '平台提示检测到脚本，正在重新进入视频页（不影响已看进度）' });
  await shot('abnormal-' + Date.now() + '.png');
  try {
    const url = lastStudyUrl && lastStudyUrl.includes('stuStudy') ? lastStudyUrl : page && page.url();
    if (!url) return false;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(3000);
    const fv = await findVideo();
    if (fv) {
      lastVideoKey = fv.v.src + '|' + Math.round(fv.v.dur);
      lastCt = fv.v.ct;
      await readCourseInfo();
      await applyPlaying();
      patch({ phase: 'PLAYING', notice: '' });
      log('ok', '已重新进入视频页，继续播放');
      return true;
    }
    log('warn', '重新进入后没找到视频，等你手动点一下');
    patch({ phase: 'COURSE_PICK', pickHint: '重新进入后没自动找到视频，请点进要听的节' });
  } catch (e) {
    log('err', '重新进入失败：' + String((e && e.message) || e).slice(0, 140));
  }
  return false;
}

/** 下一节该看哪：优先「看了一半的」，其次「没开始的」 */
function pickAutoLesson() {
  const rest = lessons.filter((l) => !l.current && l.durSec > 0);
  const partial = rest.filter((l) => !l.doneAttr && l.pct != null && l.pct > 0 && l.pct < 100);
  if (partial.length) return partial[0];
  const fresh = rest.filter((l) => !l.doneAttr && (l.pct == null || l.pct === 0));
  if (fresh.length) return fresh[0];
  return null;
}

/** 当前这一节是不是已经看完了：平台不再弹题、也不该再重看 */
function currentLooksDone() {
  const cur = lessons.find((l) => l.current);
  if (!cur) return false;
  if (cur.doneAttr) return true;
  if (cur.pct != null && cur.pct >= 100) return true;
  return false;
}

let lastLessonCheck = 0;
let allDoneNotified = false;
let noKeyWarned = false;

/** 本节已完成（或播完）→ 自动点下一节没看完的；返回 true 表示做了切换 */
async function maybeAdvanceLesson(force) {
  if (switchingCourse) return false;
  if (!page || page.isClosed()) return false;
  if (!autoAdvance) return false;
  if (manualPaused) return false; // 已经转人工：等用户手动点好再继续
  if (!force && Date.now() - lastLessonCheck < 15000) return false;
  lastLessonCheck = Date.now();
  const cur = lessons.find((l) => l.current);
  if (!cur) return false;
  const looksDone = currentLooksDone();
  if (!looksDone && !force) return false;
  if (!looksDone) log('info', '平台还没把这一节标记成已完成，但视频已经播完，按播完处理');
  const nxt = pickAutoLesson();
  if (!nxt) {
    if (!allDoneNotified) {
      allDoneNotified = true;
      log('ok', '这门课的可见小节都看完了，没有可自动切换的下一节');
      patch({ phase: 'ENDED', notice: '这门课能自动听的节都听完了（剩下的可能需要手动处理）' });
    }
    return false;
  }
  log(
    'ok',
    '本节 ' +
      (cur.code || '?') +
      ' 已看完，自动切到 ' +
      nxt.code +
      '（' +
      (nxt.pct == null ? '还没开始' : nxt.pct + '%') +
      '）'
  );
  patch({ notice: '本节已看完，正在切到 ' + nxt.code + ' ' + nxt.name });
  const ok = await clickLesson(nxt.code);
  if (ok) {
    switchFails = 0;
    await applyPlaying();
    patch({ notice: '' });
    lastLessonCheck = Date.now();
    return true;
  }
  // 点了没反应：连续失败到阈值就退位让贤，把浏览器窗口叫出来让人手动点
  const step = advanceFailStep(switchFails);
  switchFails = step.fails;
  if (step.escalate) {
    await enterManualFix(nxt.code, '连续 ' + switchFails + ' 轮点了没反应');
  } else {
    log('warn', '切到 ' + nxt.code + ' 没成功，下一轮再试（连续 ' + switchFails + ' 轮失败就转人工）');
    patch({ notice: '切到 ' + nxt.code + ' 没成功，再试一次' });
  }
  return false;
}

/** 自动切节反复失败：别再硬试，暂停自动化并把浏览器窗口叫出来，让人手动点好一节再点「继续」 */
async function enterManualFix(code, reason) {
  if (manualPaused) return;
  manualPaused = true;
  userPaused = true; // 让主循环按「用户暂停」处理：不自动切节、也不自动恢复播放
  try {
    await pauseVideoQuiet();
  } catch {}
  const tip = manualFixHint(code, reason);
  log('warn', '自动切节转人工：' + reason);
  patch({ phase: 'PAUSED', manualHint: tip, notice: tip });
  const shown = await showBrowserWindow(tip);
  if (!shown) patch({ manualHint: tip + '（没找到浏览器窗口，请点「重启」后再试一次）' });
}

/* ================= 播放 ================= */
async function ensurePlaying() {
  const fv = await findVideo();
  if (!fv) return false;
  if (!fv.v.paused) return true;
  if (await findDialog()) return false;
  await probe.playInFrame(fv.frame);
  for (const sel of PLAY_BUTTON_CSS) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 800 })) {
        await loc.click({ timeout: 2000 });
        break;
      }
    } catch {}
  }
  await sleep(1200);
  const fv2 = await findVideo();
  return !!(fv2 && !fv2.v.paused);
}

async function applyPlaying() {
  if (!page || page.isClosed()) return;
  await ensurePlaying();
}

/* ================= LLM 答题 ================= */
// 真正的请求逻辑在 server/llm.mjs（服务端 /api/llmcheck 也用它，两边行为一致）
async function askLLM(d) {
  return askLLMShared(CONFIG.llm, { question: d.title, options: d.options });
}

/* ================= 弹题作答 ================= */
async function dumpDialogDetail(fd, tag) {
  if (!DEBUG) return;
  try {
    const info = await probe.dialogHtml(fd.frame);
    if (!info) return;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    dump('dialog-' + tag + '-' + ts + '.html', '<!-- frame: ' + info.frameUrl + ' -->\n' + info.html);
    await shot('dialog-' + tag + '-' + ts + '.png');
    log('debug', '弹窗结构已存盘：dialog-' + tag + '-' + ts);
  } catch {}
}

function dialogBox(frame) {
  return frame.locator(DIALOG_BOX_CSS).first();
}

/** 点某个选项（真实点击；点完平台会自动提交） */
async function clickOption(fd, idx) {
  const box = dialogBox(fd.frame);
  const opts = box.locator('ul.topic-list > li.topic-item');
  const n = await opts.count();
  if (!n) return { ok: false, why: '选项定位为 0' };
  const i = Math.max(0, Math.min(idx, n - 1));
  try {
    await opts.nth(i).click({ timeout: 5000 });
    return { ok: true, clicked: i };
  } catch (e) {}
  try {
    await opts.nth(i).locator('.item-topic').click({ timeout: 3000 });
    return { ok: true, clicked: i };
  } catch (e) {}
  return { ok: false, why: '点击失败' };
}

/** 关闭弹窗：先点页脚「关闭」，再退而点右上角 × */
async function closeDialog(fd) {
  const box = dialogBox(fd.frame);
  const tries = [
    box.locator('.el-dialog__footer .btn, .dialog-footer .btn').first(),
    box.locator('.el-dialog__footer button, .dialog-footer button').first(),
    box.locator('button.el-dialog__headerbtn').first(),
  ];
  for (const loc of tries) {
    try {
      if ((await loc.count()) && (await loc.isVisible().catch(() => false))) {
        await loc.click({ timeout: 3000 });
        await sleep(600);
        if (!(await findDialog())) return '已关闭';
      }
    } catch {}
  }
  return (await findDialog()) ? '没关掉' : '已关闭';
}

async function handleDialog(st) {
  if (answerBusy) return;
  answerBusy = true;
  try {
    let fd = { frame: st.dialogFrame, d: st.dialog };
    let d = st.dialog;
    log(
      'warn',
      '弹题出现：' +
        (d.type || '题目') +
        '，选项 ' +
        d.optionCount +
        ' 个，第 ' +
        d.pageIndex +
        '/' +
        d.pages +
        ' 页，已作答=' +
        (d.answered ? '是' : '否')
    );
    log('info', '题面：' + (d.title || '').slice(0, 200));
    patch({ phase: 'ANSWERING', video: { paused: true } });
    await dumpDialogDetail(fd, 'open');

    if (!d.optionCount) {
      log('err', '弹窗里读不到选项，已停下等你手动答（不乱点）');
      patch({ phase: 'PAUSED', notice: '弹题结构没识别到，已停下等你手动处理' });
      return;
    }

    // 没配 API Key 时不要乱答：弹题的作答会记在平台成绩里，宁可停下等你
    if (!d.answered && !(CONFIG.llm && CONFIG.llm.apiKey)) {
      if (!noKeyWarned) {
        noKeyWarned = true;
        log('warn', '弹题出现了，但还没配置答题用的 API Key —— 先不答（乱答会影响成绩）');
      }
      patch({ phase: 'PAUSED', notice: '弹题等你：还没配答题用的 API Key，填好 Key 就能自动答' });
      return;
    }

    await sleep(1200 + Math.random() * 1800);

    // 逐个题目页处理
    for (let round = 0; round < 6; round++) {
      d = (await findDialog()) ? (await findDialog()).d : null;
      if (!d) {
        log('ok', '弹窗已关闭');
        break;
      }
      fd = await findDialog();
      const pt = nearestPoint(questionPoints, lastCt);
      if (d.answered) {
        log('info', '这题已提交（' + (d.feedback || '已答') + '，' + (d.answerText || '') + '），直接关闭');
      } else {
        let chosenIdx = 0;
        let how = '随机';
        const res = await askLLM(d);
        if (res.ok) {
          chosenIdx = res.idx;
          how = 'LLM';
          log('ok', 'LLM 选择 ' + (d.options[chosenIdx].label || chosenIdx) + '（模型回：' + res.raw + '）');
        } else {
          chosenIdx = chooseFallback(d.options).idx;
          log('info', '随机选择（' + res.why + '）：' + (d.options[chosenIdx].label || chosenIdx + 1));
        }
        const click = await clickOption(fd, chosenIdx);
        if (!click.ok) {
          log('err', '选项点不动：' + click.why);
          patch({ phase: 'PAUSED', notice: '选项点不动，已停下' });
          return;
        }

        // 等提交结果（平台点选项即提交，随后出现 正确/错误 + 正确答案）
        let after = null;
        for (let i = 0; i < 20; i++) {
          await sleep(400);
          const now = await findDialog();
          if (!now) {
            after = null;
            break;
          }
          if (now.d.answered) {
            after = now.d;
            break;
          }
        }
        if (after) {
          const chosenLabel = labelOf(d.options[chosenIdx]);
          const correctLabel = labelOf({ label: after.answerText });
          const right = judge(chosenLabel, correctLabel);
          log(
            right ? 'ok' : 'warn',
            (right ? '答对了' : '答错了') +
              '（我选 ' +
              (chosenLabel || '?') +
              '，正确答案 ' +
              (correctLabel || '?') +
              '），开始关闭弹窗'
          );
          await dumpDialogDetail(fd, 'answered');
          recordAnswer(pt, d, chosenIdx, how, right, after.answerText);
        } else {
          log('info', '弹窗已消失（可能平台自动关闭）');
          recordAnswer(pt, d, chosenIdx, how, null, '');
        }
      }

      // 还有下一页未答的题目？
      const cur = await findDialog();
      if (!cur) break;
      if (cur.d.hasNextPage) {
        try {
          await dialogBox(cur.frame).locator('.btn-next').first().click({ timeout: 2000 });
          log('info', '弹题有下一页，已翻页');
          await sleep(1200);
          continue;
        } catch {}
      }
      const closed = await closeDialog(cur);
      log(closed === '已关闭' ? 'ok' : 'warn', '关闭弹窗：' + closed);
      await sleep(800);
      if (!(await findDialog())) break;
    }

    const stillOpen = await findDialog();
    if (stillOpen) {
      log('warn', '弹窗还在。当前内容：' + String(stillOpen.d.title || '').slice(0, 200));
      await dumpDialogDetail(stillOpen, 'stuck');
      patch({ phase: 'PAUSED', notice: '弹窗没被关掉，已停下等你手动处理' });
    } else {
      patch({ phase: 'PLAYING' });
      await ensurePlaying();
    }
  } catch (e) {
    log('err', '作答过程出错：' + String((e && e.message) || e).slice(0, 200));
    patch({ phase: 'PAUSED' });
  } finally {
    answerBusy = false;
  }
}

const history = [];
function recordAnswer(pt, d, chosenIdx, how, right, answerText) {
  questionPoints = markAnswered(questionPoints, pt);
  history.unshift(historyEntry({ point: pt, dialog: d, chosenIdx, how, right, answerText, at: stamp() }));
  if (history.length > 20) history.length = 20;
  patch({
    questionPoints: toStateList(questionPoints),
    nextQuestion: nextQuestionOf(questionPoints, lastCt),
    answers: {
      auto: autoAnswer,
      advance: autoAdvance,
      count: history.length,
      strategy: CONFIG.llm && CONFIG.llm.apiKey ? 'llm' : 'random',
      right: history.filter((h) => h.right).length,
    },
    history: history.slice(),
  });
}

/* 决策里说的「动作」在这里变成真正的 I/O（决策本身在 lib/tick.mjs，纯函数） */
async function runEffect(e, st) {
  try {
    if (e.type === 'resetPoints') {
      questionPoints = [];
      questionPointsKey = '';
      patch({ pointsLoaded: false });
      return;
    }
    if (e.type === 'readCourseInfo') {
      await readCourseInfo();
      return;
    }
    if (e.type === 'shot') {
      await shot(e.name);
      return;
    }
    if (e.type === 'ensurePlaying') {
      await ensurePlaying();
      return;
    }
    if (e.type === 'advance') {
      const ok = await maybeAdvanceLesson(!!e.force);
      // 已转人工时别再打「本节播完、没找到下一节」的兜底补丁，否则界面会从暂停跳成 ENDED，「继续」按钮就没了
      if (!ok && e.onFalse && !manualPaused) patch(e.onFalse);
      return;
    }
    if (e.type === 'recoverPage') {
      await recoverPage();
      return;
    }
    if (e.type === 'handleDialog') {
      await handleDialog(st);
      return;
    }
  } catch (err) {
    log('warn', '动作执行失败（已忽略）：' + e.type + ' ' + String((err && err.message) || err).slice(0, 120));
  }
}

/* ================= 主循环 ================= */
async function loop() {
  if (stopped) return;
  if (switchingCourse) {
    setTimeout(loop, 1500);
    return;
  }
  try {
    try {
      const u = page && !page.isClosed() ? page.url() : '';
      if (u.includes('stuStudy')) lastStudyUrl = u;
    } catch {}
    const ab = await detectAbnormal();
    if (ab) {
      await recoverFromAbnormal(ab);
      if (!stopped) setTimeout(loop, 2500);
      return;
    }
    if (switchingCourse) {
      setTimeout(loop, 1500);
      return;
    }

    // 人机验证：检测到就停下等人点，点完自动恢复播放
    const vfy = await detectVerify();
    if (vfy) {
      if (!verifyPending) {
        verifyPending = true;
        verifySince = Date.now();
        await pauseVideoQuiet();
        await shot('verify-' + Date.now() + '.png');
        log('warn', '智慧树弹出人机验证（' + vfy.slice(0, 40) + '）——请在浏览器窗口里点掉，我在这里等你');
        patch({
          phase: 'WAIT_VERIFY',
          verifyHint: vfy.slice(0, 90),
          notice: '智慧树要求人机验证：请在浏览器窗口点掉「请完成安全验证」，点完自动继续',
        });
      }
      if (!stopped) setTimeout(loop, 2000);
      return;
    }
    if (verifyPending) {
      verifyPending = false;
      log('ok', '人机验证已通过，继续听课');
      patch({ phase: 'PLAYING', verifyHint: '', notice: '人机验证已通过，继续听课' });
      await applyPlaying();
    }

    const st = await pageState();
    const plan = decide(
      { video: st.video, dialog: st.dialog },
      {
        lastVideoKey,
        lastCt,
        endedLogged,
        stallTicks,
        frozenCt,
        frozenTicks,
        dialogNotified,
        pageInfoDumped,
        noVideoTicks,
        lastVideoSwitchAt,
        lastPhase,
      },
      { userPaused, autoAnswer, autoAdvance }
    );
    ({
      lastVideoKey,
      lastCt,
      endedLogged,
      stallTicks,
      frozenCt,
      frozenTicks,
      dialogNotified,
      pageInfoDumped,
      noVideoTicks,
      lastVideoSwitchAt,
      lastPhase,
    } = plan.mem);
    for (const p of plan.patches) patch(p);
    for (const l of plan.logs) log(l.kind, l.msg);
    for (const e of plan.effects) await runEffect(e, st);
    // 章节测试在后台跑，不挡住主循环（视频还在播，弹题也还要答）
    if (!quizBusy) {
      const pending = maybeAutoQuiz();
      if (pending && pending.catch) pending.catch(() => {});
    }
    if (Date.now() - lastCookieSaveAt > 180000) {
      lastCookieSaveAt = Date.now();
      await persistLogin('定期');
    }
  } catch (e) {
    log('err', '主循环异常（已忽略）：' + String((e && e.message) || e).slice(0, 200));
  }
  if (!stopped) setTimeout(loop, 1000);
}

/* ================= 指令 ================= */

/* ========== 页面丢失自愈 ========== */
let noVideoTicks = 0;
let lastPageRecoverAt = 0;

async function recoverPage() {
  if (Date.now() - lastPageRecoverAt < 20000) return;
  lastPageRecoverAt = Date.now();
  try {
    const live = ctx ? ctx.pages().filter((x) => !x.isClosed()) : [];
    let target = live.find((x) => /stuStudy/i.test(x.url())) || null;
    if (!target && lastStudyUrl) {
      log('warn', '浏览器里没有课程页，重新打开上次的课程页…');
      target = await ctx.newPage();
      await target.goto(lastStudyUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    if (!target) {
      log('warn', '没有可以恢复的页面，等你手动点进课程');
      return;
    }
    setPage(target);
    await sleep(2500);
    saveUrl(page.url());
    await readCourseInfo();
    await applyPlaying();
    noVideoTicks = 0;
    patch({ phase: 'PLAYING', pickHint: '', notice: '' });
    log('ok', '页面已恢复：' + page.url().slice(0, 100));
  } catch (e) {
    log('warn', '恢复页面失败：' + String((e && e.message) || e).slice(0, 140));
  }
}

/* ========== 选课程（整个课，不是小节） ========== */
const LEARN_HOME = 'https://onlineweb.zhihuishu.com/onlinestuh5';
let courses = [];
let switchingCourse = false;
const helperPages = new Set(); // 读课程列表/探针用的临时标签页，切课时不能误关
let coursesAt = 0;

/** 在后台标签页里读「我的学堂」的课程卡片；不动正在播放的页面 */
async function listCourses(notify) {
  if (!ctx) return courses;
  let tab = null;
  try {
    tab = await ctx.newPage();
    helperPages.add(tab);
    await tab.goto(LEARN_HOME, { waitUntil: 'domcontentloaded', timeout: 60000 });
    let found = false;
    for (let i = 0; i < 25; i++) {
      const n = await tab
        .locator('.item-left-course')
        .count()
        .catch(() => 0);
      if (n > 0) {
        found = true;
        break;
      }
      await sleep(1000);
    }
    if (!found) {
      dump(
        'learnhome-fail-' + Date.now() + '.json',
        JSON.stringify(
          { url: tab.url(), text: (await tab.evaluate(() => document.body.innerText || '')).slice(0, 1200) },
          null,
          2
        )
      );
      await shot('learnhome-fail-' + Date.now() + '.png');
      throw new Error('学堂页面里没找到课程卡片（可能没登录或页面改版），已存 data/debug 供排查');
    }
    const list = await probe.readCourseList(tab);
    if (list.length) {
      courses = list;
      coursesAt = Date.now();
    }
    if (notify) patch({ courses, coursesAt });
    log(
      'ok',
      '读到 ' +
        list.length +
        ' 门课：' +
        list.map((c) => c.name + (c.pct != null ? '（' + c.pct + '%）' : '')).join('、')
    );
    return list;
  } catch (e) {
    log('warn', '读课程列表失败：' + String((e && e.message) || e).slice(0, 160));
    if (notify) patch({ notice: '课程列表没读到，可能是网络慢或没登录，过一会儿再点「刷新」' });
    return courses;
  } finally {
    if (tab) helperPages.delete(tab);
    try {
      if (tab && !tab.isClosed()) await tab.close();
    } catch {}
  }
}

/** 切到第 index 门课：进学堂页，用真实鼠标点那张课程卡片，等它打开课程视频页 */
async function switchCourse(index) {
  if (switchingCourse) return false;
  switchingCourse = true;
  try {
    return await switchCourseInner(index);
  } finally {
    switchingCourse = false;
  }
}

async function switchCourseInner(index) {
  const n = Number(index);
  if (!Number.isInteger(n) || n < 0) {
    log('warn', '课程序号不对');
    return false;
  }
  try {
    if (!courses.length) await listCourses(false);
    const want = courses[n];
    if (!want) {
      patch({ notice: '没有这门课，先点「刷新课程」' });
      return false;
    }
    // 选的就是当前在听的课：什么都不做（以前会重新点卡片、把播放页换成新标签 → 视频回退）
    const curName = (courseInfo && courseInfo.name) || '';
    const sameName =
      !!want.name && !!curName && (want.name === curName || curName.includes(want.name) || want.name.includes(curName));
    if (sameName && lessons.length) {
      log('info', '你选的就是当前在听的「' + want.name + '」，保持不动');
      patch({ phase: 'PLAYING', pickHint: '', notice: '已经在听「' + want.name + '」，不用切' });
      return true;
    }
    log('info', '正在切换课程…');
    patch({ phase: 'COURSE_PICK', pickHint: '正在切换到所选课程…' });
    if (!page || page.isClosed()) {
      const live = ctx.pages().filter((x) => !x.isClosed());
      if (!live.length) throw new Error('浏览器里没有可用页面了');
      setPage(live.find((x) => /stuStudy/i.test(x.url())) || live[0]);
      log('warn', '原来的播放页已经关了，改用现有页面继续：' + page.url().slice(0, 100));
    }
    const navTab = page;
    await page.goto(LEARN_HOME, { waitUntil: 'domcontentloaded', timeout: 60000 });
    let ok = false;
    for (let i = 0; i < 25; i++) {
      if (
        await page
          .locator('.item-left-course .courseName')
          .count()
          .catch(() => 0)
      ) {
        ok = true;
        break;
      }
      await sleep(1000);
    }
    if (!ok) throw new Error('学堂页面没加载出课程卡片');
    const nameEl = page.locator('.item-left-course .courseName').nth(n);
    const shown = (await nameEl.innerText().catch(() => '')).trim();
    if (shown && want.name && !shown.startsWith(want.name.slice(0, 6)))
      log('warn', '第 ' + (n + 1) + ' 张卡片是「' + shown + '」，不是「' + want.name + '」，按页面顺序点');
    await nameEl.scrollIntoViewIfNeeded();
    const box = await nameEl.boundingBox();
    if (!box) throw new Error('课程卡片不可见');
    await page.mouse.click(box.x + Math.min(60, box.width / 2), box.y + box.height / 2);
    log('info', '已用真实鼠标点课程卡片「' + (shown || want.name) + '」，等它打开课程页…');
    let target = null;
    for (let i = 0; i < 45; i++) {
      const ps = ctx.pages().filter((x) => !x.isClosed());
      target = ps.find((x) => /stuStudy/i.test(x.url())) || null;
      if (target) break;
      await sleep(1000);
    }
    if (!target) {
      log('warn', '点了课程卡片，但没等到课程视频页');
      patch({ phase: 'PLAYING', pickHint: '', notice: '切课没成功，可能被别的弹窗挡住了，再点一次试试' });
      return false;
    }
    if (navTab && navTab !== target && !navTab.isClosed()) {
      try {
        await navTab.close();
      } catch {}
    }
    for (const x of ctx.pages()) {
      if (x === target || x.isClosed() || helperPages.has(x)) continue;
      if (/stuStudy/i.test(x.url())) {
        try {
          await x.close();
        } catch {}
      }
    }
    setPage(target);
    await sleep(3000);
    saveUrl(page.url());
    lessons = [];
    lastVideoKey = '';
    questionPoints = [];
    endedLogged = false;
    await readCourseInfo();
    patch({ phase: 'PLAYING', pickHint: '', notice: '已切到「' + (want.name || '新课') + '」' });
    await applyPlaying();
    log('ok', '已切到课程「' + (want.name || '') + '」');
    return true;
  } catch (e) {
    log('err', '切换课程失败：' + String((e && e.message) || e).slice(0, 200));
    patch({ phase: 'PLAYING', pickHint: '', notice: '切换课程没成功，请再试一次' });
    return false;
  }
}

/* ========== 一次性探针：摸清「学堂/我的课程」页面的结构（调试用） ========== */
/** 探针：把页面上所有可能是人机验证的东西（iframe/容器）连同位置尺寸存盘，用来精确判定，避免误判常驻 iframe */
async function probeVerify() {
  const out = { url: page && !page.isClosed() ? page.url() : '', frames: [], iframes: [], boxes: [] };
  try {
    const main = page.mainFrame();
    out.iframes = await main.evaluate(() =>
      Array.from(document.querySelectorAll('iframe')).map((f) => {
        const r = f.getBoundingClientRect();
        return {
          src: (f.getAttribute('src') || '').slice(0, 200),
          cls: f.className,
          id: f.id,
          w: Math.round(r.width),
          h: Math.round(r.height),
          x: Math.round(r.left),
          y: Math.round(r.top),
          vis: r.width > 0 && r.height > 0,
        };
      })
    );
    out.boxes = await main.evaluate(() => {
      const sels = [
        '.el-dialog__wrapper',
        '.el-dialog',
        '[class*="verify"]',
        '[class*="captcha"]',
        '[class*="yidun"]',
        '[class*="geetest"]',
        '[class*="nc_"]',
        '[id*="captcha"]',
        '[id*="verify"]',
      ];
      const seen = new Set();
      const arr = [];
      for (const s of sels)
        for (const e of document.querySelectorAll(s)) {
          if (seen.has(e)) continue;
          seen.add(e);
          const r = e.getBoundingClientRect();
          arr.push({
            sel: s,
            cls: (e.className || '').toString().slice(0, 120),
            id: e.id,
            w: Math.round(r.width),
            h: Math.round(r.height),
            x: Math.round(r.left),
            y: Math.round(r.top),
            text: (e.innerText || '').replace(/\s+/g, ' ').slice(0, 80),
          });
        }
      return arr.slice(0, 60);
    });
  } catch (e) {
    out.err = String((e && e.message) || e);
  }
  for (const f of page.frames()) {
    try {
      out.frames.push({ url: f.url().slice(0, 160), name: f.name() });
    } catch {}
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  dump('verifyprobe-' + ts + '.json', JSON.stringify(out, null, 1));
  await shot('verifyprobe-' + ts + '.png');
  log('info', '验证码探针已存盘：verifyprobe-' + ts);
}

async function probeLearnHome() {
  let tab = null;
  try {
    log('info', '探针：打开学堂页看看课程列表长什么样…');
    tab = await ctx.newPage();
    helperPages.add(tab);
    await tab.goto('https://www.zhihuishu.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(6000);
    const first = await tab.evaluate(() => {
      const out = [];
      for (const a of document.querySelectorAll('a[href]')) {
        const t = (a.innerText || '').trim();
        if (/学习空间|我的课程|学堂|进入学习/.test(t)) out.push({ text: t.slice(0, 40), href: a.href });
      }
      return out.slice(0, 10);
    });
    log('debug', '探针：首页候选入口 ' + JSON.stringify(first).slice(0, 400));
    const target = (first.find((x) => /学习空间|我的课程|学堂/.test(x.text)) || {}).href;
    if (target) {
      await tab.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await sleep(9000);
    }
    const url = tab.url();
    const report = await tab.evaluate(() => {
      const txt = (e) => (e && (e.innerText || '').replace(/\s+/g, ' ').trim()) || '';
      const links = [];
      for (const a of document.querySelectorAll('a[href]')) {
        const h = a.href || '';
        if (/recruitAndCourseId|stuStudy|course/i.test(h))
          links.push({ text: txt(a).slice(0, 60), href: h.slice(0, 300) });
      }
      const cards = [];
      for (const el of document.querySelectorAll('[class*="course" i], [class*="card" i], li')) {
        const t = txt(el);
        if (!t || t.length > 300) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 80 || r.height < 40) continue;
        cards.push({
          tag: el.tagName,
          cls: String(el.className || '').slice(0, 100),
          text: t.slice(0, 160),
          href: (el.querySelector('a[href]') || {}).href || '',
        });
      }
      const res = performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .filter((u) => /course|recruit|study|learn|home/i.test(u))
        .slice(0, 80);
      const ls = {};
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          const v = localStorage.getItem(k);
          if (v && v.length < 3000 && /course|recruit|study|user/i.test(k)) ls[k] = v.slice(0, 1500);
        }
      } catch {}
      const cookieNames = document.cookie
        .split(';')
        .map((x) => x.trim().split('=')[0])
        .filter(Boolean);
      return { links: links.slice(0, 60), cards: cards.slice(0, 60), res, ls, cookieNames };
    });
    /* 试验：真实鼠标点第一张课程卡片，看它会把我们带到哪里 */
    try {
      const nameEl = tab.locator('.item-left-course .courseName').first();
      if (await nameEl.count()) {
        const nm = (await nameEl.innerText()).trim();
        await nameEl.scrollIntoViewIfNeeded();
        const box = await nameEl.boundingBox();
        if (box) {
          const before = ctx.pages().map((x) => x.url());
          await tab.mouse.click(box.x + Math.min(60, box.width / 2), box.y + box.height / 2);
          log('debug', '探针：点了课程卡片「' + nm + '」，等跳转…');
          await sleep(8000);
          const after = ctx.pages().filter((x) => !x.isClosed());
          const fresh =
            after.find((x) => !before.includes(x.url())) || after.find((x) => /stuStudy|course/i.test(x.url()));
          log(
            'debug',
            '探针：点击后标签页 ' + after.length + ' 个，URL=' + after.map((x) => x.url().slice(0, 120)).join(' | ')
          );
          if (fresh && fresh !== tab) {
            const fu = fresh.url();
            log('debug', '探针：新标签页 URL=' + fu);
            await sleep(3000);
            try {
              dump('learnhome-afterclick' + '.html', await fresh.content());
            } catch {}
            const info = await fresh.evaluate(() => ({
              url: location.href,
              text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 800),
            }));
            dump('learnhome-afterclick.json', JSON.stringify(info, null, 2));
            /* 探针绝不关页面：曾经因此把主播放页关掉，导致主循环报「页面已关闭」 */
          } else {
            const info = await tab.evaluate(() => ({
              url: location.href,
              text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 800),
            }));
            log('debug', '探针：点完后当前页 URL=' + info.url);
            dump('learnhome-afterclick.json', JSON.stringify(info, null, 2));
            dump('learnhome-afterclick.html', await tab.content());
          }
        }
      } else {
        log('warn', '探针：没找到课程卡片');
      }
    } catch (e) {
      log('warn', '探针：点课程卡片测试失败 ' + String((e && e.message) || e).slice(0, 160));
    }

    const payload = { url, first, ...report };
    const name = 'learnhome-' + new Date().toISOString().replace(/[:.]/g, '-');
    dump(name + '.json', JSON.stringify(payload, null, 2));
    try {
      dump(name + '.html', await tab.content());
    } catch {}
    log(
      'ok',
      '探针：学堂页已存盘 ' + name + '.json（入口 ' + report.cards.length + ' 个、链接 ' + report.links.length + ' 条）'
    );
  } catch (e) {
    log('err', '探针失败：' + String((e && e.message) || e).slice(0, 200));
  } finally {
    try {
      if (tab && !tab.isClosed()) await tab.close();
    } catch {}
  }
}

/* ========== 章节测试（平时测试） ========== */
function quizListNow() {
  return quizListOf(quizChapters, quizzes, testDone);
}

/** 跑一章的平时测试：跑之前先落「正在做」，避免重启后又挑同一章 */
async function runQuiz(key) {
  if (quizBusy) return { ok: false, note: '已经在做测试了' };
  if (!started || stopped || !page || page.isClosed()) return { ok: false, note: '还没开始听课' };
  const target = quizChapters.find((c) => c.key === key);
  const title = (quizzes[key] && quizzes[key].title) || ((target && target.chapter) || key) + '·平时测试';
  quizBusy = true;
  quizzes[key] = { ...(quizzes[key] || {}), status: 'doing', title, at: Date.now() };
  saveQuizzes(DATA, quizzes);
  patch({
    quizzes: quizListNow(),
    quiz: { running: true, key, title, i: 0, n: null, answered: 0, strategy: '', last: null, result: null, error: '' },
  });
  log('info', '开始做「' + title + '」的章节测试');
  try {
    const res = await quizRunner.run(key);
    const prev = quizzes[key] || {};
    if (res && res.status === 'already') {
      // 平台说这份已经交过了：记成 done（和别的章节一样不再重做），顺便把课程树的标记也刷新
      quizzes[key] = {
        ...prev,
        status: 'done',
        title: res.title || title,
        score: res.score == null ? null : res.score,
        total: res.total == null ? null : res.total,
        count: res.count == null ? null : res.count,
        answered: res.answered || 0,
        at: Date.now(),
        note: res.note || '平台显示这份测试已经交过',
        source: 'platform',
      };
      if (res.chapter && res.chapter !== key) testDone[res.chapter] = true;
      testDone[key] = true;
      const scoreText = res.score == null ? '' : '（得分 ' + res.score + (res.total ? '/' + res.total : '') + '）';
      patch({
        quiz: { running: false, result: null },
        notice: '章节测试「' + (res.title || title) + '」之前已经交过了' + scoreText + '，跳过',
      });
      log('ok', '章节测试「' + (res.title || title) + '」之前已经交过' + scoreText + '，跳过');
    } else if (res && res.ok) {
      quizzes[key] = {
        ...prev,
        status: 'done',
        title: res.title || title,
        score: res.score == null ? null : res.score,
        total: res.total == null ? null : res.total,
        count: res.count == null ? null : res.count,
        answered: res.answered || 0,
        at: Date.now(),
        note: res.note || '',
      };
      const scoreText = res.score == null ? '已提交' : '得分 ' + res.score + (res.total ? '/' + res.total : '') + ' 分';
      patch({
        quiz: {
          running: false,
          result: {
            score: res.score == null ? null : res.score,
            total: res.total == null ? null : res.total,
            text: scoreText,
          },
        },
        notice: '章节测试「' + (res.title || title) + '」' + scoreText,
      });
      log('ok', '章节测试「' + (res.title || title) + '」完成，' + scoreText);
    } else {
      quizzes[key] = { ...prev, status: 'failed', title, at: Date.now(), note: (res && res.note) || '没做完' };
      patch({
        quiz: { running: false, error: (res && res.note) || '没做完' },
        notice: '章节测试「' + title + '」没自动完成：' + ((res && res.note) || '原因未知'),
      });
      log('warn', '章节测试「' + title + '」没完成：' + ((res && res.note) || ''));
    }
  } catch (e) {
    quizzes[key] = {
      ...(quizzes[key] || {}),
      status: 'failed',
      title,
      at: Date.now(),
      note: String((e && e.message) || e).slice(0, 120),
    };
    patch({ quiz: { running: false, error: String((e && e.message) || e).slice(0, 120) } });
    log('err', '章节测试出错：' + String((e && e.message) || e).slice(0, 160));
  } finally {
    quizBusy = false;
    saveQuizzes(DATA, quizzes);
    patch({ quizzes: quizListNow() });
    // 做完一份，课程树/测试状态可能变了，重新读一次
    readCourseInfo().catch(() => {});
  }
}

/** 主循环里定期看看有没有「整章都看完、还没做」的测试 */
async function maybeAutoQuiz() {
  if (!autoQuiz || quizBusy || !started || stopped || userPaused) return;
  if (!quizChapters.length) return;
  if (Date.now() - lastQuizCheck < 8000) return;
  lastQuizCheck = Date.now();
  const cur = lessons.find((l) => l.current) || null;
  const target = pickChapterToQuiz(quizChapters, quizListNow(), cur && cur.chapter);
  if (!target) return;
  await runQuiz(target.key);
}

async function doStart() {
  if (started) return;
  started = true;
  try {
    CONFIG = loadConfig();
    quizzes = loadQuizzes(DATA);
    lastQuizCheck = 0;
    patch({ quizAuto: autoQuiz, quizzes: quizListNow(), quiz: { running: false } });
    if (!CONFIG.llm.apiKey)
      log(
        'warn',
        '没有配置答题用的 API Key：弹题出现时会停下等你手动答（在 data/config.json 填 llm.apiKey 可启用自动答题）'
      );
    await launch();
    if (!(await ensureLogin())) {
      stopped = true;
      return;
    }
    if (!(await ensureCourse())) {
      stopped = true;
      return;
    }
    patch({ phase: 'PLAYING' });
    await readCourseInfo();
    await applyPlaying();
    log('ok', '开始听课');
    loop();
    setTimeout(() => {
      try {
        listCourses(true);
      } catch {}
    }, 4000);
  } catch (e) {
    patch({ phase: 'STOPPED', notice: '启动失败：' + String((e && e.message) || e).slice(0, 120) });
    log('err', '启动失败：' + String((e && e.message) || e).slice(0, 300));
  }
}

async function doQuit() {
  stopped = true;
  await persistLogin('退出前');
  try {
    if (ctx) await ctx.close();
  } catch {}
  ctx = null;
  page = null;
  started = false;
  patch({ phase: 'STOPPED', video: { paused: true }, browserVisible: false });
  log('info', '已退出，断点已保存');
}

process.on('message', async (m) => {
  try {
    if (!m || m.type !== 'cmd') return;
    if (m.cmd === 'start') {
      if (started) return;
      stopped = false;
      userPaused = false;
      manualPaused = false;
      switchFails = 0;
      await doStart();
    } else if (m.cmd === 'pause') {
      userPaused = true;
      patch({ phase: 'PAUSED' });
      try {
        await pauseVideoQuiet();
      } catch {}
      log('info', '已暂停');
    } else if (m.cmd === 'resume') {
      userPaused = false;
      // 用户手动点好节后点「继续」：清掉转人工状态，自动化从当前节接着跑
      const wasManual = manualPaused;
      manualPaused = false;
      switchFails = 0;
      patch({ phase: 'PLAYING', manualHint: '', notice: '' });
      if (wasManual) {
        endedLogged = false; // 允许再试一轮自动切节；再失败还会重新转人工
        try {
          await readCourseInfo(); // 人工可能换了节，重新对一遍当前是哪一节
        } catch {}
      }
      await applyPlaying();
      log('info', wasManual ? '已继续（人工修复后）' : '已继续');
    } else if (m.cmd === 'restart') {
      log('info', '正在重启…');
      await doQuit();
      stopped = false;
      userPaused = false;
      manualPaused = false;
      switchFails = 0;
      started = false;
      questionPoints = [];
      lastVideoKey = '';
      endedLogged = false;
      pageInfoDumped = false;
      verifyPending = false;
      verifySince = 0;
      qrAt = 0;
      clearLoginUi();
      patch({ verifyHint: '', pointsLoaded: false, manualHint: '' });
      await doStart();
    } else if (m.cmd === 'quit') {
      await doQuit();
      setTimeout(() => process.exit(0), 300);
    } else if (m.cmd === 'lesson') {
      const code = m.data && m.data.code;
      if (code) {
        log('info', '按你的选择切到 ' + code);
        let ok = await clickLesson(code);
        if (!ok && !switching) {
          log('info', '切换没成功，3 秒后再试一次');
          await sleep(3000);
          ok = await clickLesson(code);
        }
        if (ok) {
          const wasManual = manualPaused;
          manualPaused = false;
          switchFails = 0;
          if (wasManual) userPaused = false; // 人工修复完（手动选了节）就恢复自动化
          await applyPlaying();
          patch({ manualHint: '', notice: '已切到 ' + code });
        } else {
          log('warn', '切换小节 ' + code + ' 没成功');
          patch({ notice: '切到 ' + code + ' 没成功，可能被弹题或页面挡住了，再点一次试试' });
        }
      }
    } else if (m.cmd === 'courses') {
      await listCourses(true);
    } else if (m.cmd === 'course') {
      await switchCourse(m.data && m.data.index);
    } else if (m.cmd === 'verifyprobe') {
      await probeVerify();
    } else if (m.cmd === 'probe') {
      await probeLearnHome();
    } else if (m.cmd === 'quiz') {
      // 手动做某一章的测试：key 为空就挑下一个该做的
      let key = m.data && m.data.key;
      if (key === '__retry') {
        // 手动重试：把失败状态清掉，让自动挑章重新看上它
        for (const k of Object.keys(quizzes))
          if (quizzes[k] && quizzes[k].status === 'failed') quizzes[k].status = 'todo';
        saveQuizzes(DATA, quizzes);
        patch({ quizzes: quizListNow() });
        key = '';
      }
      if (!key) {
        const cur = lessons.find((l) => l.current) || null;
        const target = pickChapterToQuiz(quizChapters, quizListNow(), cur && cur.chapter);
        key = target && target.key;
      }
      if (!key) {
        log('info', '没有需要做的章节测试了');
        patch({ notice: '没有需要做的章节测试了（要么没看完，要么都做过了）' });
      } else if (quizBusy) {
        patch({ notice: '正在做另一份测试，等这份做完再试' });
      } else if (m.data && m.data.dry) {
        // 调试用：把整份试卷填一遍但不点提交（答案会被平台暂存，之后正式跑会整份覆盖）
        quizBusy = true;
        quizRunner
          .run(key, { noSubmit: true })
          .then((r) => log('info', '干跑完成（没有提交）：' + JSON.stringify(r)))
          .catch((e) => log('err', '干跑出错：' + String((e && e.message) || e).slice(0, 160)))
          .finally(() => {
            quizBusy = false;
          });
      } else runQuiz(key).catch((e) => log('err', '手动做测试失败：' + String((e && e.message) || e).slice(0, 160)));
    } else if (m.cmd === 'showBrowser') {
      await showBrowserWindow();
    } else if (m.cmd === 'hideBrowser') {
      const ok = await hideBrowserWindow('你的操作');
      if (ok) patch({ notice: '浏览器窗口已隐藏（它还在后台继续听课）' });
    } else if (m.cmd === 'refreshQr') {
      await refreshQr('你点的刷新');
    } else if (m.cmd === 'settings') {
      if (m.data && typeof m.data.autoAnswer === 'boolean') autoAnswer = m.data.autoAnswer;
      if (m.data && typeof m.data.autoAdvance === 'boolean') autoAdvance = m.data.autoAdvance;
      if (m.data && typeof m.data.quizAuto === 'boolean') {
        autoQuiz = m.data.quizAuto;
        patch({ quizAuto: autoQuiz });
      }
      if (
        m.data &&
        typeof m.data.autoAnswer !== 'boolean' &&
        typeof m.data.autoAdvance !== 'boolean' &&
        typeof m.data.quizAuto !== 'boolean'
      )
        autoAnswer = !!m.data;
      CONFIG = loadConfig();
      patch({
        answers: {
          auto: autoAnswer,
          advance: autoAdvance,
          strategy: CONFIG.llm && CONFIG.llm.apiKey ? 'llm' : 'random',
        },
      });
    }
  } catch (e) {
    log('err', '指令处理失败：' + String((e && e.message) || e).slice(0, 200));
  }
});

process.on('uncaughtException', (e) => log('err', '未捕获异常：' + String((e && e.message) || e).slice(0, 200)));
process.on('unhandledRejection', (e) => log('err', '未处理拒绝：' + String((e && e.message) || e).slice(0, 200)));

if (DEBUG) log('info', '调试模式已开启：弹窗结构/截图会存到 data/debug/');
send({ type: 'ready' });
