
/**
 * SPIIKE 探针：验证三件事
 *  A. 后台/离屏 + 三件套 flag 下，HLS 视频能否稳定推进 10 分钟（时间轴 vs 墙钟）
 *  B. 页面是否察觉 CDP（documentElement 是否为 null / readyState 卡住 / 是否上报 collector2c）
 *  C. 弹题的 DOM 形态、启发式作答后视频的反应（继续 / 回退重播 / 重新弹）
 *
 * 用法:
 *   node spike/src/probe.mjs --url "<stuStudy URL>" --minutes 10 --rate 1.25 [--visible]
 * 不带 --url 时，登录后等你手动点进课程（页面 URL 出现 /stuStudy 即开始）。
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = path.resolve(HERE, '..', '..');
const DATA = path.join(ROOT, 'spike', 'data');
const LOGS = path.join(ROOT, 'spike', 'logs');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(LOGS, { recursive: true });

// ---------- args ----------
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const PLAY_URL = arg('url', '');
const MINUTES = Number(arg('minutes', '10'));
const RATE = Number(arg('rate', '1.25'));
const VISIBLE = argv.includes('--visible');
const OFFSET_X = Number(arg('x', '-2600'));

const TS = new Date().toISOString().replace(/[:.]/g, '-');
const JSONL = path.join(LOGS, 'probe-' + TS + '.jsonl');
const SUMMARY = path.join(LOGS, 'probe-' + TS + '.summary.json');

const t0 = Date.now();
const rec = [];
function log(kind, data = {}) {
  const row = { t: +((Date.now() - t0) / 1000).toFixed(2), clock: new Date().toISOString(), kind, ...data };
  rec.push(row);
  fs.appendFileSync(JSONL, JSON.stringify(row) + '\n');
  if (['phase', 'alert', 'dialog', 'detect', 'error', 'summary'].includes(kind)) {
    const brief = JSON.stringify(data).slice(0, 400);
    console.log('[' + row.t + 's] ' + kind.toUpperCase() + ' ' + brief);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const counters = {
  samples: 0, collectorPosts: 0, navAway: 0, videoPauseEvents: 0, rewinds: 0,
  dialogs: 0, answered: 0, learningSaves: 0, popupApi: 0, frozen: 0, stalls: 0,
};

// ---------- main ----------
let context = null;
async function main() {
  log('phase', { msg: 'start', playUrl: PLAY_URL || '(manual)', minutes: MINUTES, rate: RATE, visible: VISIBLE });

  context = await chromium.launchPersistentContext(path.join(DATA, 'chrome-profile'), {
    channel: 'chrome',
    headless: false,
    viewport: null,
    args: [
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
      '--autoplay-policy=no-user-gesture-required',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      '--window-size=1280,820',
    ],
    ignoreDefaultArgs: ['--enable-automation', '--no-startup-window'],
  });

  let page = context.pages()[0] || (await context.newPage());
  context.on('page', (p) => log('phase', { msg: 'new page', url: p.url() }));

  // ---------- A. 登录 ----------
  log('phase', { msg: 'navigate zhihuishu home' });
  await page.goto('https://www.zhihuishu.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => log('error', { where: 'goto home', msg: String(e).slice(0, 300) }));

  log('phase', { msg: 'WAITING_FOR_LOGIN — 请在弹出的 Chrome 窗口里扫码登录（限时 8 分钟）' });
  const loggedIn = await waitLogin(context, 8 * 60 * 1000);
  log('phase', { msg: loggedIn ? 'LOGIN_OK' : 'LOGIN_TIMEOUT' });
  if (!loggedIn) { await finish('login_not_ok'); return; }

  // ---------- B. 进入播放页 ----------
  if (PLAY_URL) {
    log('phase', { msg: 'goto play url', url: PLAY_URL });
    await page.goto(PLAY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => log('error', { where: 'goto play', msg: String(e).slice(0, 300) }));
  } else {
    log('phase', { msg: 'WAITING_FOR_COURSE — 请在这个窗口里点进课程，直到视频播放页（URL 含 stuStudy）' });
    const ok = await waitFor(() => /stuStudy/i.test(page.url()) && !/login/i.test(page.url()), 10 * 60 * 1000, 1500);
    log('phase', { msg: ok ? 'COURSE_PAGE_OK' : 'COURSE_PAGE_TIMEOUT', url: page.url() });
    if (!ok) { await finish('course_not_ok'); return; }
  }
  await sleep(6000);
  log('phase', { msg: 'play page ready', url: page.url(), frames: page.frames().length });

  // ---------- B2. 确保视频真的在播 ----------
  const playing = await ensureVideoPlaying(page);
  log('phase', { msg: playing ? 'PLAYING' : 'NOT_PLAYING_AFTER_RETRY' });

  attachNetwork(page);
  attachPageEvents(page);

  // ---------- C. 离屏（不可见） ----------
  if (!VISIBLE) {
    await moveOffscreen(page, OFFSET_X, 0);
  } else {
    log('phase', { msg: 'skip offscreen (visible mode)' });
  }

  // ---------- D. 采样循环 ----------
  log('phase', { msg: 'sampling start', every: 5000 });
  await sampleLoop(page);

  await finish('ok');
}

async function ensureVideoPlaying(page) {
  const end = Date.now() + 90000;
  let tries = 0;
  while (Date.now() < end) {
    tries++;
    const st = await page.evaluate(() => {
      const vids = Array.from(document.querySelectorAll('video'));
      const v = vids.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0];
      if (!v) return { found: false, n: vids.length };
      return { found: true, n: vids.length, paused: v.paused, ct: Number(v.currentTime.toFixed(2)), dur: Number((v.duration || 0).toFixed(1)) };
    }).catch((e) => ({ found: false, err: String(e).slice(0, 120) }));
    log('phase', { msg: 'ensurePlaying probe', tries, st });
    if (st.found && !st.paused && st.ct > 0) return true;
    if (st.found) {
      await page.evaluate(() => {
        document.querySelectorAll('video').forEach((v) => { if (v.paused) v.play().catch(() => {}); });
      }).catch(() => {});
      for (const sel of ['.play-btn', '.vjs-big-play-button', '.prism-big-play-btn', '.controls-play']) {
        const b = page.locator(sel).first();
        try { if (await b.count() && await b.isVisible()) { await b.click({ timeout: 2500 }); log('phase', { msg: 'clicked play btn', sel }); break; } } catch {}
      }
    }
    await sleep(3000);
  }
  return false;
}

function attachNetwork(page) {
  page.on('request', (req) => {
    const u = req.url();
    try {
      if (/collector2c|collect/i.test(u)) {
        counters.collectorPosts++;
        log('alert', { msg: 'collector request', url: u.slice(0, 300), method: req.method() });
      }
      if (/popupAnswer|popup/i.test(u)) { counters.popupApi++; log('alert', { msg: 'popup api', url: u.slice(0, 300), method: req.method() }); }
      if (/\/learning\//.test(u)) { counters.learningSaves++; log('alert', { msg: 'learning api', url: u.slice(0, 300), method: req.method() }); }
    } catch {}
  });
  page.on('requestfailed', (req) => {
    if (/collect/i.test(req.url())) log('alert', { msg: 'collector request FAILED (blocked?)', url: req.url().slice(0, 200) });
  });
  page.on('response', async (res) => {
    const u = res.url();
    try {
      if (/popupAnswer\/lessonPopupExam|loadVideoPointerInfo/i.test(u)) {
        const txt = await res.text().catch(() => '');
        log('dialog', { msg: 'popup api response', url: u.slice(0, 200), status: res.status(), body: txt.slice(0, 3000) });
      }
      if (/saveLessonPopupExamSaveAnswer/i.test(u)) {
        const txt = await res.text().catch(() => '');
        log('dialog', { msg: 'popup answer saved', status: res.status(), body: txt.slice(0, 800) });
      }
    } catch {}
  });
}

function attachPageEvents(page) {
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) {
      const u = f.url();
      log('alert', { msg: 'MAIN FRAME NAVIGATED', url: u.slice(0, 300) });
      if (!/stuStudy|zhihuishu/i.test(u)) counters.navAway++;
    }
  });
  page.on('pageerror', (e) => log('error', { where: 'pageerror', msg: String(e).slice(0, 500) }));
  page.on('console', (m) => {
    const t = m.text();
    if (/error|fail|cheat|debug|detect/i.test(t)) log('detect', { msg: 'console', type: m.type(), text: t.slice(0, 300) });
  });
  page.on('crash', () => log('alert', { msg: 'PAGE CRASHED' }));
}

async function moveOffscreen(page, x, y) {
  try {
    const cdp = await page.context().newCDPSession(page);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: x, top: y, width: 1280, height: 820, windowState: 'normal' } });
    log('phase', { msg: 'moved offscreen', x, y });
    await cdp.detach().catch(() => {});
  } catch (e) {
    log('error', { where: 'moveOffscreen', msg: String(e).slice(0, 300) });
  }
}

// 每 5s 采样：页面自检 + 视频状态
const SAMPLES = [];
async function sampleLoop(page) {
  const deadline = Date.now() + MINUTES * 60 * 1000;
  let last = null;
  let dialogHandledTs = 0;

  while (Date.now() < deadline) {
    const s = await sampleOnce(page).catch((e) => ({ err: String(e).slice(0, 200) }));
    counters.samples++;
    SAMPLES.push(s);

    if (s && !s.err) {
      if (s.frozen) counters.frozen++;
      if (last && s.ct !== null && last.ct !== null) {
        if (s.ct < last.ct - 1.5) { counters.rewinds++; log('alert', { msg: 'VIDEO REWOUND', from: last.ct, to: s.ct }); }
        if (!s.paused && s.ct - last.ct < 0.2) { counters.stalls++; }
      }
      if (s.dialogVisible && Date.now() - dialogHandledTs > 20000) {
        counters.dialogs++;
        dialogHandledTs = Date.now();
        log('dialog', { msg: 'DIALOG DETECTED', text: (s.dialogText || '').slice(0, 1500), pagers: s.pagers, options: s.options });
        await answerDialog(page, s).catch((e) => log('error', { where: 'answerDialog', msg: String(e).slice(0, 300) }));
      }
      if (counters.samples % 6 === 0) log('phase', { msg: 'tick', ct: s.ct, rate: s.rate, paused: s.paused, vis: s.vis, ready: s.ready });
      last = s;
    } else if (s && s.err) {
      log('error', { where: 'sample', msg: s.err });
    }
    await sleep(5000);
  }
}

async function sampleOnce(page) {
  const r = await page.evaluate(() => {
    const out = {};
    const ttx = document.title;
    out.title = String(ttx || '').slice(0, 80);
    out.vis = document.visibilityState;
    out.hidden = document.hidden;
    out.ready = document.readyState;
    out.htmlNull = document.documentElement === null;
    try { out.focus = document.hasFocus(); } catch (e) { out.focus = null; }
    try {
      out.webdriver = navigator.webdriver;
      const st = (new Error()).stack || '';
      out.stackHasPptr = /pptr|playwright|puppeteer/i.test(st);
    } catch (e) {}
    // 视频
    const vids = Array.from(document.querySelectorAll('video'));
    const v = vids.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0];
    if (v) {
      out.ct = Number(v.currentTime.toFixed(2));
      out.dur = Number((v.duration || 0).toFixed(2));
      out.paused = v.paused;
      out.rate = v.playbackRate;
      out.rs = v.readyState;
      out.w = v.videoWidth; out.h = v.videoHeight;
      try {
        const b = v.buffered;
        out.bufferedEnd = b.length ? Number(b.end(b.length - 1).toFixed(1)) : 0;
      } catch (e) {}
    } else { out.ct = null; out.videoCount = vids.length; }
    // 弹题
    const dlg = document.querySelector('#playTopic-dialog');
    if (dlg) {
      const st = getComputedStyle(dlg);
      const box = dlg.getBoundingClientRect();
      out.dialogVisible = st.display !== 'none' && st.visibility !== 'hidden' && Number(st.opacity) > 0.1 && box.width > 50 && box.height > 30;
      if (out.dialogVisible) {
        out.dialogText = (dlg.innerText || '').replace(/\s+/g, ' ').slice(0, 1200);
        out.pagers = Array.from(dlg.querySelectorAll('.el-pager .number')).map((n) => n.textContent.trim());
        out.options = Array.from(dlg.querySelectorAll('ul.topic-item')).map((u) => (u.innerText || '').replace(/\s+/g, ' ').slice(0, 200));
      }
    } else out.dialogVisible = false;
    return out;
  }).catch((e) => ({ err: String(e).slice(0, 200) }));
  if (r && r.err) return r;
  if (r) {
    r.bs = Math.round((Date.now() - t0) / 1000);
    r.expectedCt = null;
    r.frozen = r.vis === 'hidden';
    if (r.vis === 'frozen') { /* ok */ }
  }
  return r;
}

