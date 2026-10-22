import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, INITIAL_MEM } from '../server/worker/lib/tick.mjs';

const mem0 = (over = {}) => ({ ...INITIAL_MEM, ...over });
const cfg0 = (over = {}) => ({ userPaused: false, autoAnswer: true, autoAdvance: true, ...over });
const video = (over = {}) => ({ ct: 100, dur: 600, rate: 1, paused: false, ended: false, src: 'v1', ...over });
const obs = (over = {}) => ({ video: video(), dialog: { visible: false }, ...over });

test('INITIAL_MEM 字段齐全且可取', () => {
  for (const k of [
    'lastVideoKey',
    'lastCt',
    'endedLogged',
    'stallTicks',
    'frozenCt',
    'frozenTicks',
    'dialogNotified',
    'pageInfoDumped',
    'noVideoTicks',
    'lastVideoSwitchAt',
    'lastPhase',
  ]) {
    assert.ok(k in INITIAL_MEM, '缺字段 ' + k);
  }
});

test('正常播放：推进度补丁 + 首次读课程树 + 尝试自动切节', () => {
  const plan = decide(obs(), mem0(), cfg0());
  assert.equal(plan.flow, 'playing');
  const p = plan.patches[0];
  assert.equal(p.video.ct, 100);
  assert.equal(p.video.dur, 600);
  assert.equal(p.progress.taskPointPct, 17);
  assert.equal(p.summary.section.pct, 17);
  assert.deepEqual(
    plan.effects.map((e) => e.type),
    ['readCourseInfo', 'advance']
  );
  assert.equal(plan.effects[1].force, false);
  assert.equal(plan.mem.lastCt, 100);
  assert.equal(plan.mem.pageInfoDumped, true);
});

test('正常播放：PLAYING 只在相位变化时发一次', () => {
  const a = decide(obs(), mem0({ lastPhase: 'PAUSED' }), cfg0());
  assert.ok(a.patches.some((p) => p.phase === 'PLAYING'));
  const b = decide(obs(), mem0({ lastPhase: 'PLAYING' }), cfg0());
  assert.ok(!b.patches.some((p) => p.phase === 'PLAYING'));
});

test('视频切换：清空弹题点、重读课程树、日志带新时长', () => {
  const plan = decide(obs({ video: video({ src: 'v2', dur: 300, ct: 1 }) }), mem0({ lastVideoKey: 'v1|600' }), cfg0());
  assert.ok(plan.logs.some((l) => l.kind === 'info' && l.msg.includes('视频已切换') && l.msg.includes('300s')));
  assert.deepEqual(
    plan.effects.map((e) => e.type),
    ['resetPoints', 'readCourseInfo', 'readCourseInfo', 'advance']
  );
  assert.equal(plan.mem.lastVideoKey, 'v2|300');
  assert.equal(plan.mem.endedLogged, false);
});

test('进度回退会记一条日志', () => {
  const plan = decide(obs({ video: video({ ct: 50 }) }), mem0({ lastCt: 100, lastVideoKey: 'v1|600' }), cfg0());
  assert.ok(plan.logs.some((l) => l.msg.includes('视频进度回退')));
});

test('播到结尾：拍快照、尝试强制切节，切不动就进 ENDED', () => {
  const plan = decide(
    obs({ video: video({ ct: 599, ended: true }) }),
    mem0({ lastVideoKey: 'v1|600', pageInfoDumped: true }),
    cfg0()
  );
  assert.equal(plan.flow, 'ended');
  assert.ok(plan.logs.some((l) => l.msg.includes('本节视频播完了')));
  assert.ok(plan.effects.some((e) => e.type === 'shot'));
  const adv = plan.effects.find((e) => e.type === 'advance');
  assert.equal(adv.force, true);
  assert.equal(adv.onFalse.phase, 'ENDED');
  assert.match(adv.onFalse.notice, /没找到能自动切过去的下一节/);
  assert.equal(plan.mem.endedLogged, true);
});

test('停在 100% 没触发 ended 也算播完', () => {
  const plan = decide(
    obs({ video: video({ ct: 600, dur: 600, ended: false }) }),
    mem0({ lastVideoKey: 'v1|600', pageInfoDumped: true }),
    cfg0()
  );
  assert.equal(plan.flow, 'ended');
  assert.ok(plan.logs.some((l) => l.msg.includes('停在结尾')));
});

test('结尾只报一次：第二拍不再记日志/拍照', () => {
  const mem = mem0({ lastVideoKey: 'v1|600', pageInfoDumped: true });
  decide(obs({ video: video({ ct: 600, ended: true }) }), mem, cfg0());
  const plan2 = decide(obs({ video: video({ ct: 600, ended: true }) }), mem, cfg0());
  assert.ok(!plan2.logs.some((l) => l.msg.includes('播完')));
  assert.ok(!plan2.effects.some((e) => e.type === 'shot'));
  assert.equal(plan2.flow, 'ended');
});

