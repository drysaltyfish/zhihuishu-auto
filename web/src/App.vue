<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { api, subscribe } from './api.js';

const S = ref(null);
const logs = ref([]);
const connected = ref(false);
const busy = ref('');
const toast = ref(null);
let es = null;

const ovKeys = [
  { key: 'section', label: '本节视频' },
  { key: 'chapter', label: '本章节' },
  { key: 'course', label: '本课程' },
  { key: 'overall', label: '全部课程' },
];

const PHASE_LABEL = {
  IDLE: '空闲', LAUNCHING: '启动浏览器', WAIT_LOGIN: '等待登录',
  COURSE_LIST: '拉取课程', COURSE_PICK: '选择课程', PLAYING: '播放中',
  ARMED: '待命（等弹题）', ANSWERING: '答题中', PAUSED: '已暂停', STOPPED: '已退出',
  WAIT_VERIFY: '等待人机验证', RECOVERING: '恢复页面', ENDED: '本节播完',
};

const phaseText = computed(() => (S.value ? PHASE_LABEL[S.value.phase] || S.value.phase : '连接中'));
const statusText = computed(() => {
  if (!S.value) return '—';
  const p = S.value.phase;
  if (p === 'PLAYING') return S.value.video.paused ? '缓冲中' : '播放中';
  if (p === 'ARMED') return '待命等弹题';
  if (p === 'ANSWERING') return '正在作答';
  if (p === 'WAIT_VERIFY') return '等待人机验证';
  return PHASE_LABEL[p] || p;
});
const noticeMuted = ref('');
watch(() => S.value && S.value.notice, (v) => {
  noticeMuted.value = '';
  if (!v) return;
  setTimeout(() => { if (S.value && S.value.notice === v) noticeMuted.value = v; }, 7000);
});

const hasCourse = computed(() => !!S.value && S.value.course && S.value.course.name && S.value.course.name !== '未选择课程');
const isPaused = computed(() => !!S.value && (S.value.phase === 'PAUSED' || S.value.paused));
const isStopped = computed(() => !!S.value && S.value.phase === 'STOPPED');
const isIdle = computed(() => !!S.value && S.value.phase === 'IDLE');
const canStart = computed(() => !!S.value && (S.value.phase === 'IDLE' || S.value.phase === 'STOPPED'));
const hint = computed(() => {
  if (!S.value) return null;
  const s = S.value;
  if (s.phase === 'WAIT_VERIFY') return { kind: 'act', text: '智慧树要求人机验证（' + (s.verifyHint || '请完成安全验证') + '）：请在浏览器窗口里点掉它，点完我自动继续听课' };
  if (s.loginNeeded && s.loginHint) return { kind: 'warn', text: s.loginHint };
  if (s.notice && s.notice !== noticeMuted.value) {
    const bad = /没|失败|错误|异常|拒绝|无法|中断|失败/.test(s.notice);
    return { kind: bad ? 'bad' : 'warn', text: s.notice };
  }
  if (s.phase === 'COURSE_PICK' && s.pickHint) return { kind: 'warn', text: s.pickHint };
  if (s.phase === 'WAIT_LOGIN') return { kind: 'warn', text: s.loginHint || '等待登录…' };
  return null;
});
// 提示条：可手动关掉，出现新提示时自动重新出现
const hintDismissed = ref('');
watch(() => (hint.value ? hint.value.text : ''), () => { hintDismissed.value = ''; });
const hintShow = computed(() => (hint.value && hint.value.text !== hintDismissed.value ? hint.value : null));
function closeHint() { hintDismissed.value = hint.value ? hint.value.text : ''; }

function pctText(v) { return v === null || v === undefined ? '—' : v; }
function barW(v) { return (v === null || v === undefined ? 0 : Math.max(0, Math.min(100, v))) + '%'; }
const pct = computed(() => {
  if (!S.value) return 0;
  const { ct, dur } = S.value.video;
  return dur ? Math.min(100, (ct / dur) * 100) : 0;
});
// 下一题自己算（不等后台推送）：每节视频的弹题点 + 当前进度就是答案，切视频/答题后立刻更新
const nextQ = computed(() => {
  const s = S.value;
  if (!s) return null;
  const ct = (s.video && s.video.ct) || 0;
  const list = (s.questionPoints || []).filter((p) => !p.answered && p.state !== 'done');
  const ahead = list.filter((p) => p.timeSec >= ct - 0.5).sort((a, b) => a.timeSec - b.timeSec);
  if (!ahead.length) return null;
  const q = ahead[0];
  return { atSec: q.timeSec, questionId: q.questionIds, etaSec: Math.max(0, q.timeSec - ct) };
});
const etaText = computed(() => {
  const n = nextQ.value;
  if (!n) return '无';
  const v = Math.max(0, Math.round(n.etaSec));
  const m = Math.floor(v / 60), s = v % 60;
  return m > 0 ? m + ' 分 ' + s + ' 秒' : v + ' 秒';
});