// 启发式作答：判断题选"对"；单选选最长选项；排除结构性选项；随机 2–8s 读题延迟
async function answerDialog(page, s) {
  const waitMs = 2000 + Math.floor(Math.random() * 6000);
  log('dialog', { msg: 'reading delay', waitMs });
  await page.bringToFront().catch(() => {});
  await sleep(waitMs);

  const opts = s.options && s.options.length ? s.options : [];
  let target = -1;
  const q = (s.dialogText || '');
  const isJudge = /判断|是否正确|对错/.test(q) || opts.some((o) => /^(对|错|正确|错误|√|×|true|false)/i.test(o));
  const clean = opts.map((o) => o.replace(/^[A-Ha-h][.、:：)\s]+/, '').trim());
  if (isJudge) {
    target = clean.findIndex((o) => /^(对|正确|√|true|是)$/i.test(o));
    if (target < 0) target = 0;
  } else {
    let best = -1;
    clean.forEach((o, i) => {
      if (/^(以上都|都不对|全部|none|all of the above|无法确定)/i.test(o)) return;
      if (o.length > best) { best = o.length; target = i; }
    });
    if (target < 0) target = Math.floor(Math.random() * Math.max(1, clean.length));
  }
  log('dialog', { msg: 'heuristic pick', isJudge, target, choice: clean[target] });

  try {
    const lis = page.locator('#playTopic-dialog ul.topic-item li, #playTopic-dialog .topic-item li, #playTopic-dialog li');
    const n = await lis.count();
    if (n === 0) { log('dialog', { msg: 'no clickable li found' }); }
    else {
      const idx = Math.min(target, n - 1);
      await lis.nth(idx).click({ timeout: 4000 }).catch(async () => {
        await lis.nth(idx).click({ timeout: 4000, force: true }).catch((e) => log('error', { where: 'click option', msg: String(e).slice(0, 200) }));
      });
      log('dialog', { msg: 'option clicked', idx, total: n });
      counters.answered++;
    }
    await sleep(1200 + Math.random() * 1800);
    // 提交 / 关闭
    for (const sel of ['#playTopic-dialog .btn', '#playTopic-dialog .close-btn', '#playTopic-dialog button']) {
      const b = page.locator(sel).first();
      if (await b.count() && await b.isVisible().catch(() => false)) {
        await b.click({ timeout: 4000 }).catch((e) => log('error', { where: 'click ' + sel, msg: String(e).slice(0, 150) }));
        log('dialog', { msg: 'clicked closer', sel });
        break;
      }
    }
  } catch (e) {
    log('error', { where: 'answerDialog inner', msg: String(e).slice(0, 300) });
  }
  // 记录作答后 15s 内视频是否恢复/回退
  const before = SAMPLES.length ? SAMPLES[SAMPLES.length - 1] : null;
  await sleep(15000);
  const after = await sampleOnce(page).catch(() => null);
  log('dialog', {
    msg: 'post-answer state',
    beforeCt: before && before.ct, afterCt: after && after.ct,
    paused: after && after.paused, dialogStillThere: after && after.dialogVisible,
    rewind: !!(before && after && before.ct !== null && after.ct !== null && after.ct < before.ct - 1),
  });
  if (after && after.paused) {
    log('alert', { msg: 'video still paused after answering — trying play()' });
    await page.evaluate(() => { const v = document.querySelector('video'); if (v && v.paused) v.play().catch(() => {}); }).catch(() => {});
  }
}

