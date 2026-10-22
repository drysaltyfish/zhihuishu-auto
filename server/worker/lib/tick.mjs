/**
 * 主循环的决策核心（纯函数）。
 *
 * 以前这段逻辑长在 1422 行的 main.mjs 里，和 Playwright 的 await、拍照、写日志搅在一起：
 * 119 个分支、36 个模块级 let，谁也说不清「什么时候会切下一节 / 什么时候会重试」。
 * 现在它只做一件事：拿一次观测（obs）+ 一份记忆（mem）+ 配置（cfg），
 * 返回「要打给前端的补丁 / 要写的日志 / 要让调用方去做的动作（effects）」。
 *
 * 约定：
 *  - 纯函数：不 import playwright，不 await，不碰全局，不 setTimeout；
 *  - mem 由调用方传入并在返回时带回（同一对象，原地改），就是个显式状态容器；
 *  - effects 是「动作描述」，由 main.mjs 翻译成真正的 I/O（播放/切节/拍照/读课程树/恢复页面）；
 *  - 忠实于重构前的行为，唯一有意的改动：phase===PLAYING 的补丁不再每秒重复发（原来判空恒真）。
 */

/**
 * @typedef {object} VideoObs
 * @property {number} ct 当前秒
 * @property {number} dur 总秒
 * @property {number} rate 倍速
 * @property {boolean} paused
 * @property {boolean} ended
 * @property {string} src
 */

/**
 * @typedef {object} TickState
 * @property {string} lastVideoKey
 * @property {number} lastCt
 * @property {boolean} endedLogged
 * @property {number} stallTicks
 * @property {number} frozenCt
 * @property {number} frozenTicks
 * @property {boolean} dialogNotified
 * @property {boolean} pageInfoDumped
 * @property {number} noVideoTicks
 * @property {number} lastVideoSwitchAt
 * @property {string} lastPhase 上一次推给前端的 phase（用来避免每秒重复发同一 phase）
 */

export const INITIAL_MEM = Object.freeze({
  lastVideoKey: '',
  lastCt: 0,
  endedLogged: false,
  stallTicks: 0,
  frozenCt: -1,
  frozenTicks: 0,
  dialogNotified: false,
  pageInfoDumped: false,
  noVideoTicks: 0,
  lastVideoSwitchAt: 0,
  lastPhase: 'PLAYING',
});

const ENDED_NOTICE = (autoAdvance) =>
  autoAdvance ? '本节已播完，没找到能自动切过去的下一节' : '本节播完了；自动跳节是关的，请在课程目录里选下一节';

/**
 * 一次决策。
 *
 * @param {{video: VideoObs|null, dialog: {visible: boolean}}} obs 一次采样
 * @param {TickState} mem 跨拍记忆（会被原地更新）
 * @param {{userPaused: boolean, autoAnswer: boolean, autoAdvance: boolean}} cfg 用户开关
 * @returns {{flow: string, mem: TickState, patches: object[], logs: {kind: string, msg: string}[], effects: object[]}}
 */
