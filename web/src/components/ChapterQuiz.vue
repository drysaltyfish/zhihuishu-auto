<script setup>
import { computed, reactive } from 'vue';
import { api } from '../api.js';
import { barW } from '../domain/format.js';
import { makeToggle } from '../composables/useAction.js';

const props = defineProps({
  state: { type: Object, required: true },
  say: { type: Function, required: true },
});

const S = computed(() => props.state);
// 后端字段可能还没推下来：一律给安全默认值
const auto = computed(() => (S.value ? S.value.quizAuto !== false : true));
const list = computed(() => (S.value && Array.isArray(S.value.quizzes) ? S.value.quizzes : []));
const quiz = computed(() => (S.value && S.value.quiz) || null);
const running = computed(() => !!(quiz.value && quiz.value.running));
const last = computed(() => (quiz.value && quiz.value.last) || null);
const titleShow = computed(() => (quiz.value && quiz.value.title) || '平时测试');
const doneCount = computed(() => list.value.filter((r) => (r.status || 'todo') === 'done').length);
const stepText = computed(() => {
  const q = quiz.value;
  if (!q) return '';
  if (q.n) return '第 ' + (q.i || 0) + '/' + q.n + ' 题';
  if (q.i) return '第 ' + q.i + ' 题';
  return '';
});
const progressStyle = computed(() => {
  const q = quiz.value;
  const v = q && q.n ? ((q.i || 0) / q.n) * 100 : null;
  return { width: barW(v) };
});
// mock 给的题型带【】，真实引擎给「单选题」：两种都能显示
const typeText = computed(() => {
  const t = last.value && last.value.type;
  if (!t) return '';
  return /^【.*】$/.test(t) ? t : '（' + t + '）';
});
const chosenText = computed(() => {
  if (!last.value || !Array.isArray(last.value.chosen)) return '';
  return last.value.chosen.join('');
});
const resultClass = computed(() => {
  if (!last.value) return '';
  if (last.value.result === '正确') return 'okc';
  if (last.value.result === '错误') return 'badc';
  return 'muted';
});

const toggle = makeToggle(api, (msg, kind) => props.say(msg, kind));
function toggleAuto() {
  if (!S.value) return;
  toggle({
    current: auto.value,
    key: 'quizAuto',
    on: '已开启自动做章节测试',
    off: '已关闭自动做章节测试',
  });
}

const busyKey = reactive({ v: '' });
async function doNow(row) {
  if (!row || !row.key || busyKey.v || running.value) return;
  busyKey.v = row.key;
  try {
    await api('/api/control', { action: 'quiz', data: { key: row.key } });
    props.say('开始做「' + (row.title || row.key) + '」');
  } catch (e) {
    props.say(e.message || '开始没成功', 'bad');
  } finally {
    busyKey.v = '';
  }
}

function isTodo(row) {
  return (row.status || 'todo') === 'todo';
}

function tagText(row) {
  const st = row.status || 'todo';
  if (st === 'done') {
    const before = row.source === 'platform' ? '已交（之前）' : '已交';
    if (row.score == null) return before;
    return before + ' · 得分 ' + row.score + (row.total != null ? '/' + row.total : '');
  }
  if (st === 'doing') return '正在做';
  if (st === 'failed') return '失败';
  if (st === 'skipped') return '已跳过';
  return '未做';
}

function metaText(row) {
  const st = row.status || 'todo';
  if (st === 'todo') {
    const bits = [];
    if (row.count != null) bits.push(row.count + ' 题');
    if (row.total != null) bits.push(row.total + ' 分');
    return bits.length ? '未做（' + bits.join(' / ') + '）' : '未做';
  }
  if (st === 'done') return row.source === 'platform' ? '平台上这份已经交过，不会重复做' : '答完后自动交卷';
  if (st === 'doing') return '正在逐题作答，答完自动提交';
  if (st === 'failed') return row.note || '这次没做成，可以现在做重试';
  if (st === 'skipped') return '这次没做，视频看完后可补';
  return '未做';
}
</script>

<template>
  <section class="card quizcard">
    <div class="chead">
      <span class="ctitle">章节测试</span>
      <div class="qauto">
        <span class="cmeta">自动做章节测试</span>
        <button
          class="switch"
          :class="{ on: auto }"
          :disabled="!S"
          :title="auto ? '关掉后不会自动做章节测试' : '打开后每章看完自动做平时测试'"
          @click="toggleAuto"
        >
          <span class="knob"></span>
        </button>
      </div>
    </div>

    <template v-if="running">
      <div class="qprog">
        <span class="small" style="color: #d5dfee">正在做 {{ titleShow }}</span>
        <span class="cmeta">{{ stepText }}</span>
      </div>
      <div class="qbar"><div class="qbarfill" :style="progressStyle"></div></div>
      <div v-if="last" class="qlast">
        第 {{ last.num }} 题{{ typeText }}<template v-if="chosenText">选了 {{ chosenText }} · </template
        ><span :class="resultClass">{{ last.result || '未知' }}</span>
      </div>
    </template>

    <div v-if="!list.length" class="empty-line">进入课程后这里会列出每一章的平时测试</div>
    <ul v-else class="qlist">
      <li v-for="(row, i) in list" :key="row.key || i" class="qrow" :class="row.status || 'todo'">
        <span class="qdot"></span>
        <div class="qmain">
          <div class="qname" :title="row.title || row.chapter || row.key">{{ row.chapter || row.key }}</div>
          <div class="qmeta">{{ metaText(row) }}</div>
        </div>
        <button
          v-if="isTodo(row)"
          class="btn mini"
          :disabled="!!busyKey.v"
          :title="'现在做「' + (row.title || row.chapter || row.key) + '」'"
          @click="doNow(row)"
        >
          {{ busyKey.v === row.key ? '启动中…' : '现在做' }}
        </button>
        <span v-else class="qtag" :class="row.status" :title="(row.status === 'failed' && row.note) || ''">{{
          tagText(row)
        }}</span>
      </li>
    </ul>

    <div class="qfoot">
      已交 {{ doneCount }}/{{ list.length }} 章 · 每章视频全部看完后自动做该章平时测试，答完自动交卷；不碰期末。
    </div>
  </section>
</template>
