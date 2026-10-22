/** mock 引擎：不碰智慧树，用于界面联调与自检；契约与真实引擎一致（start/ready/control/stop） */
import { applyPatch } from './state.mjs';

const MOCK_LESSONS = [
  { code: '1.1', name: '心理健康概述', chapter: '第一章 心理健康概述', durSec: 1264, pct: 100, done: true },
  { code: '1.2', name: '心理健康与大学生发展', chapter: '第一章 心理健康概述', durSec: 803, pct: 55, done: false },
  { code: '1.3', name: '学会自助与助人', chapter: '第一章 心理健康概述', durSec: 729, pct: 28, done: false },
  { code: '2.1', name: '自我意识的内涵', chapter: '第二章 大学生自我意识', durSec: 677, pct: null, done: false },
  { code: '2.2', name: '自我的发展理论介绍', chapter: '第二章 大学生自我意识', durSec: 279, pct: null, done: false },
];

const OPTIONS = [
  '心理健康是指没有心理疾病',
  '心理健康是一种持续的、积极的心理状态',
  '心理健康就是情绪永远稳定',
  '心理健康与身体健康无关',
];

const MOCK_COURSES = [
  {
    i: 0,
    name: '大学生心理素质发展',
    teacher: '李旭珊',
    school: '北京理工大学',
    now: '2.1 自我意识的内涵',
    pct: 4.8,
    recruitId: '477311',
  },
  {
    i: 1,
    name: '大学生心理健康教育',
    teacher: '张老师',
    school: '某某大学',
    now: '1.1 心理健康概述',
    pct: 34,
    recruitId: '',
  },
  {
    i: 2,
    name: '中国近现代史纲要',
    teacher: '王老师',
    school: '某某大学',
    now: '3.2 辛亥革命',
    pct: 61,
    recruitId: '',
  },
];

const MOCK_QUIZZES = [
  {
    key: '第一章 心理健康概述',
    chapter: '第一章 心理健康概述',
    title: '第一章 心理健康概述·平时测试',
    status: 'todo',
    count: 7,
    total: 12,
    score: null,
    answered: 0,
    at: 0,
    note: '',
  },
  {
    key: '第二章 大学生自我意识',
    chapter: '第二章 大学生自我意识',
    title: '第二章 大学生自我意识·平时测试',
    status: 'done',
    count: 8,
    total: 16,
    score: 14,
    answered: 8,
    at: 0,
    note: '',
  },
];

const MOCK_QUIZ_CHAPTERS = [
  { chapter: '第一章 心理健康概述', total: 3, done: 1, allDone: false },
  { chapter: '第二章 大学生自我意识', total: 2, done: 0, allDone: false },
];

const QP = [
  { timeSec: 425, questionIds: '1097920778' },
  { timeSec: 1259, questionIds: '1097920779' },
];

