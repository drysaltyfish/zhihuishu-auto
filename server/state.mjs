/** 共享状态：UI 只认这一份结构 */
export function initialState() {
  return {
    mode: 'real',
    phase: 'IDLE',
    paused: false,
    loginNeeded: false,
    loginHint: '',
    pickHint: '',
    notice: '',
    course: { platform: '智慧树 · 学分课', name: '未选择课程', chapter: '—', taskPoint: '—', index: 1, total: 1 },
    video: { ct: 0, dur: 0, rate: 1, paused: true },
    progress: { watchedSec: 0, taskPointPct: null },
    answers: { auto: true, advance: true, strategy: 'random', count: 0, right: 0 },
    lessons: [],
    pointsLoaded: false,
    verifyHint: '',
    courses: [],
    coursesAt: 0,
    questionPoints: [],
    currentQid: null,
    nextQuestion: null,
    history: [],
    summary: {
      section: { pct: null, watched: 0, total: 0 },
      chapter: { pct: null, watched: 0, total: 0 },
      course: { pct: null, watched: 0, total: 0 },
      overall: { pct: null, watched: 0, total: 0 },
    },
  };
}

/** 深合并补丁（数组整体替换） */
export function applyPatch(state, patch) {
  if (!patch || typeof patch !== 'object') return state;
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && state[k] && typeof state[k] === 'object' && !Array.isArray(state[k])) {
      applyPatch(state[k], v);
    } else {
      state[k] = v;
    }
  }
  return state;
}