function fmtT(sec) {
  if (sec === null || sec === undefined) return '--:--';
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? h + ':' + p(m) + ':' + p(ss) : p(m) + ':' + p(ss);
}

function say(msg, kind) {
  toast.value = { msg, kind: kind || 'ok' };
  setTimeout(() => { toast.value = null; }, 2600);
}

async function startTask() {
  busy.value = 'start';
  try { await api('/api/start', {}); say('已开始，正在启动浏览器…'); }
  catch (e) { say(e.message || '启动失败', 'bad'); }
  finally { busy.value = ''; }
}

async function ctl(action) {
  busy.value = action;
  try { await api('/api/control', { action }); }
  catch (e) { say(e.message || '操作失败', 'bad'); }
  finally { busy.value = ''; }
}

const lessonGroups = computed(() => {
  const out = [];
  for (const l of (S.value && S.value.lessons) || []) {
    const name = l.chapter || '未分章';
    let g = out.find((x) => x.name === name);
    if (!g) { g = { name, items: [] }; out.push(g); }
    g.items.push(l);
  }
  return out;
});
const lessonsDone = computed(() => ((S.value && S.value.lessons) || []).filter((l) => l.done).length);

function lessonStat(l) {
  if (l.current) {
    if (l.done) return '已完成 · 正在这节';
    return (l.pct != null && l.pct > 0 ? l.pct + '% · ' : '') + '正在这节';
  }
  if (l.done) return '已完成';
  if (l.pct != null && l.pct > 0) return l.pct + '%';
  return '未开始';
}

async function pickLesson(l) {
  if (!S.value || busy.value) return;
  busy.value = 'lesson';
  try { await api('/api/lesson', { code: l.code }); say('正在切到 ' + l.code + ' ' + l.name); }
  catch (e) { say(e.message || '切换没成功', 'bad'); }
  finally { busy.value = ''; }
}


const courses = computed(() => (S.value && S.value.courses) || []);
const coursesBusy = ref(false);

async function loadCourses() {
  if (coursesBusy.value) return;
  coursesBusy.value = true;
  try {
    await api('/api/courses', {});
    say('正在读取你的课程列表…');
  } catch (e) {
    say(e.message || '读课程列表没成功', 'bad');
  } finally { coursesBusy.value = false; }
}

async function pickCourse(i) {
  const c = courses.value[i];
  if (!c || busy.value) return;
  busy.value = 'course';
  try {
    await api('/api/course', { index: i });
    say('正在切到《' + c.name + '》…');
  } catch (e) {
    say(e.message || '切换课程没成功', 'bad');
  } finally { busy.value = ''; }
}

const llmCheck = reactive({ busy: false, text: '', ok: null });

async function runLlmCheck() {
  if (llmCheck.busy) return;
  llmCheck.busy = true;
  llmCheck.text = '正在用一道样题试模型…';
  try {
    const r = await api('/api/llmcheck');
    if (r.ok) { llmCheck.ok = true; llmCheck.text = (r.model || '模型') + ' 正常 · 样题选 ' + r.letter + ' 正确 · ' + r.ms + 'ms'; }
    else { llmCheck.ok = false; llmCheck.text = '没通过：' + (r.why || '模型没给出可用答案'); }
  } catch (e) {
    llmCheck.ok = false;
    llmCheck.text = '测试失败：' + (e.message || '服务没响应');
  } finally { llmCheck.busy = false; }
}

async function toggleAdvance() {
  if (!S.value) return;
  const next = !S.value.answers.advance;
  try {
    await api('/api/settings', { autoAdvance: next });
    say(next ? '已开启：看完自动跳下一节' : '已关闭自动跳节（看完会停下等你选）');
  } catch (e) { say(e.message || '设置失败', 'bad'); }
}