async function waitLogin(ctx, timeoutMs) {
  return waitFor(async () => {
    const cookies = await ctx.cookies().catch(() => []);
    // 只认真正的登录票据：CASLOGC(SERVERID 是负载均衡 cookie，匿名也有，不能当登录标志)
    return cookies.some((c) => /^(CASLOGC|jt-cas|SERVERID_CAS)$/i.test(c.name) && c.value && c.value.length > 10);
  }, timeoutMs, 2000);
}

async function waitFor(fn, timeoutMs, interval) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try { if (await fn()) return true; } catch {}
    await sleep(interval);
  }
  return false;
}

async function finish(reason) {
  // 计算核心指标
  const ok = SAMPLES.filter((s) => s && !s.err && s.ct !== null);
  const first = ok[0], last = ok[ok.length - 1];
  const wallSec = first && last ? last.bs - first.bs : 0;
  const adv = first && last ? +(last.ct - first.ct).toFixed(2) : null;
  const expected = first && last ? +(wallSec * (last.rate || RATE)).toFixed(2) : null;
  const summary = {
    reason, samples: counters.samples, videoSamples: ok.length,
    wallSec, ctAdvance: adv, expectedCtAdvance: expected,
    advanceRatio: adv && expected ? +(adv / expected).toFixed(3) : null,
    startCt: first && first.ct, endCt: last && last.ct, duration: last && last.dur,
    rate: last && last.rate,
    collectorPosts: counters.collectorPosts, navAway: counters.navAway,
    rewinds: counters.rewinds, stalls: counters.stalls, frozenSamples: counters.frozen,
    dialogs: counters.dialogs, answered: counters.answered,
    learningSaves: counters.learningSaves, popupApi: counters.popupApi,
    lastVis: last && last.vis, lastReady: last && last.ready, lastHtmlNull: last && last.htmlNull,
    lastWebdriver: last && last.webdriver, lastStackHasPptr: last && last.stackHasPptr,
    jsonl: JSONL,
  };
  fs.writeFileSync(SUMMARY, JSON.stringify({ summary, samples: SAMPLES }, null, 2));
  log('summary', summary);
  console.log('\n===== SUMMARY =====\n' + JSON.stringify(summary, null, 2));
  try { await context?.close(); } catch {}
  process.exit(0);
}

main().catch(async (e) => {
  log('error', { where: 'main', msg: String(e && e.stack || e).slice(0, 1500) });
  try { await finish('crashed'); } catch { process.exit(1); }
});