export function decide(obs, mem, cfg) {
  const patches = [];
  const logs = [];
  const effects = [];
  const push = (kind, msg) => logs.push({ kind, msg });
  const patch = (p) => patches.push(p);
  const effect = (e) => effects.push(e);

  const v = obs && obs.video ? obs.video : null;
  const dialog = (obs && obs.dialog) || { visible: false };
  let flow = 'idle';

  if (!v) {
    if (!mem.endedLogged) {
      flow = 'novideo';
      if (mem.noVideoTicks === 0) push('info', '没找到视频，开始尝试恢复页面…');
      mem.noVideoTicks++;
      if (mem.noVideoTicks === 3) push('warn', '页面里找不到视频了（可能跳到了课程目录页）');
      if (mem.noVideoTicks === 6) patch({ phase: 'COURSE_PICK', pickHint: '找不到视频，请点进要听的那一节' });
      if (mem.noVideoTicks % 12 === 0) effect({ type: 'recoverPage' });
    }
  } else {
    mem.noVideoTicks = 0;
    // 有的播放器播完不会把 ended 置 true，只是暂停在 100%（实测 2.5 卡在这里），按「到结尾」处理
    const atEnd = v.dur > 0 && v.ct >= v.dur - 1.5;
    const key = v.src + '|' + Math.round(v.dur);

    if (mem.lastVideoKey && key !== mem.lastVideoKey) {
      mem.lastVideoSwitchAt = Date.now();
      push('info', '视频已切换（平台自动跳下一节或换了课）：新时长 ' + Math.round(v.dur) + 's');
      mem.endedLogged = false;
      effect({ type: 'resetPoints' });
      mem.lastCt = v.ct;
      effect({ type: 'readCourseInfo' });
    }
    mem.lastVideoKey = key;
    if (v.ct + 3 < mem.lastCt) push('info', '视频进度回退：' + mem.lastCt + 's → ' + v.ct + 's');
    mem.lastCt = v.ct;

    const pct = v.dur ? Math.min(100, Math.round((v.ct / v.dur) * 100)) : null;
    patch({
      video: { ct: v.ct, dur: v.dur, rate: v.rate, paused: v.paused || !!dialog.visible },
      progress: { watchedSec: Math.round(v.ct), taskPointPct: pct },
      summary: { section: { pct, watched: Math.round(v.ct), total: Math.round(v.dur) } },
    });
    if (!mem.pageInfoDumped) {
      mem.pageInfoDumped = true;
      effect({ type: 'readCourseInfo' });
    }

    if (v.ended || atEnd) {
      flow = 'ended';
      if (!mem.endedLogged) {
        mem.endedLogged = true;
        push(
          'warn',
          (v.ended ? '本节视频播完了' : '视频停在结尾（已到 100% 但没触发 ended）') + '，看看有没有下一节可切'
        );
        effect({ type: 'shot', name: 'ended-' + Date.now() + '.png' });
        if (!cfg.userPaused) {
          effect({
            type: 'advance',
            force: true,
            onFalse: { phase: 'ENDED', notice: ENDED_NOTICE(cfg.autoAdvance) },
          });
          mem.lastPhase = 'ENDED';
        }
      }
    } else if (cfg.userPaused) {
      flow = 'paused';
      mem.stallTicks = 0;
    } else if (v.paused && !dialog.visible) {
      flow = 'stalled';
      mem.stallTicks++;
      if (mem.stallTicks >= 3) {
        effect({ type: 'ensurePlaying' });
        mem.stallTicks = 0;
      }
      // 兜底：暂停且进度长期不动，别无声僵死（每秒一条会刷屏，所以每 60 秒才喊一次）
      mem.frozenTicks = Math.abs(v.ct - mem.frozenCt) < 0.5 ? mem.frozenTicks + 1 : 0;
      mem.frozenCt = v.ct;
      if (mem.frozenTicks > 0 && mem.frozenTicks % 60 === 0) {
        push('warn', '视频暂停且进度不动（' + Math.round(v.ct) + 's / ' + Math.round(v.dur) + 's），再试着播一次');
        patch({ notice: '视频停住了（进度不动），正在尝试恢复；若一直不动，点一下浏览器里的播放键' });
        effect({ type: 'ensurePlaying' });
      }
      if (mem.frozenTicks > 300) {
        patch({ phase: 'PAUSED', notice: '视频像是卡住了：请在浏览器窗口里点一下播放键，或点「重启」' });
        mem.frozenTicks = 0;
        mem.lastPhase = 'PAUSED';
      }
    } else {
      flow = 'playing';
      mem.stallTicks = 0;
      mem.frozenTicks = 0;
      mem.frozenCt = -1;
      if (mem.lastPhase !== 'PLAYING') {
        patch({ phase: 'PLAYING' });
        mem.lastPhase = 'PLAYING';
      }
      if (!cfg.userPaused && !dialog.visible) effect({ type: 'advance', force: false });
    }
  }

  // 弹题：自动答题开着就交给 handleDialog；关着就停一下等用户手点
  if (dialog.visible && !cfg.userPaused) {
    if (cfg.autoAnswer) {
      mem.dialogNotified = false;
      effect({ type: 'handleDialog' });
      flow = flow === 'stalled' ? flow : 'dialog';
    } else if (!mem.dialogNotified) {
      mem.dialogNotified = true;
      push('warn', '弹题出现，但自动答题是关的 —— 请在浏览器窗口里手动答');
      patch({ phase: 'PAUSED', video: { paused: true }, notice: '弹题等你手动作答（自动答题已关闭）' });
      mem.lastPhase = 'PAUSED';
      flow = 'dialog-manual';
    }
  } else if (!dialog.visible) {
    mem.dialogNotified = false;
  }

  return { flow, mem, patches, logs, effects };
}
