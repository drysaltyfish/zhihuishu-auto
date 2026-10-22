/** 本地自检：真实引擎空闲页 + mock 引擎完整交互，不碰智慧树 */
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 自检用独立数据目录，避免覆盖真实运行的 data/server.url 与 runtime.log
const TMP_DATA = path.join(ROOT, 'data', 'selftest-' + Date.now());

function startServer(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['server/index.mjs', ...args], { cwd: ROOT, env: { ...process.env, ZHS_DATA: TMP_DATA } });
    let out = '';
    const t = setTimeout(() => reject(new Error('server timeout: ' + out)), 20000);
    p.stdout.on('data', (d) => {
      out += String(d);
      const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)\/\?t=([0-9a-f]+)/);
      if (m) { clearTimeout(t); resolve({ proc: p, port: m[1], token: m[2], url: m[0] }); }
    });
    p.stderr.on('data', (d) => { out += String(d); });
  });
}

async function api(base, token, p, body) {
  const r = await fetch(base + p + '?t=' + token, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  return { status: r.status, body: await r.json() };
}

const results = [];
const ok = (name, cond, extra) => { results.push({ name, pass: !!cond, extra: extra || '' }); };

// ---------- 1) 真实引擎：只启动服务，不启动浏览器 ----------
{
  const s = await startServer(['--port', '8790']);
  const base = 'http://127.0.0.1:' + s.port;
  const st = await api(base, s.token, '/api/state');
  ok('真实引擎初始为 IDLE', st.body.phase === 'IDLE', st.body.phase);
  ok('真实引擎 mode=real', st.body.mode === 'real', st.body.mode);
  const bad = await api(base, 'deadbeef', '/api/state');
  ok('错误 token 被拒 403', bad.status === 403 && bad.body.hint, JSON.stringify(bad.body).slice(0, 120));
  const b2 = await api(base, s.token, '/api/control', { action: 'pause' });
  ok('空闲时暂停被友好拒绝', b2.status === 409 && b2.body.message.includes('还没开始'), JSON.stringify(b2.body).slice(0, 120));
  const c1 = await api(base, s.token, '/api/courses');
  ok('空闲时读课程被友好拒绝', c1.status === 409 && !!c1.body.hint, JSON.stringify(c1.body).slice(0, 120));
  const c2 = await api(base, s.token, '/api/course', { index: 0 });
  ok('空闲时切课被友好拒绝', c2.status === 409 && !!c2.body.hint, JSON.stringify(c2.body).slice(0, 120));

  const br = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await br.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(s.url, { waitUntil: 'networkidle' });
  await sleep(1200);
  await page.screenshot({ path: 'docs/ui-idle.png', fullPage: true });
  const txt = await page.locator('.wrap').innerText();
  ok('空闲页有「开始听课」按钮', txt.includes('开始听课'), '');
  ok('空闲页显示「未选择课程」', txt.includes('未选择课程'), '');
  ok('未拿到进度时显示 —', txt.includes('—'), '');
  const btnCount = await page.locator('button').count();
  ok('空闲页不显示暂停/退出', !(await page.locator('button:has-text("退出")').count()), 'buttons=' + btnCount);
  await br.close();
  s.proc.kill();
  await sleep(300);
}

// ---------- 2) mock 引擎：完整交互 ----------
{
  const s = await startServer(['--port', '8791', '--mock']);
  const base = 'http://127.0.0.1:' + s.port;
  await sleep(1500);
  const st0 = await api(base, s.token, '/api/state');
  ok('mock 自动开始且 PLAYING', ['PLAYING', 'ARMED', 'ANSWERING'].includes(st0.body.phase), st0.body.phase);
  ok('mock 已拿到弹题点', st0.body.questionPoints.length === 2, JSON.stringify(st0.body.questionPoints));

  // 人机验证：模拟弹出 → 状态/界面提示 → 通过后恢复
  await api(base, s.token, '/api/control', { action: 'verify' });
  await sleep(500);
  const vSt = await api(base, s.token, '/api/state');
  ok('mock 人机验证状态正确', vSt.body.phase === 'WAIT_VERIFY' && !!vSt.body.verifyHint, JSON.stringify({ phase: vSt.body.phase, hint: vSt.body.verifyHint }).slice(0, 120));
  await api(base, s.token, '/api/control', { action: 'unverify' });
  await sleep(500);
  const vSt2 = await api(base, s.token, '/api/state');
  ok('mock 验证通过后继续播放', vSt2.body.phase === 'PLAYING' && !vSt2.body.verifyHint, JSON.stringify({ phase: vSt2.body.phase, hint: vSt2.body.verifyHint }).slice(0, 120));

  const cr = await api(base, s.token, '/api/courses');
  ok('mock 课程列表接口可用', cr.status === 200 && (cr.body.courses || []).length === 3, JSON.stringify(cr.body).slice(0, 120));
  const crBad = await api(base, s.token, '/api/course', {});
  ok('非法课程序号被友好拒绝', crBad.status === 400 && !!crBad.body.hint, JSON.stringify(crBad.body).slice(0, 120));
  const crPick = await api(base, s.token, '/api/course', { index: 1 });
  await sleep(400);
  const crSt = await api(base, s.token, '/api/state');
  ok('mock 切课成功后课程名变化', crPick.status === 200 && (crSt.body.course || {}).name === '大学生心理健康教育', JSON.stringify(crSt.body.course).slice(0, 120));

  const pz = await api(base, s.token, '/api/control', { action: 'pause' });
  const st1 = await api(base, s.token, '/api/state');
  ok('暂停生效', pz.status === 200 && st1.body.phase === 'PAUSED', st1.body.phase);
  await api(base, s.token, '/api/control', { action: 'resume' });
  const st2 = await api(base, s.token, '/api/state');
  ok('继续生效', st2.body.phase !== 'PAUSED', st2.body.phase);

  await api(base, s.token, '/api/settings', { autoAnswer: false });
  const st3 = await api(base, s.token, '/api/state');
  ok('开关自动答题生效', st3.body.answers.auto === false, String(st3.body.answers.auto));
  await api(base, s.token, '/api/settings', { autoAnswer: true });

  ok('mock 有课程目录 5 节', (st0.body.lessons || []).length === 5, String((st0.body.lessons || []).length));
  ok('mock 当前节标记为 1.1', ((st0.body.lessons || []).find((l) => l.current) || {}).code === '1.1', '');
  const ad0 = await api(base, s.token, '/api/state');
  const advNow = ad0.body.answers.advance;
  await api(base, s.token, '/api/settings', { autoAdvance: !advNow });
  const ad1 = await api(base, s.token, '/api/state');
  ok('自动跳节开关可切换', ad1.body.answers.advance === !advNow, String(ad1.body.answers.advance));
  await api(base, s.token, '/api/settings', { autoAdvance: true });

  const sw = await api(base, s.token, '/api/lesson', { code: '2.1' });
  await sleep(700);
  const swState = await api(base, s.token, '/api/state');
  const swCur = (swState.body.lessons || []).find((l) => l.current) || {};
  ok('手动选节切到 2.1', sw.status === 200 && swCur.code === '2.1', JSON.stringify(swCur).slice(0, 120));
  const badLesson = await api(base, s.token, '/api/lesson', { code: 'abc' });
  ok('非法小节号被友好拒绝', badLesson.status === 400 && badLesson.body.hint, JSON.stringify(badLesson.body).slice(0, 100));
  await api(base, s.token, '/api/lesson', { code: '1.2' });

  const rt = await api(base, s.token, '/api/control', { action: 'restart' });
  ok('重启接口 200', rt.status === 200, '');

  const br = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await br.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(s.url, { waitUntil: 'networkidle' });
  await sleep(900);
  const t1 = await page.locator('.wrap').innerText();
  ok('运行页显示课程名', t1.includes('大学生心理健康教育'), '');
  ok('运行页有进度总览四列', ['本节视频', '本章节', '本课程', '全部课程'].every((k) => t1.includes(k)), '');
  ok('运行页有暂停按钮', t1.includes('暂停'), '');
  ok('运行页有课程目录', t1.includes('课程目录') && t1.includes('已完成'), '');
  ok('运行页有自动跳节开关', t1.includes('自动跳下一节'), '');
  ok('运行页有测试模型按钮', t1.includes('测试模型'), '');
  // 我的课程入口在顶部课程胶囊里，点开是弹窗
  await page.locator('.coursechip').click();
  await sleep(450);
  const pickerTxt = (await page.locator('.modal').innerText().catch(() => '')).replace(/\n/g, ' ');
  ok('课程胶囊能打开「我的课程」弹窗', pickerTxt.includes('我的课程') && pickerTxt.includes('刷新'), pickerTxt.slice(0, 120));
  await page.keyboard.press('Escape');
  await sleep(350);
  ok('弹窗可以关掉', (await page.locator('.modal').count()) === 0, '');

  // 章节测试卡片：列出每章、点「现在做」能跑起来并显示进度
  const quizCard = page.locator('.card').filter({ hasText: '自动做章节测试' }).first();
  const tq = (await quizCard.count()) ? await quizCard.innerText() : '';
  ok('运行页有章节测试卡片', tq.includes('章节测试') && tq.includes('自动做章节测试'), tq.slice(0, 80));
  const qRows = await page.locator('.qrow').count();
  ok('章节测试列出每一章', qRows >= 2, '行数 ' + qRows);
  const qTag = await page.locator('.qtag.done').first().innerText().catch(() => '');
  ok('已交的章显示「已交」+得分', qTag.includes('已交'), qTag);
  const firstDo = page.locator('.qrow button').filter({ hasText: '现在做' }).first();
  if (await firstDo.count()) {
    await firstDo.click();
    await sleep(1600);
    const qTxt = (await quizCard.innerText()).replace(/\n/g, ' ');
    ok('点「现在做」后显示做题进度', /第\s*\d+\s*\/\s*\d+\s*题/.test(qTxt), qTxt.slice(0, 120));
    await sleep(3200);
    const qTxt2 = (await quizCard.innerText()).replace(/\n/g, ' ');
    ok('mock 做完后章节变成已交', /已交/.test(qTxt2) && !/做题中/.test(qTxt2), qTxt2.slice(0, 120));
  } else {
    ok('点「现在做」后显示做题进度', false, '没有「现在做」按钮');
  }

  // 一屏布局：整页不许滚动，课程目录不许横向溢出
  const fit = await page.evaluate(() => {
    const el = document.documentElement;
    const lt = document.querySelector('.ltree');
    return {
      page: el.scrollHeight <= window.innerHeight + 1,
      hOver: lt ? lt.scrollWidth <= lt.clientWidth + 1 : true,
      rows: document.querySelectorAll('.lrow').length,
    };
  });
  ok('仪表盘一屏放下（整页不滚动）', fit.page, '');
  ok('课程目录没有横向溢出', fit.hOver, '');
  ok('课程目录一屏显示完', fit.rows >= 5, '行数 ' + fit.rows);

  // 人机验证时界面要明确告诉用户「要在浏览器窗口点一下」
  await api(base, s.token, '/api/control', { action: 'verify' });
  await sleep(800);
  const tV = await page.locator('.wrap').innerText();
  ok('界面提示等待人机验证', tV.includes('等待人机验证') && tV.includes('人机验证'), tV.slice(0, 120));
  await page.screenshot({ path: 'docs/ui-verify.png', fullPage: true });

  // 提示条：浮空、可手动关掉、开关时不挤动页面
  const hintPos = await page.locator('.hintwrap').evaluate((el) => getComputedStyle(el).position);
  ok('提示条浮空显示', hintPos === 'fixed', hintPos);
  const gOn = await page.locator('.grid').boundingBox();
  await page.locator('.hint-x').click();
  await sleep(400);
  const hintLeft = await page.locator('.hintwrap').count();
  ok('提示条可手动关闭', hintLeft === 0, '剩余 ' + hintLeft);
  const gOff = await page.locator('.grid').boundingBox();
  ok('提示条开关不引起重排', Math.round(gOn.y) === Math.round(gOff.y), Math.round(gOn.y) + ' -> ' + Math.round(gOff.y));
  const nqTxt = (await page.locator('.nextq').innerText()).replace(/\n/g, ' ');
  ok('下一题面板不误报「本段末尾」', !nqTxt.includes('已到达本段末尾'), nqTxt.slice(0, 80));

  await api(base, s.token, '/api/control', { action: 'unverify' });
  await sleep(600);

  await page.screenshot({ path: 'docs/ui-running.png', fullPage: true });

  await api(base, s.token, '/api/control', { action: 'quit' });
  await sleep(600);
  const st4 = await api(base, s.token, '/api/state');
  ok('退出后 phase=STOPPED', st4.body.phase === 'STOPPED', st4.body.phase);
  await page.reload({ waitUntil: 'networkidle' });
  await sleep(900);
  const t2 = await page.locator('.wrap').innerText();
  ok('退出后显示「重新开始」', t2.includes('重新开始'), '');
  const afterQuit = await api(base, s.token, '/api/lesson', { code: '1.2' });
  ok('退出后选节被友好拒绝', afterQuit.status === 409 && afterQuit.body.hint, JSON.stringify(afterQuit.body).slice(0, 100));
  await page.screenshot({ path: 'docs/ui-stopped.png', fullPage: true });
  await br.close();
  s.proc.kill();
}

try { fs.rmSync(TMP_DATA, { recursive: true, force: true }); } catch {}

const failed = results.filter((r) => !r.pass);
console.log(results.map((r) => (r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : '  << ' + r.extra)).join('\n'));
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
process.exit(failed.length ? 1 : 0);