async function toggleAuto() {
  if (!S.value) return;
  const next = !S.value.answers.auto;
  try {
    await api('/api/settings', { autoAnswer: next });
    say(next ? '已开启自动答题' : '已关闭自动答题（弹题时会暂停等你）');
  } catch (e) { say(e.message || '设置失败', 'bad'); }
}

onMounted(async () => {
  try { S.value = await api('/api/state'); }
  catch (e) { say('后端未连接：' + (e.message || ''), 'bad'); }
  es = subscribe(
    (st) => { S.value = st; },
    (rows) => { logs.value = rows.slice(-80); },
    (ok) => { connected.value = ok; }
  );
});
onBeforeUnmount(() => { if (es) es.close(); });
</script>

<template>
  <div class="wrap">
    <header class="top">
      <div class="brand">
        <div class="logo">智</div>
        <div>
          <div class="t1">智慧树自动听课</div>
          <div class="t2">
            <span class="dot" :class="connected ? 'on' : 'off'"></span>
            {{ connected ? '已连接本地服务' : '连接断开' }}
            <span class="sep">·</span>{{ phaseText }}
          </div>
        </div>
      </div>
      <div class="acts">
        <button v-if="canStart" class="btn primary" :disabled="!!busy || !S" @click="startTask">
          <span class="ic">▶</span> {{ isStopped ? '重新开始' : '开始听课' }}
        </button>
        <template v-else>
          <button v-if="!isPaused" class="btn warn" :disabled="!!busy || !S || isStopped" @click="ctl('pause')">
            <span class="ic">❚❚</span> 暂停
          </button>
          <button v-else class="btn ok" :disabled="!!busy || isStopped" @click="ctl('resume')">
            <span class="ic">▶</span> 继续
          </button>
          <button class="btn" :disabled="!!busy || !S || isIdle" @click="ctl('restart')"><span class="ic">⟳</span> 重启</button>
          <button class="btn bad" :disabled="!!busy || !S || isIdle || isStopped" @click="ctl('quit')"><span class="ic">⏻</span> 退出</button>
        </template>
      </div>
    </header>

    <transition name="fade">
      <div v-if="hintShow" class="hintwrap">
        <div class="hintbar" :class="hintShow.kind">
          <span class="hi">!</span><span class="htext">{{ hintShow.text }}</span>
          <button class="hint-x" title="关闭这条提示" @click="closeHint">×</button>
        </div>
      </div>
    </transition>

    <div v-if="!S" class="empty">正在读取状态…</div>

    <main v-else class="grid">
      <div class="left">
      <section class="card course">
        <div class="cardhead">
          <span class="tag">当前课程</span>
          <span class="muted">{{ S.course.platform }}</span>
        </div>
        <h1>{{ S.course.name }}</h1>
        <div class="sub">
          {{ S.course.chapter }}<span class="sep">/</span>{{ S.course.taskPoint }}
          <span v-if="hasCourse" class="badge">任务点 {{ S.course.index }}/{{ S.course.total }}</span>
        </div>

        <div class="pv">
          <div class="pvtop">
            <span class="time">{{ fmtT(S.video.ct) }} <span class="muted">/ {{ fmtT(S.video.dur) }}</span></span>
            <span class="muted">倍速 {{ S.video.rate }}× · 已看 {{ fmtT(S.progress.watchedSec) }}</span>
          </div>
          <div class="bar"><div class="fill" :style="{ width: pct.toFixed(2) + '%' }"></div></div>
          <div class="pvbottom">
            <span class="muted">任务点进度 {{ pctText(S.progress.taskPointPct) }}<template v-if="S.progress.taskPointPct !== null">%</template></span>
            <span class="muted" :class="{ okc: S.phase === 'PLAYING' && !S.video.paused, warnc: S.phase === 'ANSWERING' }">{{ statusText }}</span>
          </div>
        </div>

        <div class="timeline">
          <div class="tl-title">本段视频的弹题点</div>
          <div v-if="!S.questionPoints.length" class="muted">{{ S.pointsLoaded ? '本节没有弹题点' : '还在读本节的弹题点 —— 视频页加载后自动读取' }}</div>
          <div class="tl-row">
            <div v-for="(q, i) in S.questionPoints" :key="i" class="tl-item" :class="q.state">
              <div class="tl-dot"></div>
              <div class="tl-t">{{ fmtT(q.timeSec) }}</div>
              <div class="tl-s">{{ q.state === 'done' ? '已答' : q.state === 'next' ? '下一题' : '未到' }}</div>
            </div>
          </div>
        </div>
        <div class="overview">
          <div class="ovhead">
            <span class="tl-title" style="margin:0">学习进度总览</span>
            <span class="muted">累计已学 {{ fmtT(S.summary.overall.watched) }} / {{ S.summary.overall.total ? fmtT(S.summary.overall.total) : '—' }}</span>
          </div>
          <div class="ovgrid">
            <div v-for="k in ovKeys" :key="k.key" class="ov">
              <div class="ovlabel">{{ k.label }}</div>
              <div class="ovpct">{{ pctText(S.summary[k.key].pct) }}<span>%</span></div>
              <div class="ovbar"><div class="ovfill" :class="k.key" :style="{ width: barW(S.summary[k.key].pct) }"></div></div>
              <div class="ovsub">{{ fmtT(S.summary[k.key].watched) }} / {{ fmtT(S.summary[k.key].total) }}</div>
            </div>
          </div>
        </div>
      </section>

      <section class="card lessons">
        <div class="cardhead">
          <span class="tag">课程目录</span>
          <span class="muted">{{ lessonsDone }}/{{ (S.lessons || []).length }} 节已完成 · 点任意一节可切过去</span>
        </div>
        <div v-if="!S.lessons || !S.lessons.length" class="muted pad">进入视频页后会自动读取课程目录</div>
        <div v-else class="lgroups">
          <div v-for="g in lessonGroups" :key="g.name" class="lgroup">
            <div class="gname">{{ g.name }}</div>
            <button
              v-for="l in g.items" :key="l.code" class="lrow"
              :class="{ cur: l.current, done: l.done }"
              :disabled="!!busy || l.current || isStopped || isIdle"
              @click="pickLesson(l)">
              <span class="lcode">{{ l.code }}</span>
              <span class="lname">{{ l.name }}</span>
              <span class="lstat">{{ lessonStat(l) }}</span>
            </button>
          </div>
        </div>
      </section>
      </div>

      <aside class="side">
        <section class="card nextq" :class="{ armed: S.phase === 'ARMED' }">
          <div class="cardhead"><span class="tag">下一题</span></div>
          <template v-if="S.phase === 'ANSWERING' || S.phase === 'ARMED'">
            <div class="big dim">正在弹题</div>
            <div class="muted">这题答完自动算下一题</div>
          </template>
          <template v-else-if="nextQ">
            <div class="big">{{ etaText }}</div>
            <div class="muted">视频走到 {{ fmtT(nextQ.atSec) }} 时弹出 · 题号 {{ nextQ.questionId }}</div>
          </template>
          <template v-else-if="!S.pointsLoaded">
            <div class="big dim">读取中</div>
            <div class="muted">正在读本节视频的弹题点</div>
          </template>
          <template v-else>
            <div class="big dim">本节没有更多题目</div>
            <div class="muted">{{ S.video.dur && S.video.ct >= S.video.dur - 1.5 ? '本节已播完，正在切下一节' : '本节的弹题点都答过了' }}</div>
          </template>
        </section>

        <section class="card">
          <div class="cardhead">
            <span class="tag">我的课程</span>
            <button class="btn mini" :disabled="coursesBusy || isIdle || isStopped" @click="loadCourses">
              {{ coursesBusy ? '读取中…' : '刷新' }}
            </button>
          </div>
          <div v-if="!courses.length" class="muted pad">点右上「刷新」读取你账号下的课程（不打断当前播放）</div>
          <ul v-else class="clist">
            <li
              v-for="(c, i) in courses" :key="i"
              class="crow" :class="{ cur: c.name === S.course.name }"
              :title="'切到《' + c.name + '》'"
              @click="pickCourse(i)">
              <div class="cname">{{ c.name }}</div>
              <div class="cmeta">
                <span>{{ c.school || c.teacher }}</span>
                <span class="cdot">·</span>
                <span>进度 {{ c.pct != null ? c.pct + '%' : '—' }}</span>
                <template v-if="c.now"><span class="cdot">·</span><span class="cnow">在学 {{ c.now }}</span></template>
              </div>
            </li>
          </ul>
        </section>

        <section class="card">
          <div class="cardhead"><span class="tag">自动答题</span></div>
          <div class="row">
            <div>
              <div class="k">开启后弹题自动作答</div>
              <div class="muted small">关闭时视频会停在弹题处等你手动答</div>
            </div>
            <button class="switch" :class="{ on: S.answers.auto }" :disabled="isStopped" @click="toggleAuto">
              <span class="knob"></span>
            </button>
          </div>
          <div class="row">
            <div>
              <div class="k">看完自动跳下一节</div>
              <div class="muted small">关闭后每节看完会停下，等你在下面目录里选</div>
            </div>
            <button class="switch" :class="{ on: S.answers.advance }" :disabled="isStopped" @click="toggleAdvance">
              <span class="knob"></span>
            </button>
          </div>
          <div class="row">
            <div>
              <div class="k">答题模型</div>
              <div class="muted small">{{ llmCheck.text || '点右边按钮试一下模型通不通' }}</div>
            </div>
            <button class="btn" :disabled="llmCheck.busy" @click="runLlmCheck">{{ llmCheck.busy ? '测试中…' : '测试模型' }}</button>
          </div>
          <div class="row"><div class="k">答题策略</div><div class="pill" :class="{ warnc: S.answers.strategy !== 'llm' }">{{ S.answers.strategy === 'llm' ? 'LLM 作答' : '随机（未配 Key）' }}</div></div>
          <div class="row"><div class="k">今日已答</div><div class="pill">{{ S.answers.count }} 题<template v-if="S.answers.right != null"> · 对 {{ S.answers.right }}</template></div></div>
        </section>

        <section class="card grow">
          <div class="cardhead"><span class="tag">最近答题</span></div>
          <div v-if="!S.history.length" class="muted pad">还没有答题记录</div>
          <ul class="hist">
            <li v-for="(h, i) in S.history.slice(0, 6)" :key="i">
              <span class="hi-idx">#{{ h.qid }}</span>
              <span class="hi-t">{{ h.summary }}</span>
              <span class="hi-r" :class="h.result === 'ok' ? 'okc' : 'badc'">{{ h.chosen }}</span>
            </li>
          </ul>
        </section>
      </aside>
    </main>

    <footer class="foot">
      <div class="loghead">运行日志</div>
      <div class="logs">
        <div v-for="(l, i) in logs" :key="i" class="logline" :class="l.kind">
          <span class="lt">{{ l.time }}</span><span class="lm">{{ l.msg }}</span>
        </div>
      </div>
    </footer>

    <transition name="fade">
      <div v-if="toast" class="toast" :class="toast.kind">{{ toast.msg }}</div>
    </transition>
  </div>
