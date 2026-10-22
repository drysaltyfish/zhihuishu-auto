export const PHASE_LABEL = {
  IDLE: '空闲', LAUNCHING: '启动浏览器', WAIT_LOGIN: '等待登录',
  COURSE_LIST: '拉取课程', COURSE_PICK: '选择课程', PLAYING: '播放中',
  ARMED: '待命（等弹题）', ANSWERING: '答题中', PAUSED: '已暂停', STOPPED: '已退出',
  WAIT_VERIFY: '等待人机验证', RECOVERING: '恢复页面', ENDED: '本节播完',
};

export function pctText(v) { return v === null || v === undefined ? '—' : v; }

export function barW(v) { return (v === null || v === undefined ? 0 : Math.max(0, Math.min(100, v))) + '%'; }

/** 秒 → mm:ss / h:mm:ss；无值为 --:-- */
export function fmtClock(sec) {
  if (sec === null || sec === undefined) return '--:--';
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? h + ':' + p(m) + ':' + p(ss) : p(m) + ':' + p(ss);
}

export function phaseText(state) {
  return state ? PHASE_LABEL[state.phase] || state.phase : '连接中';
}

export function statusText(state) {
  if (!state) return '—';
  const p = state.phase;
  if (p === 'PLAYING') return state.video.paused ? '缓冲中' : '播放中';
  if (p === 'ARMED') return '待命等弹题';
  if (p === 'ANSWERING') return '正在作答';
  if (p === 'WAIT_VERIFY') return '等待人机验证';
  return PHASE_LABEL[p] || p;
}

/** 课程目录每节的右侧状态文案 */
export function lessonStat(l) {
  if (l.current) {
    if (l.done) return '已完成 · 正在这节';
    return (l.pct != null && l.pct > 0 ? l.pct + '% · ' : '') + '正在这节';
  }
  if (l.done) return '已完成';
  if (l.pct != null && l.pct > 0) return l.pct + '%';
  return '未开始';
}
