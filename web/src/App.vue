<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api, subscribe } from './api.js';
import { phaseText as phaseLabelOf } from './domain/format.js';
import { useAction } from './composables/useAction.js';
import CoursePanel from './components/CoursePanel.vue';
import QuizPanel from './components/QuizPanel.vue';
import LogPanel from './components/LogPanel.vue';
import './app.css';

const S = ref(null);
const logs = ref([]);
const connected = ref(false);
const toast = ref(null);
let es = null;

const phaseText = computed(() => phaseLabelOf(S.value));

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

function say(msg, kind) {
  toast.value = { msg, kind: kind || 'ok' };
  setTimeout(() => { toast.value = null; }, 2600);
}

// 开始/暂停/继续/重启/退出：共用一条 busy（同一时刻只允许一个动作）
const action = useAction(say);
const busy = action.busy;

async function startTask() {
  await action.run('start', async () => {
    await api('/api/start', {});
    say('已开始，正在启动浏览器…');
  }, { fail: '启动失败' });
}

async function ctl(name) {
  await action.run(name, async () => { await api('/api/control', { action: name }); }, { fail: '操作失败' });
}

const courses = computed(() => (S.value && S.value.courses) || []);
// 读课程列表有自己的 busy（旧课程目录里「刷新」的禁用/文案只看它，不能被其它动作带禁）
const courseAction = useAction(say);
const coursesBusy = courseAction.busy;

async function loadCourses() {
  await courseAction.run('courses', async () => {
    await api('/api/courses', {});
    say('正在读取你的课程列表…');
  }, { guard: true, fail: '读课程列表没成功' });
}

async function pickCourse(i) {
  const c = courses.value[i];
  if (!c) return;
  await action.run('course', async () => {
    await api('/api/course', { index: i });
    say('正在切到《' + c.name + '》…');
  }, { guard: true, fail: '切换课程没成功' });
}

async function pickLesson(l) {
  if (!S.value) return;
  await action.run('lesson', async () => {
    await api('/api/lesson', { code: l.code });
    say('正在切到 ' + l.code + ' ' + l.name);
  }, { guard: true, fail: '切换没成功' });
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
        <CoursePanel
          :state="S" :busy="busy" :is-idle="isIdle" :is-stopped="isStopped"
          :has-course="hasCourse" @pick-lesson="pickLesson" />
      </div>

      <aside class="side">
        <QuizPanel
          :state="S" :courses-busy="!!coursesBusy" :is-idle="isIdle" :is-stopped="isStopped"
          :say="say" @refresh-courses="loadCourses" @pick-course="pickCourse" />
      </aside>
    </main>

    <LogPanel :logs="logs" />

    <transition name="fade">
      <div v-if="toast" class="toast" :class="toast.kind">{{ toast.msg }}</div>
    </transition>
  </div>
</template>