</template>

<style scoped>
.wrap{display:flex;flex-direction:column;min-height:100%;padding:18px 22px;gap:14px}
.top{display:flex;align-items:center;justify-content:space-between}
.brand{display:flex;gap:12px;align-items:center}
.logo{width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,#4c8dff,#3ddc97);
  display:grid;place-items:center;font-weight:700;color:#08111f}
.t1{font-weight:650;letter-spacing:.3px}
.t2{font-size:12px;color:var(--dim);display:flex;align-items:center;gap:6px}
.dot{width:7px;height:7px;border-radius:50%}
.dot.on{background:var(--ok);box-shadow:0 0 8px var(--ok)}
.dot.off{background:var(--bad)}
.sep{opacity:.4;margin:0 2px}
.acts{display:flex;gap:8px}
.btn{background:var(--panel2);color:var(--txt);padding:9px 14px;border:1px solid var(--line);display:flex;gap:7px;align-items:center}
.btn:hover{background:#1d2739;border-color:#2b3a52}
.btn.warn{color:var(--warn)} .btn.ok{color:var(--ok)} .btn.bad{color:var(--bad)}
.btn.primary{background:linear-gradient(135deg,#4c8dff,#3ddc97);color:#08111f;font-weight:650;border:none;padding:10px 18px}
.btn.primary:hover{filter:brightness(1.08)}
.hintwrap{position:fixed;left:20px;bottom:20px;z-index:60;width:min(560px,calc(100vw - 40px))}
.hintbar{display:flex;gap:9px;align-items:flex-start;font-size:13px;border-radius:11px;padding:11px 12px 11px 14px;
  border:1px solid #3a5f9e;background:#101c33;color:#bcd0f0;box-shadow:0 12px 34px rgba(0,0,0,.5)}
.htext{flex:1;line-height:1.55}
.hint-x{background:transparent;border:none;color:inherit;opacity:.6;font-size:17px;line-height:1;padding:0 6px;
  cursor:pointer;border-radius:6px;flex:none}
.hint-x:hover{opacity:1;background:rgba(255,255,255,.09)}
.hintbar.warn{border-color:#5a4a1f;background:#241d0d;color:#f0d79a}
.hintbar.act{border-color:#6b3f9e;background:#221436;color:#dcc6ff}
.hintbar.bad{border-color:#6b2b33;background:#251014;color:#ffb3b3}
.hi{width:18px;height:18px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:700;
  background:#2b3a52;color:#dfe8f6;flex:none}
.ic{font-size:11px}
.grid{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:14px;flex:none;align-items:start}
.card{background:linear-gradient(180deg,rgba(22,30,46,.9),rgba(18,24,38,.9));border:1px solid var(--line);
  border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:10px}
.course{gap:14px}
.cardhead{display:flex;justify-content:space-between;align-items:center}
.tag{font-size:12px;color:var(--dim);letter-spacing:1px}
.muted{color:var(--dim);font-size:12px}
.small{font-size:11px}
h1{margin:0;font-size:21px;font-weight:650}
.sub{color:#b9c6da;font-size:13px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.badge{background:#1b2740;color:#8fb4ff;border:1px solid #27406b;border-radius:999px;padding:2px 9px;font-size:11px}
.pv{display:flex;flex-direction:column;gap:8px;margin-top:4px}
.pvtop{display:flex;justify-content:space-between;align-items:baseline}
.time{font-size:26px;font-variant-numeric:tabular-nums;font-weight:600}
.bar{height:10px;border-radius:999px;background:#0d1320;overflow:hidden;border:1px solid #1a2437}
.fill{height:100%;background:linear-gradient(90deg,#4c8dff,#3ddc97);transition:width .5s linear}
.pvbottom{display:flex;justify-content:space-between;font-size:12px}
.okc{color:var(--ok)} .badc{color:var(--bad)} .warnc{color:var(--warn)}
.timeline{border-top:1px dashed var(--line);padding-top:12px}
.overview{border-top:1px dashed var(--line);padding-top:12px;display:flex;flex-direction:column;gap:12px}
.ovhead{display:flex;justify-content:space-between;align-items:baseline}
.ovgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.ov{background:#0f1626;border:1px solid var(--line);border-radius:11px;padding:11px 13px;display:flex;flex-direction:column;gap:7px}
.ovlabel{font-size:12px;color:var(--dim)}
.ovpct{font-size:26px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1}
.ovpct span{font-size:14px;font-weight:600;color:var(--dim);margin-left:2px}
.ovbar{height:7px;border-radius:999px;background:#0a1220;border:1px solid #1a2437;overflow:hidden}
.ovfill{height:100%;border-radius:999px;transition:width .5s linear}
.ovfill.section{background:linear-gradient(90deg,#4c8dff,#3ddc97)}
.ovfill.chapter{background:linear-gradient(90deg,#4c8dff,#8f7bff)}
.ovfill.course{background:linear-gradient(90deg,#ffb454,#ff8f6b)}
.ovfill.overall{background:linear-gradient(90deg,#3ddc97,#4c8dff)}
.ovsub{font-size:11px;color:var(--dim2);font-variant-numeric:tabular-nums}
.tl-title{font-size:12px;color:var(--dim);margin-bottom:10px}
.tl-row{display:flex;gap:10px;flex-wrap:wrap}
.tl-item{flex:1;min-width:96px;background:#0f1626;border:1px solid var(--line);border-radius:10px;padding:9px 11px}
.tl-item.done{border-color:#1f4d3a;background:#0f2119}
.tl-item.next{border-color:#3a5f9e;background:#101c33}
.tl-dot{width:7px;height:7px;border-radius:50%;background:#33415c;margin-bottom:7px}
.tl-item.done .tl-dot{background:var(--ok)}
.tl-item.next .tl-dot{background:var(--acc);box-shadow:0 0 8px var(--acc)}
.tl-t{font-variant-numeric:tabular-nums;font-weight:600}
.tl-s{font-size:11px;color:var(--dim)}
.lessons{gap:8px;min-height:210px;max-height:380px;flex:none;overflow:hidden}
.lgroups{overflow:auto;display:flex;flex-direction:column;gap:12px;padding-right:4px;min-height:0;flex:1 1 auto}
.lgroups::-webkit-scrollbar{width:8px}
.lgroups::-webkit-scrollbar-thumb{background:#2b3a52;border-radius:8px}
.lgroup{display:flex;flex-direction:column;gap:5px}
.gname{font-size:12px;color:var(--dim);margin:2px 0 5px}
.lrow{display:grid;grid-template-columns:44px 1fr auto;gap:8px;align-items:center;text-align:left;
  background:#0f1626;border:1px solid var(--line);border-radius:9px;padding:7px 10px;font-size:12px;color:var(--txt)}
.lrow:hover{background:#141d2e;border-color:#2b3a52}
.lrow:disabled{opacity:.85;cursor:default}
.lrow.cur{border-color:#3a5f9e;background:#101c33}
.lrow.done .lcode{color:var(--ok)}
.lcode{color:var(--dim);font-variant-numeric:tabular-nums}
.lname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lstat{font-size:11px;color:var(--dim2);font-variant-numeric:tabular-nums}
.lrow.cur .lstat{color:var(--warn)}
.left{display:flex;flex-direction:column;gap:14px;min-width:0}
.left::-webkit-scrollbar,.clist::-webkit-scrollbar{width:8px}
.left::-webkit-scrollbar-thumb,.clist::-webkit-scrollbar-thumb{background:#2b3a52;border-radius:8px}
.side{display:flex;flex-direction:column;gap:14px;min-height:0;position:sticky;top:0}
.nextq .big{font-size:34px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:.5px}
.nextq.armed{border-color:#3a5f9e;box-shadow:0 0 0 1px #24406e inset,0 0 24px -12px #4c8dff}
.big.dim{color:var(--dim2);font-size:20px}
.row{display:flex;justify-content:space-between;align-items:center;gap:10px}
.k{font-size:13px}
.pill{background:#0f1626;border:1px solid var(--line);border-radius:999px;padding:3px 10px;font-size:12px;color:#9db0cc}
.switch{width:46px;height:26px;border-radius:999px;background:#1b2740;border:1px solid #2b3a52;position:relative;flex:none}
.switch.on{background:#1d4d38;border-color:#2f7d5a}
.knob{position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#8b9bb4;transition:.18s}
.switch.on .knob{left:23px;background:var(--ok)}
.hist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:7px;overflow:auto}
.hist li{display:grid;grid-template-columns:56px 1fr auto;gap:8px;align-items:center;
  background:#0f1626;border:1px solid var(--line);border-radius:9px;padding:7px 10px;font-size:12px}
.hi-idx{color:var(--dim2);font-variant-numeric:tabular-nums}
.hi-t{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hi-r{font-weight:600}
.pad{padding:6px 2px}
.grow{min-height:0;flex:1}
.foot{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px 14px;max-height:180px;flex:none;display:flex;flex-direction:column;gap:6px}
.loghead{font-size:12px;color:var(--dim)}
.logs{overflow:auto;font:12px/1.6 ui-monospace,Consolas,monospace}
.logline{display:flex;gap:10px;white-space:pre-wrap}
.lt{color:var(--dim2);flex:none;font-variant-numeric:tabular-nums}
.logline.err .lm{color:var(--bad)}
.logline.warn .lm{color:var(--warn)}
.logline.ok .lm{color:#9ad3b5}
.empty{display:grid;place-items:center;flex:1;color:var(--dim)}
.toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);padding:10px 18px;border-radius:10px;
  background:#16233a;border:1px solid #2b3a52;font-size:13px;box-shadow:0 8px 30px rgba(0,0,0,.45)}
.toast.bad{border-color:#6b2b33;color:#ff9b9b}
.fade-enter-active,.fade-leave-active{transition:.2s}
.fade-enter-from,.fade-leave-to{opacity:0;transform:translate(-50%,8px)}
.clist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;max-height:260px;overflow:auto}
.crow{border:1px solid var(--line);border-radius:10px;padding:9px 11px;cursor:pointer;display:flex;flex-direction:column;gap:3px;background:#141c2b}
.crow:hover{border-color:#33507d;background:#182234}
.crow.cur{border-color:#2f6b52;background:#12241d;cursor:default}
.cname{font-size:13px;font-weight:600}
.cmeta{font-size:11px;color:var(--dim);display:flex;gap:4px;flex-wrap:wrap;align-items:center}
.cdot{opacity:.5}
.cnow{color:#8fb4ff}
</style>
