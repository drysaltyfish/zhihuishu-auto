<script setup>
import { computed } from 'vue';
import { fmtClock, pctText, statusText } from '../domain/format.js';
import ProgressOverview from './ProgressOverview.vue';

const props = defineProps({
  state: { type: Object, required: true },
  hasCourse: { type: Boolean, default: false },
  isIdle: { type: Boolean, default: false },
});
const S = computed(() => props.state);
const pct = computed(() => {
  const { ct, dur } = S.value.video;
  return dur ? Math.min(100, (ct / dur) * 100) : 0;
});
const phaseCls = computed(() => {
  const p = S.value.phase;
  if (p === 'PLAYING') return S.value.video.paused ? 'warn' : 'on';
  if (p === 'ARMED' || p === 'ANSWERING') return 'act';
  if (p === 'PAUSED' || p === 'WAIT_VERIFY' || p === 'WAIT_LOGIN') return 'warn';
  if (p === 'STOPPED' || p === 'ENDED') return 'bad';
  return '';
});
const pointText = (q) => (q.state === 'done' ? '已答' : q.state === 'next' ? '下一题' : '未到');
const headLabel = computed(() => {
  const p = S.value.phase;
  if (p === 'STOPPED' || p === 'ENDED') return '已结束';
  if (!props.hasCourse || p === 'IDLE') return '还没开始';
  return '正在学习';
});
</script>

<template>
  <section class="card hero" :class="{ idle: !hasCourse }">
    <div class="hhead">
      <div style="min-width:0">
        <div class="ctitle">{{ headLabel }}<span class="cmeta" style="margin-left:8px">{{ S.course.platform }}</span></div>
        <h1 :title="S.course.name">{{ S.course.name }}</h1>
        <div class="hsub">
          <span>{{ S.course.chapter }}</span><span class="sep">/</span><span>{{ S.course.taskPoint }}</span>
          <span v-if="hasCourse" class="badge">任务点 {{ S.course.index }}/{{ S.course.total }}</span>
        </div>
      </div>
      <div class="phasepill" :class="phaseCls"><span class="pd"></span>{{ statusText(S) }}</div>
    </div>

    <div class="playrow">
      <div class="clock">{{ fmtClock(S.video.ct) }}<em>/ {{ fmtClock(S.video.dur) }}</em></div>
      <div class="hmeta">
        <span>倍速 {{ S.video.rate }}×</span>
        <span>已看 {{ fmtClock(S.progress.watchedSec) }}</span>
        <span>任务点 {{ pctText(S.progress.taskPointPct) }}<template v-if="S.progress.taskPointPct !== null">%</template></span>
      </div>
    </div>
    <div class="bar"><div class="fill" :style="{ width: pct.toFixed(2) + '%' }"></div></div>

    <div class="points">
      <span class="plabel">本节弹题点</span>
      <template v-if="S.questionPoints.length">
        <span v-for="(q, i) in S.questionPoints" :key="i" class="pchip" :class="q.state">
          {{ fmtClock(q.timeSec) }} · {{ pointText(q) }}
        </span>
      </template>
      <span v-else class="muted small">{{ S.pointsLoaded ? '本节没有弹题点' : '进入视频页后自动读取' }}</span>
    </div>

    <ProgressOverview :state="S" />
  </section>
</template>