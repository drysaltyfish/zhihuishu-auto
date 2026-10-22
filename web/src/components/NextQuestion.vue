<script setup>
import { computed } from 'vue';
import { fmtClock } from '../domain/format.js';
import { computeNextQuestion, etaText } from '../domain/next-question.js';

const props = defineProps({
  state: { type: Object, required: true },
});
const S = computed(() => props.state);
const nextQ = computed(() => computeNextQuestion(S.value));
const answering = computed(() => S.value.phase === 'ANSWERING' || S.value.phase === 'ARMED');
const atEnd = computed(() => {
  const v = S.value.video;
  return !!(v.dur && v.ct >= v.dur - 1.5);
});
</script>

<template>
  <section class="card nextq" :class="{ armed: answering }">
    <div class="chead">
      <span class="ctitle">下一题</span>
      <span v-if="nextQ" class="cmeta">题号 {{ nextQ.questionId }}</span>
    </div>

    <template v-if="answering">
      <div class="count dim">正在作答</div>
      <div class="nqsub">这题答完自动算下一题</div>
    </template>
    <template v-else-if="nextQ">
      <div class="count">{{ etaText(nextQ.etaSec) }}</div>
      <div class="nqsub">视频走到 {{ fmtClock(nextQ.atSec) }} 时弹出</div>
    </template>
    <template v-else-if="!S.pointsLoaded">
      <div class="count dim">读取中</div>
      <div class="nqsub">正在读本节视频的弹题点</div>
    </template>
    <template v-else>
      <div class="count dim">本节没有更多题目</div>
      <div class="nqsub">{{ atEnd ? '本节已播完，正在切下一节' : '本节的弹题点都答过了' }}</div>
    </template>
  </section>
</template>
