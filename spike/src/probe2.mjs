
/**
 * SPIKE-2 探针：专攻「弹题」闸门
 *  - 修 navigator.webdriver（--disable-blink-features=AutomationControlled）
 *  - 全帧 MutationObserver + 1s 轮询，抓任何"像弹题"的浮层（不限 #playTopic-dialog）
 *  - 抓到就：立刻截图 + 存 outerHTML + 存最近 30 条网络请求 + 研判网络契约
 *  - 然后按启发式作答，并记录【作答后】视频 ct / paused / 弹窗是否重弹 / 接口返回
 *  - 全程 try/catch，单点异常不影响主循环
 *
 * 用法: node spike/src/probe2.mjs --minutes 40 [--visible] [--x -2600]
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

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const MINUTES = Number(arg('minutes', '40'));
const VISIBLE = argv.includes('--visible');
const OFFSET_X = Number(arg('x', '-2600'));

const TS = new Date().toISOString().replace(/[:.]/g, '-');
const JSONL = path.join(LOGS, 'hunt-' + TS + '.jsonl');
const SUMMARY = path.join(LOGS, 'hunt-' + TS + '.summary.json');

const t0 = Date.now();
const rec = [];
function log(kind, data = {}) {
  const row = { t: +((Date.now() - t0) / 1000).toFixed(2), clock: new Date().toISOString(), kind, ...data };
  rec.push(row);
  try { fs.appendFileSync(JSONL, JSON.stringify(row) + '\n'); } catch {}
  if (['phase', 'alert', 'hit', 'answer', 'net', 'error', 'summary'].includes(kind)) {
    console.log('[' + row.t + 's] ' + kind.toUpperCase() + ' ' + JSON.stringify(data).slice(0, 500));
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const C = { hits: 0, answered: 0, rewindsAfterAnswer: 0, popupApi: 0, collectorPosts: 0, ticks: 0, videoSamples: 0 };

// 环形缓冲：最近 40 条网络事件
const netBuf = [];
function pushNet(o) { netBuf.push(o); if (netBuf.length > 40) netBuf.shift(); }

// ---------- 帧内注入：弹题候选探测器 ----------
const INJECT = () => {
  if (window.__POP) return true;
  window.__POP = { hits: [], seen: {} };
  const SEL = [
    '#playTopic-dialog', '.topic-item', '.el-dialog__wrapper', '.el-dialog', '.v-modal',
    '[class*="topic"]', '[class*="Topic"]', '[class*="exam"]', '[class*="Exam"]',
    '[class*="question"]', '[class*="Question"]', '[class*="answer"]', '[class*="Answer"]',
    '[class*="popup"]', '[class*="pop"]', '[class*="dialog"]', '[class*="Dialog"]',
    '[class*="modal"]', '[class*="Modal"]', '[class*="quiz"]', '[class*="Quiz"]',
    '[class*="mask"]', '[class*="layer"]', '[role="dialog"]', '[role="alertdialog"]',
  ];
  const vis = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const s = getComputedStyle(el);
    if (!s || s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 120 || r.height < 60) return false;
    return true;
  };
  const optText = (el) => Array.from(el.querySelectorAll('li,label,.option,.item,video')).map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 30);
  const scan = (why) => {
    const out = [];
    for (const sel of SEL) {
      let nodes = [];
      try { nodes = Array.from(document.querySelectorAll(sel)); } catch { continue; }
      for (const el of nodes) {
        try {
          if (!vis(el)) continue;
          const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          if (!txt || txt.length < 6) continue;
          if (txt.length > 4000) continue;
          // 只有"含题目/选项"特征或明确弹题容器才算，避免误报
          const looksLikeQ = /题|选项|判断|单选|多选|下列|正确|作答|提交|请选择|答题/.test(txt);
          const isKnown = /playTopic|topic-item|topic-dialog/i.test(sel) || /topic|exam|question/i.test(el.className || '');
          if (!looksLikeQ && !isKnown) continue;
          const key = sel + '|' + txt.slice(0, 160);
          if (window.__POP.seen[key]) continue;
          window.__POP.seen[key] = 1;
          out.push({
            why, sel, tag: el.tagName, cls: String(el.className || '').slice(0, 200),
            id: el.id || '', txt: txt.slice(0, 3000),
            rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
            options: optText(el),
            html: (el.outerHTML || '').slice(0, 20000),
          });
        } catch {}
      }
    }
    if (out.length) window.__POP.hits.push(...out);
    return out.length;
  };
  scan('init');
  try {
    const mo = new MutationObserver(() => { try { scan('mutation'); } catch {} });
    mo.observe(document.documentElement || document, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'] });
  } catch {}
  setInterval(() => { try { scan('interval'); } catch {} }, 700);
  return true;
};

async function installWatchers(page) {
  const run = async (frame) => {
    try { await frame.evaluate(INJECT); return true; } catch { return false; }
  };
  page.on('framenavigated', (f) => { run(f).catch(() => {}); });
  page.on('frameattached', (f) => { run(f).catch(() => {}); });
  for (const f of page.frames()) await run(f);
}

async function drainHits(page) {
  const hits = [];
  for (const f of page.frames()) {
    try {
      const h = await f.evaluate(() => { if (!window.__POP) return []; const a = window.__POP.hits; window.__POP.hits = []; return a; });
      if (Array.isArray(h)) hits.push(...h);
    } catch {}
  }
  return hits;
}

// ---------- 登录 ----------
async function waitLogin(context, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const cs = await context.cookies();
      if (cs.some((c) => /^(CASLOGC|jt-cas|SERVERID_CAS)$/i.test(c.name) && c.value && c.value.length > 10)) return true;
    } catch {}
    await sleep(1500);
  }
  return false;
}

// ---------- 视频状态 ----------
const VSTATE = () => {
  const vs = Array.from(document.querySelectorAll('video'));
  if (!vs.length) return null;
  vs.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight));
  const v = vs[0];
  return {
    ct: +(+v.currentTime).toFixed(2), dur: +(+v.duration || 0).toFixed(2), paused: v.paused,
    rate: v.playbackRate, rs: v.readyState, w: v.videoWidth, h: v.videoHeight,
    bufferedEnd: (() => { try { return v.buffered.length ? +(+v.buffered.end(v.buffered.length - 1)).toFixed(1) : null; } catch { return null; } })(),
    webdriver: navigator.webdriver, vis: document.visibilityState, htmlNull: document.documentElement === null,
    stackHasPptr: (() => { try { return /playwright|pptr|puppeteer/i.test(new Error().stack || ''); } catch { return null; } })(),
    dialogVisible: (() => { try { const d = document.querySelector('#playTopic-dialog'); if (!d) return false; const s = getComputedStyle(d); if (s.display === 'none' || s.visibility === 'hidden') return false; const r = d.getBoundingClientRect(); return r.width > 100 && r.height > 50; } catch { return null; } })(),
  };
};

async function ensurePlaying(page, ms = 90000) {
  const end = Date.now() + ms;
  let tries = 0;
  while (Date.now() < end) {
    tries++;
    for (const f of page.frames()) {
      try {
        const st = await f.evaluate(VSTATE);
        if (!st) continue;
        if (!st.paused && st.ct > 0.5) return true;
        await f.evaluate(() => {
          const vs = Array.from(document.querySelectorAll('video'));
          vs.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight));
          const v = vs[0];
          if (v) { try { v.muted = true; } catch {} try { v.play(); } catch {} }
        });
        for (const sel of ['.play-btn', '.vjs-big-play-button', '.prism-big-play-btn', '.controls-play', '.prism-play-btn']) {
          try { const el = await f.$(sel); if (el && (await el.isVisible())) { await el.click({ timeout: 1500 }); break; } } catch {}
        }
      } catch {}
    }
    await sleep(1500);
  }
  return false;
}

async function moveOffscreen(page) {
  try {
    const cdp = await page.context().newCDPSession(page);
    const { targetInfo } = await cdp.send('Target.getTargetInfo');
    const { windowId } = await cdp.send('Browser.getWindowForTarget', { targetId: targetInfo.targetId });
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { left: OFFSET_X, top: 0, windowState: 'normal' } });
    log('phase', { msg: 'moved offscreen', x: OFFSET_X });
    return true;
  } catch (e) { log('error', { where: 'moveOffscreen', msg: String(e).slice(0, 200) }); return false; }
}

// ---------- 作答 ----------
const PICK = () => {
  // 返回 { text, idx } 供上层点击
  const dlg = document.querySelector('#playTopic-dialog') || document.querySelector('[class*="topic"][class*="dialog"]') || document.body;
  const sels = ['li', 'label', '.option', '.item', '.answer-item', '.el-radio', '.el-checkbox'];
  let nodes = [];
  for (const s of sels) {
    try { const ns = Array.from(dlg.querySelectorAll(s)).filter((e) => (e.innerText || '').trim().length > 0); if (ns.length >= 2) { nodes = ns; break; } } catch {}
  }
  const texts = nodes.map((e) => (e.innerText || '').replace(/\s+/g, ' ').trim());
  const isJudge = texts.length === 2 && texts.every((t) => /^(对|错|正确|错误|是|否|√|×|true|false)$/i.test(t));
  let idx = 0;
  if (isJudge) {
    idx = texts.findIndex((t) => /^(对|正确|√|是|true)$/i.test(t));
    if (idx < 0) idx = Math.floor(Math.random() * texts.length);
  } else {
    const bad = /^(以上都|都不对|全部|none|all of the above|无法确定)/i;
    let best = -1, bestLen = -1;
    texts.forEach((t, i) => { if (bad.test(t)) return; if (t.length > bestLen) { bestLen = t.length; best = i; } });
    idx = best >= 0 ? best : 0;
  }
  return { count: texts.length, texts, isJudge, idx, chosen: texts[idx] || null };
};

async function answerHit(page, hit) {
  try {
    log('hit', { sel: hit.sel, cls: hit.cls, id: hit.id, rect: hit.rect, txt: hit.txt.slice(0, 600), options: hit.options.slice(0, 10) });
    C.hits++;
    // 存证
    try { fs.writeFileSync(path.join(LOGS, 'dialog-' + TS + '-' + C.hits + '.html'), hit.html || ''); } catch {}
    try { await page.screenshot({ path: path.join(LOGS, 'shot-' + TS + '-' + C.hits + '.png'), timeout: 8000 }); } catch (e) { log('error', { where: 'screenshot', msg: String(e).slice(0, 150) }); }
    // 网络前后文
    try { fs.appendFileSync(JSONL, JSON.stringify({ kind: 'netctx', t: +((Date.now() - t0) / 1000).toFixed(2), buf: netBuf.slice(-40) }) + '\n'); } catch {}
    log('net', { msg: 'net context at hit', last: netBuf.slice(-8) });

    // 人类读题延迟
    await sleep(2000 + Math.random() * 6000);

    const pick = await page.evaluate(PICK).catch(() => null);
    log('answer', { pick: pick ? { count: pick.count, isJudge: pick.isJudge, idx: pick.idx, chosen: pick.chosen, texts: pick.texts } : null });
    if (!pick || !pick.count) { log('alert', { msg: 'no options found, skip click' }); return; }

    // 点击选项
    const clicked = await page.evaluate((i) => {
      const dlg = document.querySelector('#playTopic-dialog') || document.querySelector('[class*="topic"][class*="dialog"]') || document.body;
      const sels = ['li', 'label', '.option', '.item', '.answer-item', '.el-radio', '.el-checkbox'];
      let nodes = [];
      for (const s of sels) { const ns = Array.from(dlg.querySelectorAll(s)).filter((e) => (e.innerText || '').trim().length > 0); if (ns.length >= 2) { nodes = ns; break; } }
      const el = nodes[i];
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      el.click();
      return true;
    }, pick.idx).catch(() => false);
    log('answer', { msg: 'option clicked', ok: clicked, idx: pick.idx });

    const before = await page.evaluate(VSTATE).catch(() => null);
    await sleep(1200);

    // 提交/确定按钮
    const submitted = await page.evaluate(() => {
      const dlg = document.querySelector('#playTopic-dialog') || document.querySelector('[class*="topic"][class*="dialog"]') || document.body;
      const cand = Array.from(dlg.querySelectorAll('button,.btn,a,span,div')).filter((e) => {
        const t = (e.innerText || '').replace(/\s+/g, '');
        const r = e.getBoundingClientRect();
        return r.width > 20 && r.height > 12 && /^(确定|确认|提交|提交答案|提交作答|保存|下一步|答题完成)$/.test(t);
      });
      if (!cand.length) return false;
      cand[cand.length - 1].click();
      return true;
    }).catch(() => false);
    log('answer', { msg: 'submit clicked', ok: submitted });

    await sleep(3000);
    const after = await page.evaluate(VSTATE).catch(() => null);
    C.answered++;
    const rewound = before && after ? after.ct < before.ct - 5 : null;
    if (rewound) C.rewindsAfterAnswer++;
    log('answer', { msg: 'post-answer state', before: before && { ct: before.ct, paused: before.paused }, after: after && { ct: after.ct, paused: after.paused, dialogVisible: after.dialogVisible, dur: after.dur }, rewound });

    // 再看 30s 内是否重弹 / 视频是否恢复
    for (let i = 0; i < 10; i++) {
      await sleep(3000);
      const st = await page.evaluate(VSTATE).catch(() => null);
      if (!st) continue;
      if (st.dialogVisible) { log('answer', { msg: 'dialog still/again visible', ct: st.ct, paused: st.paused }); break; }
      if (!st.paused) { log('answer', { msg: 'video resumed', ct: st.ct }); break; }
    }
  } catch (e) { log('error', { where: 'answerHit', msg: String(e).slice(0, 300) }); }
}

// ---------- main ----------
let context = null;
let finished = false;
async function finish(reason, extra = {}) {
  if (finished) return; finished = true;
  const summary = { reason, ...C, ...extra, wallSec: +((Date.now() - t0) / 1000).toFixed(1), jsonl: JSONL };
  try { fs.writeFileSync(SUMMARY, JSON.stringify(summary, null, 2)); } catch {}
  log('summary', summary);
  console.log('\n===== SUMMARY =====\n' + JSON.stringify(summary, null, 2));
}

async function main() {
  log('phase', { msg: 'start probe2', minutes: MINUTES, visible: VISIBLE });
  context = await chromium.launchPersistentContext(path.join(DATA, 'chrome-profile'), {
    channel: 'chrome', headless: false, viewport: null,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
      '--autoplay-policy=no-user-gesture-required',
      '--no-first-run', '--no-default-browser-check', '--disable-session-crashed-bubble',
      '--window-size=1280,820',
    ],
    ignoreDefaultArgs: ['--enable-automation', '--no-startup-window'],
  });

  const page = context.pages()[0] || (await context.newPage());
  context.on('page', (p) => { log('phase', { msg: 'new page', url: p.url() }); installWatchers(p).catch(() => {}); });
  await installWatchers(page);

  // 网络监听
  context.on('request', (r) => {
    try {
      const u = r.url();
      if (/popupAnswer|PopupExam|saveLessonPopupExam|loadVideoPointerInfo/i.test(u)) {
        C.popupApi++;
        pushNet({ kind: 'req', url: u, method: r.method(), postData: (r.postData() || '').slice(0, 3000), t: +((Date.now() - t0) / 1000).toFixed(2) });
        log('net', { msg: 'popup-api req', url: u, postData: (r.postData() || '').slice(0, 800) });
      }
      if (/collector2c|collect|checkTrace|anticheat/i.test(u)) {
        C.collectorPosts++;
        pushNet({ kind: 'collect', url: u, method: r.method(), postData: (r.postData() || '').slice(0, 1500), t: +((Date.now() - t0) / 1000).toFixed(2) });
        log('alert', { msg: 'collector post', url: u });
      }
    } catch {}
  });
  context.on('response', async (resp) => {
    try {
      const u = resp.url();
      if (/popupAnswer|PopupExam|saveLessonPopupExam|loadVideoPointerInfo/i.test(u)) {
        let body = '';
        try { body = (await resp.text()).slice(0, 8000); } catch {}
        pushNet({ kind: 'resp', url: u, status: resp.status(), body, t: +((Date.now() - t0) / 1000).toFixed(2) });
        log('net', { msg: 'popup-api resp', url: u, status: resp.status(), body: body.slice(0, 1500) });
      }
    } catch {}
  });

  log('phase', { msg: 'navigate home' });
  await page.goto('https://www.zhihuishu.com/', { waitUntil: 'domcontentloaded', timeout: 60000 })
    .catch((e) => log('error', { where: 'goto home', msg: String(e).slice(0, 300) }));

  log('phase', { msg: 'WAITING_FOR_LOGIN — 请扫码登录并点进「学分课」的视频播放页（限时 8 分钟）' });
  const ok = await waitLogin(context, 8 * 60 * 1000);
  log('phase', { msg: ok ? 'LOGIN_OK' : 'LOGIN_TIMEOUT' });
  if (!ok) { await finish('login_not_ok'); await sleep(1500); await context.close().catch(() => {}); return; }

  // 等进入视频播放页
  log('phase', { msg: 'WAITING_FOR_COURSE_PAGE — 请点进课程视频页（URL 含 stuStudy，限时 10 分钟）' });
  const end = Date.now() + 10 * 60 * 1000;
  let onCourse = false;
  while (Date.now() < end) {
    const url = page.url();
    if (/stuStudy/i.test(url)) { onCourse = true; break; }
    await sleep(1000);
  }
  log('phase', { msg: onCourse ? 'COURSE_PAGE_OK' : 'COURSE_PAGE_TIMEOUT', url: page.url() });
  if (!onCourse) { await finish('no_course_page'); await sleep(1500); await context.close().catch(() => {}); return; }

  await sleep(2500);
  await installWatchers(page);
  const playing = await ensurePlaying(page);
  log('phase', { msg: playing ? 'PLAYING' : 'NOT_PLAYING' });
  if (!VISIBLE) await moveOffscreen(page);
  await installWatchers(page);

  const st0 = await page.evaluate(VSTATE).catch(() => null);
  log('phase', { msg: 'hunt start', state0: st0 });

  const deadline = Date.now() + MINUTES * 60 * 1000;
  let lastCt = st0 ? st0.ct : 0;
  let stall = 0, lastLog = 0;
  while (Date.now() < deadline && !finished) {
    C.ticks++;
    let st = null;
    try { st = await page.evaluate(VSTATE); } catch (e) { log('error', { where: 'VSTATE', msg: String(e).slice(0, 150) }); }
    if (st) {
      C.videoSamples++;
      if (Math.abs(st.ct - lastCt) < 0.2 && !st.paused) stall++; else stall = 0;
      if (stall > 6) { log('alert', { msg: 'video stalled', ct: st.ct, stall }); await ensurePlaying(page, 20000).catch(() => {}); stall = 0; }
      lastCt = st.ct;
      if (Date.now() - lastLog > 60000) {
        lastLog = Date.now();
        log('phase', { msg: 'tick', ct: st.ct, dur: st.dur, paused: st.paused, vis: st.vis, webdriver: st.webdriver, hits: C.hits, popupApi: C.popupApi });
      }
    }
    const hits = await drainHits(page).catch(() => []);
    for (const h of hits) {
      if (finished) break;
      // 只对"看起来是题目"的作答，避免误点
      if (!/题|选项|判断|单选|多选|下列|作答|提交|请选择/.test(h.txt) && !/playTopic|topic/i.test(h.cls + h.id + h.sel)) continue;
      await answerHit(page, h);
    }
    await sleep(1000);
  }
  const stEnd = await page.evaluate(VSTATE).catch(() => null);
  await finish('ok', { stateEnd: stEnd, startCt: st0 && st0.ct, endCt: stEnd && stEnd.ct });
  await sleep(1500);
  await context.close().catch(() => {});
}

process.on('uncaughtException', (e) => { log('error', { where: 'uncaught', msg: String(e).slice(0, 500) }); });
process.on('unhandledRejection', (e) => { log('error', { where: 'unhandledRejection', msg: String(e).slice(0, 500) }); });

main().catch(async (e) => {
  log('error', { where: 'main', msg: String(e && e.stack || e).slice(0, 1000) });
  await finish('crash', { err: String(e && e.message || e).slice(0, 400) }).catch(() => {});
  setTimeout(() => process.exit(0), 1500);
});
