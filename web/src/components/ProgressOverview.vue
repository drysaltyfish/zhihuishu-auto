<script setup>
import { computed } from 'vue';
import { barW, fmtClock, pctText } from '../domain/format.js';

const props = defineProps({
  state: { type: Object, required: true },
});
const S = computed(() => props.state);
const keys = [
  { key: 'section', label: '本节视频' },
  { key: 'chapter', label: '本章节' },
  { key: 'course', label: '本课程' },
  { key: 'overall', label: '全部课程' },
];
const pctOf = (k) => (S.value.summary && S.value.summary[k] ? S.value.summary[k].pct : null);
</script>

<template>
  <div class="ovstrip">
    <div v-for="k in keys" :key="k.key" class="ov">
      <div class="ovtop">
        <span class="ovlabel">{{ k.label }}</span>
        <span class="ovpct">{{ pctText(pctOf(k.key)) }}<i v-if="pctOf(k.key) !== null">%</i></span>
      </div>
      <div class="ovbar"><div class="ovfill" :class="k.key" :style="{ width: barW(pctOf(k.key)) }"></div></div>
      <div class="ovsub">{{ fmtClock(S.summary[k.key].watched) }} / {{ fmtClock(S.summary[k.key].total) }}</div>
    </div>
  </div>
</template>
