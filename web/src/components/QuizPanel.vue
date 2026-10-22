<script setup>
import { computed, reactive } from 'vue';
import { api } from '../api.js';
import { fmtClock } from '../domain/format.js';
import { computeNextQuestion, etaText } from '../domain/next-question.js';
import { makeToggle } from '../composables/useAction.js';

const props = defineProps({
  state: { type: Object, required: true },
  coursesBusy: { type: Boolean, default: false },
  isIdle: { type: Boolean, default: false },
  isStopped: { type: Boolean, default: false },
  say: { type: Function, required: true },
});
const emit = defineEmits(['refresh-courses', 'pick-course']);

const S = computed(() => props.state);
const courses = computed(() => (S.value && S.value.courses) || []);
const nextQ = computed(() => computeNextQuestion(S.value));
const etaShow = computed(() => (nextQ.value ? etaText(nextQ.value.etaSec) : '无'));

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

const toggle = makeToggle(api, (msg, kind) => props.say(msg, kind));

function toggleAdvance() {
  if (!S.value) return;
  toggle({ current: S.value.answers.advance, key: 'autoAdvance', on: '已开启：看完自动跳下一节', off: '已关闭自动跳节（看完会停下等你选）' });
}

function toggleAuto() {
  if (!S.value) return;
  toggle({ current: S.value.answers.auto, key: 'autoAnswer', on: '已开启自动答题', off: '已关闭自动答题（弹题时会暂停等你）' });
}
</script>

<template>
  <section class="card nextq" :class="{ armed: S.phase === 'ARMED' }">
    <div class="cardhead"><span class="tag">下一题</span></div>
    <template v-if="S.phase === 'ANSWERING' || S.phase === 'ARMED'">
      <div class="big dim">正在弹题</div>
      <div class="muted">这题答完自动算下一题</div>
    </template>
    <template v-else-if="nextQ">
      <div class="big">{{ etaShow }}</div>
      <div class="muted">视频走到 {{ fmtClock(nextQ.atSec) }} 时弹出 · 题号 {{ nextQ.questionId }}</div>
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
      <button class="btn mini" :disabled="coursesBusy || isIdle || isStopped" @click="emit('refresh-courses')">
        {{ coursesBusy ? '读取中…' : '刷新' }}
      </button>
    </div>
    <div v-if="!courses.length" class="muted pad">点右上「刷新」读取你账号下的课程（不打断当前播放）</div>
    <ul v-else class="clist">
      <li
        v-for="(c, i) in courses" :key="i"
        class="crow" :class="{ cur: c.name === S.course.name }"
        :title="'切到《' + c.name + '》'"
        @click="emit('pick-course', i)">
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
</template>
