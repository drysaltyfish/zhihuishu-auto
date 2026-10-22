<script setup>
import { computed } from 'vue';
import { barW, fmtClock, pctText, statusText } from '../domain/format.js';
import LessonTree from './LessonTree.vue';

const props = defineProps({
  state: { type: Object, required: true },
  busy: { type: String, default: '' },
  isIdle: { type: Boolean, default: false },
  isStopped: { type: Boolean, default: false },
  hasCourse: { type: Boolean, default: false },
});
const emit = defineEmits(['pick-lesson']);

const ovKeys = [
  { key: 'section', label: '本节视频' },
  { key: 'chapter', label: '本章节' },
  { key: 'course', label: '本课程' },
  { key: 'overall', label: '全部课程' },
];

const S = computed(() => props.state);
const pct = computed(() => {
  const { ct, dur } = S.value.video;
  return dur ? Math.min(100, (ct / dur) * 100) : 0;
});
const lessons = computed(() => S.value.lessons || []);
const lessonsDone = computed(() => lessons.value.filter((l) => l.done).length);
</script>

<template>
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
        <span class="time">{{ fmtClock(S.video.ct) }} <span class="muted">/ {{ fmtClock(S.video.dur) }}</span></span>
        <span class="muted">倍速 {{ S.video.rate }}× · 已看 {{ fmtClock(S.progress.watchedSec) }}</span>
      </div>
      <div class="bar"><div class="fill" :style="{ width: pct.toFixed(2) + '%' }"></div></div>
      <div class="pvbottom">
        <span class="muted">任务点进度 {{ pctText(S.progress.taskPointPct) }}<template v-if="S.progress.taskPointPct !== null">%</template></span>
        <span class="muted" :class="{ okc: S.phase === 'PLAYING' && !S.video.paused, warnc: S.phase === 'ANSWERING' }">{{ statusText(S) }}</span>
      </div>
    </div>

    <div class="timeline">
      <div class="tl-title">本段视频的弹题点</div>
      <div v-if="!S.questionPoints.length" class="muted">{{ S.pointsLoaded ? '本节没有弹题点' : '还在读本节的弹题点 —— 视频页加载后自动读取' }}</div>
      <div class="tl-row">
        <div v-for="(q, i) in S.questionPoints" :key="i" class="tl-item" :class="q.state">
          <div class="tl-dot"></div>
          <div class="tl-t">{{ fmtClock(q.timeSec) }}</div>
          <div class="tl-s">{{ q.state === 'done' ? '已答' : q.state === 'next' ? '下一题' : '未到' }}</div>
        </div>
      </div>
    </div>
    <div class="overview">
      <div class="ovhead">
        <span class="tl-title" style="margin:0">学习进度总览</span>
        <span class="muted">累计已学 {{ fmtClock(S.summary.overall.watched) }} / {{ S.summary.overall.total ? fmtClock(S.summary.overall.total) : '—' }}</span>
      </div>
      <div class="ovgrid">
        <div v-for="k in ovKeys" :key="k.key" class="ov">
          <div class="ovlabel">{{ k.label }}</div>
          <div class="ovpct">{{ pctText(S.summary[k.key].pct) }}<span>%</span></div>
          <div class="ovbar"><div class="ovfill" :class="k.key" :style="{ width: barW(S.summary[k.key].pct) }"></div></div>
          <div class="ovsub">{{ fmtClock(S.summary[k.key].watched) }} / {{ fmtClock(S.summary[k.key].total) }}</div>
        </div>
      </div>
    </div>
  </section>

  <section class="card lessons">
    <div class="cardhead">
      <span class="tag">课程目录</span>
      <span class="muted">{{ lessonsDone }}/{{ (S.lessons || []).length }} 节已完成 · 点任意一节可切过去</span>
    </div>
    <LessonTree
      :lessons="lessons" :busy="busy" :is-idle="isIdle" :is-stopped="isStopped"
      @pick="emit('pick-lesson', $event)" />
  </section>
</template>