export function createMockEngine(state, emit, pushLog) {
  let timer = null;
  let answerAt = null;
  let mockCurrent = '1.1';
  let mockCourse = MOCK_COURSES[0].name;
  let quizSim = null;

  function reset() {
    applyPatch(state, {
      mode: 'mock',
      phase: 'PLAYING',
      paused: false,
      lessons: MOCK_LESSONS.map((l) => ({ ...l, current: l.code === mockCurrent })),
      loginNeeded: false,
      loginHint: '',
      pickHint: '',
      course: {
        platform: '智慧树 · 学分课',
        name: '大学生心理健康教育',
        chapter: '第一章 心理健康概述',
        taskPoint: '1.1 心理健康概述',
        index: 1,
        total: 7,
      },
      video: { ct: 396.4, dur: 1264, rate: 1, paused: false },
      progress: { watchedSec: 1264 * 0.31, taskPointPct: 34 },
      answers: { auto: true, advance: true, strategy: 'random', count: 0, right: 0 },
      questionPoints: QP.map((q, i) => ({ ...q, answered: false, state: i === 0 ? 'next' : 'future' })),
      currentQid: null,
      nextQuestion: { atSec: 425, etaSec: 28.6, questionId: '1097920778' },
      history: [],
      quizChapters: MOCK_QUIZ_CHAPTERS.map((c) => ({ ...c })),
      quizzes: MOCK_QUIZZES.map((q) => ({ ...q })),
      quiz: {
        running: false,
        key: '',
        title: '',
        i: 0,
        n: null,
        answered: 0,
        strategy: '',
        last: null,
        result: null,
        error: '',
      },
    });
    recompute();
  }

  function recompute() {
    const ct = state.video.ct;
    const s = state.summary;
    s.section.watched = Math.min(s.section.total, ct);
    s.chapter.watched = Math.min(s.chapter.total, 1400 + ct);
    s.course.watched = Math.min(s.course.total, 5200 + ct);
    s.overall.watched = Math.min(s.overall.total, 6200 + ct);
    for (const k of ['section', 'chapter', 'course', 'overall'])
      s[k].pct = Math.min(100, Math.round((s[k].watched / s[k].total) * 100));
    for (const q of state.questionPoints) q.state = q.answered ? 'done' : ct >= q.timeSec - 15 ? 'next' : 'future';
    const nxt = state.questionPoints.find((q) => !q.answered);
    state.nextQuestion = nxt
      ? { atSec: nxt.timeSec, etaSec: Math.max(0, nxt.timeSec - ct), questionId: nxt.questionIds }
      : null;
  }

  function start() {
    reset();
    applyPatch(state, {
      summary: {
        section: { pct: 0, watched: 0, total: 1264 },
        chapter: { pct: 0, watched: 0, total: 10800 },
        course: { pct: 0, watched: 0, total: 39600 },
        overall: { pct: 0, watched: 0, total: 60000 },
      },
    });
    recompute();
    pushLog('ok', 'mock 引擎已启动（未连接智慧树）');
    for (const q of QP) pushLog('info', '弹题点：' + q.timeSec + 's · 题号 ' + q.questionIds);
    clearInterval(timer);
    timer = setInterval(() => {
      tickOnce();
      emit();
    }, 500);
    emit();
  }

  /** 一拍：推进视频 / 弹题 / 切节。改完状态由调用方统一广播。 */
  function startQuiz(key) {
    const list = state.quizzes || [];
    const target = key ? list.find((q) => q.key === key) : list.find((q) => q.status === 'todo');
    if (!target) {
      pushLog('info', 'mock：没有需要做的章节测试了');
      applyPatch(state, { notice: '没有需要做的章节测试了' });
      return true;
    }
    target.status = 'doing';
    applyPatch(state, {
      quiz: {
        running: true,
        key: target.key,
        title: target.title,
        i: 0,
        n: target.count,
        answered: 0,
        strategy: 'llm',
        last: null,
        result: null,
        error: '',
      },
      notice: '正在做「' + target.title + '」',
    });
    pushLog('info', 'mock：开始做「' + target.title + '」（' + target.count + ' 题）');
    quizSim = { key: target.key, i: 0, n: target.count || 5 };
    return true;
  }

  function tickOnce() {
    if (state.phase === 'STOPPED' || state.paused) return;

    // mock 的章节测试：每拍答一题，答完自动提交
    if (quizSim && state.quiz && state.quiz.running) {
      quizSim.i += 1;
      state.quiz.i = quizSim.i;
      state.quiz.answered = quizSim.i;
      state.quiz.last = { num: quizSim.i, type: '【单选题】', chosen: ['A'], result: '已选' };
      if (quizSim.i >= quizSim.n) {
        const q = (state.quizzes || []).find((x) => x.key === quizSim.key);
        if (q) {
          q.status = 'done';
          q.score = Math.min(q.total || q.count || 10, 8 + Math.floor(Math.random() * 5));
          q.answered = q.count;
          q.at = Date.now();
        }
        state.quiz.running = false;
        const score = q ? q.score : null;
        const total = q ? q.total : null;
        state.quiz.result = {
          score,
          total,
          text: score == null ? '已提交' : '得分 ' + score + (total ? '/' + total : '') + ' 分',
        };
        pushLog('ok', 'mock：「' + state.quiz.title + '」提交完成，' + state.quiz.result.text);
        quizSim = null;
      }
      recompute();
      return;
    }

    const due = state.questionPoints.find((x) => !x.answered && state.video.ct >= x.timeSec);
    if (due && !answerAt) {
      state.phase = 'ANSWERING';
      state.currentQid = due.questionIds;
      state.video.paused = true;
      pushLog('warn', '弹题出现：视频已暂停，等待作答');
      if (state.answers.auto) {
        answerAt = Date.now() + 2000 + Math.random() * 3000;
        pushLog('info', '自动答题已开启：2-5 秒后随机作答');
      } else pushLog('warn', '自动答题已关闭：请在网页中手动作答');
      recompute();
      return;
    }

    if (answerAt && Date.now() >= answerAt) {
      const q = state.questionPoints.find((x) => x.questionIds === state.currentQid && !x.answered);
      if (q) {
        const chosen = OPTIONS[Math.floor(Math.random() * OPTIONS.length)];
        q.answered = true;
        q.state = 'done';
        state.currentQid = null;
        state.answers.count++;
        state.history.unshift({
          qid: q.questionIds,
          summary: '心理健康的标准不包括？',
          chosen,
          result: Math.random() > 0.4 ? 'ok' : 'bad',
          at: new Date().toTimeString().slice(0, 8),
        });
        state.history = state.history.slice(0, 20);
        state.video.paused = false;
        state.phase = 'PLAYING';
        recompute();
        pushLog('ok', '已提交答案，视频继续播放：' + chosen);
      }
      answerAt = null;
      return;
    }

    if (state.video.ct < state.video.dur) {
      state.video.ct = Math.min(state.video.dur, state.video.ct + 0.5 * state.video.rate);
      state.progress.watchedSec += 0.5;
      state.progress.taskPointPct = Math.min(100, Math.round((state.video.ct / state.video.dur) * 100));
      recompute();
    } else if (state.phase !== 'STOPPED') {
      const nx = state.answers.advance ? nextLesson() : null;
      if (nx) switchLesson(nx);
      else {
        state.phase = 'STOPPED';
        pushLog('info', '本段视频已播完（mock）');
      }
    }
  }

  function switchLesson(code) {
    const l = MOCK_LESSONS.find((x) => x.code === code);
    if (!l) {
      pushLog('warn', 'mock：没有 ' + code + ' 这一节');
      return;
    }
    mockCurrent = code;
    const startCt = l.pct ? Math.round((l.durSec * l.pct) / 100) : 0;
    applyPatch(state, {
      lessons: MOCK_LESSONS.map((x) => ({ ...x, current: x.code === code })),
      lessonSwitchHint: '',
      video: { ct: startCt, dur: l.durSec, paused: false },
      phase: 'PLAYING',
      currentQid: null,
      questionPoints: [Math.round(l.durSec * 0.33), Math.round(l.durSec * 0.77)].map((t, i) => ({
        timeSec: t,
        questionIds: 'mock-' + code + '-' + i,
        answered: false,
        state: 'future',
      })),
    });
    recompute();
    pushLog('ok', 'mock：已切到 ' + code + ' ' + l.name + '（从 ' + startCt + 's 继续）');
  }

  function nextLesson() {
    const idx = MOCK_LESSONS.findIndex((x) => x.code === mockCurrent);
    for (let i = idx + 1; i < MOCK_LESSONS.length; i++) if (!MOCK_LESSONS[i].done) return MOCK_LESSONS[i].code;
    return null;
  }

  function control(action, data) {
    try {
      if (action === 'settings') {
        if (data && typeof data.autoAnswer === 'boolean') state.answers.auto = data.autoAnswer;
        if (data && typeof data.autoAdvance === 'boolean') state.answers.advance = data.autoAdvance;
        if (data && typeof data.quizAuto === 'boolean') state.quizAuto = data.quizAuto;
        return true;
      }
      if (action === 'quiz') return startQuiz(data && data.key);
      if (action === 'lesson') {
        switchLesson((data && data.code) || '');
        return true;
      }
      if (action === 'courses') {
        applyPatch(state, { courses: MOCK_COURSES, coursesAt: Date.now() });
        pushLog('ok', 'mock：读到 ' + MOCK_COURSES.length + ' 门课');
        return true;
      }
      if (action === 'course') {
        const idx = Number(data && data.index);
        const c = MOCK_COURSES[idx];
        if (!c) {
          pushLog('warn', 'mock：没有第 ' + (idx + 1) + ' 门课');
          return true;
        }
        mockCourse = c.name;
        applyPatch(state, {
          course: { name: c.name, platform: '智慧树 · 学分课' },
          notice: '已切到「' + c.name + '」（mock）',
        });
        pushLog('ok', 'mock：已切到课程「' + c.name + '」');
        return true;
      }
      if (action === 'verify') {
        applyPatch(state, {
          phase: 'WAIT_VERIFY',
          verifyHint: '请完成安全验证',
          video: { paused: true },
          notice: '智慧树要求人机验证：请在浏览器窗口点掉「请完成安全验证」，点完自动继续',
        });
        pushLog('warn', 'mock：模拟人机验证（selftest 用）');
        return true;
      }
      if (action === 'unverify') {
        applyPatch(state, {
          phase: 'PLAYING',
          verifyHint: '',
          video: { paused: false },
          notice: '人机验证已通过，继续听课',
        });
        pushLog('ok', 'mock：模拟验证通过');
        return true;
      }
      if (action === 'pause') {
        state.paused = true;
        state.phase = 'PAUSED';
        state.video.paused = true;
        pushLog('info', '已暂停');
        return true;
      }
      if (action === 'resume') {
        state.paused = false;
        state.phase = 'PLAYING';
        state.video.paused = false;
        pushLog('info', '已继续');
        return true;
      }
      if (action === 'restart') {
        state.video.ct = 396.4;
        reset();
        pushLog('ok', '任务已重启');
        return true;
      }
      if (action === 'quit') {
        state.phase = 'STOPPED';
        state.paused = true;
        state.video.paused = true;
        pushLog('info', '已退出：断点已保存');
        return true;
      }
      return false;
    } finally {
      emit();
    }
  }

  function stop() {
    clearInterval(timer);
  }

  return { start, control, stop, ready: () => Promise.resolve() };
}
