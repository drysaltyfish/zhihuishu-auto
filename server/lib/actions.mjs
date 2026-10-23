/**
 * 动作表：允许清单、相位守卫、成功后的乐观状态补丁都在这里定义。
 * 原来这三件事在 index.mjs / real-engine.mjs / worker 里各写一遍，漏改一处就静默失效。
 */

const CONTROL = {
  pause: { guard: 'running', patch: () => ({ paused: true, phase: 'PAUSED' }) },
  resume: { guard: 'running', patch: () => ({ paused: false }) },
  restart: { guard: 'startable', patch: () => ({ notice: '', phase: 'LAUNCHING', paused: false }) },
  quit: {
    guard: 'running',
    patch: () => ({ paused: true, phase: 'STOPPED', video: { paused: true }, browserVisible: false }),
  },
  // 手动做某一章的平时测试（key 为空由 worker 自己挑；key='__retry' 清掉失败状态）
  quiz: { guard: 'running' },
  // 登录二维码：刷新 / 把隐藏的浏览器窗口叫出来手动登录（账号、学号、QQ 等）
  refreshQr: { guard: 'running' },
  // 浏览器窗口显示 / 隐藏：状态由 worker 用 win-window.ps1 真正搬完窗口后回写 browserVisible，
  // 这里不做乐观补丁，免得窗口其实没搬成、界面却先报了「已隐藏」。
  showBrowser: { guard: 'running' },
  hideBrowser: { guard: 'running' },
  // 下面的动作界面上不出现：mock 自检和 debug 摸页面结构用
  verify: { guard: 'any', mockOnly: true },
  unverify: { guard: 'any', mockOnly: true },
  probe: { guard: 'running', debugOnly: true },
  verifyprobe: { guard: 'running', debugOnly: true },
};

export function isStoppedPhase(phase) {
  return phase === 'IDLE' || phase === 'STOPPED';
}

/**
 * @returns {{ok:true, action:object} | {ok:false, status:number, message:string, hint?:string}}
 */
export function resolveControl(name, { phase, mock, debug }) {
  const action = CONTROL[name];
  if (!action) return { ok: false, status: 400, message: '不支持的操作' };
  if (action.debugOnly && !debug) return { ok: false, status: 400, message: '不支持的操作' };
  if (action.mockOnly && !mock) return { ok: false, status: 400, message: '不支持的操作' };
  if (action.guard !== 'startable' && isStoppedPhase(phase)) {
    return { ok: false, status: 409, message: '任务还没开始', hint: '先点「开始听课」' };
  }
  return { ok: true, action };
}

/** 成功后先按预期改状态，界面立刻有反馈（真实状态随后由 worker 覆盖） */
export function actionPatch(name) {
  const action = CONTROL[name];
  return action && action.patch ? action.patch() : null;
}

/** 依赖「任务正在跑」的接口守卫，抛给 router 统一包装 */
export function requireRunning(state, hint) {
  if (isStoppedPhase(state.phase)) {
    const e = new Error('任务还没开始');
    e.status = 409;
    e.hint = hint;
    e.expose = true;
    throw e;
  }
}