test('自动跳节关着：ENDED 的提示改成让用户自己选', () => {
  const plan = decide(
    obs({ video: video({ ct: 600, ended: true }) }),
    mem0({ lastVideoKey: 'v1|600', pageInfoDumped: true }),
    cfg0({ autoAdvance: false })
  );
  const adv = plan.effects.find((e) => e.type === 'advance');
  assert.match(adv.onFalse.notice, /请在课程目录里选下一节/);
});

test('用户暂停：不推进度、不催播放、不自动切节', () => {
  const plan = decide(obs(), mem0({ lastVideoKey: 'v1|600' }), cfg0({ userPaused: true }));
  assert.equal(plan.flow, 'paused');
  assert.equal(plan.effects.filter((e) => e.type === 'advance' || e.type === 'ensurePlaying').length, 0);
});

test('被平台暂停：第 3 拍起尝试恢复播放', () => {
  const mem = mem0({ lastVideoKey: 'v1|600' });
  const p1 = decide(obs({ video: video({ paused: true, ct: 120 }) }), mem, cfg0());
  assert.ok(!p1.effects.some((e) => e.type === 'ensurePlaying'));
  const p2 = decide(obs({ video: video({ paused: true, ct: 120 }) }), mem, cfg0());
  assert.ok(!p2.effects.some((e) => e.type === 'ensurePlaying'));
  const p3 = decide(obs({ video: video({ paused: true, ct: 120 }) }), mem, cfg0());
  assert.ok(p3.effects.some((e) => e.type === 'ensurePlaying'));
  assert.equal(p3.flow, 'stalled');
});

test('暂停且进度不动：每 60 拍喊一次，超 300 拍转 PAUSED', () => {
  const mem = mem0({ lastVideoKey: 'v1|600' });
  const notices = [];
  let paused = null;
  for (let i = 0; i < 305; i++) {
    const plan = decide(obs({ video: video({ paused: true, ct: 120 }) }), mem, cfg0());
    for (const l of plan.logs) if (l.msg.includes('进度不动')) notices.push(i);
    for (const p of plan.patches) if (p.phase === 'PAUSED') paused = p;
  }
  // 第 1 拍只是记下当前进度（frozenTicks 仍为 0），所以从第 60 拍开始每隔 60 拍才喊一次
  assert.deepEqual(notices, [60, 120, 180, 240, 300]);
  assert.ok(paused && /卡住/.test(paused.notice));
});

test('找不到视频：第 1 拍提示、第 3 拍告警、第 6 拍让用户选节、每 12 拍尝试恢复页面', () => {
  const mem = mem0({ lastVideoKey: 'v1|600' });
  const steps = [];
  for (let i = 0; i < 13; i++) steps.push(decide(obs({ video: null }), mem, cfg0()));
  assert.ok(steps[0].logs.some((l) => l.msg.includes('开始尝试恢复页面')));
  assert.ok(steps[2].logs.some((l) => l.kind === 'warn' && l.msg.includes('找不到视频')));
  assert.ok(steps[5].patches.some((p) => p.phase === 'COURSE_PICK'));
  assert.deepEqual(
    steps.map((p, i) => (p.effects.some((e) => e.type === 'recoverPage') ? i : -1)).filter((i) => i >= 0),
    [11]
  );
});

test('弹题 + 自动答题开：交给 handleDialog', () => {
  const plan = decide(obs({ dialog: { visible: true } }), mem0({ lastVideoKey: 'v1|600' }), cfg0());
  assert.equal(plan.flow, 'dialog');
  assert.ok(plan.effects.some((e) => e.type === 'handleDialog'));
  assert.equal(plan.patches[0].video.paused, true, '弹窗时进度条按暂停显示');
});

test('弹题 + 自动答题关：停一次等手答，提示只发一次', () => {
  const mem = mem0({ lastVideoKey: 'v1|600' });
  const a = decide(obs({ dialog: { visible: true } }), mem, cfg0({ autoAnswer: false }));
  assert.ok(a.patches.some((p) => p.phase === 'PAUSED'));
  const b = decide(obs({ dialog: { visible: true } }), mem, cfg0({ autoAnswer: false }));
  assert.ok(!b.patches.some((p) => p.phase === 'PAUSED'));
});

test('弹窗关掉后 dialogNotified 复位（下次弹题还会提示）', () => {
  const mem = mem0({ lastVideoKey: 'v1|600', dialogNotified: true });
  decide(obs({ dialog: { visible: false } }), mem, cfg0());
  assert.equal(mem.dialogNotified, false);
});

test('纯函数：不改 obs / cfg', () => {
  const o = obs();
  const c = cfg0();
  const before = JSON.stringify([o, c]);
  decide(o, mem0(), c);
  assert.equal(JSON.stringify([o, c]), before);
});
