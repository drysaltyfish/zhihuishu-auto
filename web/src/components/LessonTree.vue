<script setup>
import { computed } from 'vue';
import { lessonStat } from '../domain/format.js';

const props = defineProps({
  lessons: { type: Array, default: () => [] },
  busy: { type: String, default: '' },
  isIdle: { type: Boolean, default: false },
  isStopped: { type: Boolean, default: false },
});
const emit = defineEmits(['pick']);

const groups = computed(() => {
  const out = [];
  for (const l of props.lessons || []) {
    const name = l.chapter || '未分章';
    let g = out.find((x) => x.name === name);
    if (!g) { g = { name, items: [] }; out.push(g); }
    g.items.push(l);
  }
  return out;
});
</script>

<template>
  <div v-if="!lessons || !lessons.length" class="muted pad">进入视频页后会自动读取课程目录</div>
  <div v-else class="lgroups">
    <div v-for="g in groups" :key="g.name" class="lgroup">
      <div class="gname">{{ g.name }}</div>
      <button
        v-for="l in g.items" :key="l.code" class="lrow"
        :class="{ cur: l.current, done: l.done }"
        :disabled="!!busy || l.current || isStopped || isIdle"
        @click="emit('pick', l)">
        <span class="lcode">{{ l.code }}</span>
        <span class="lname">{{ l.name }}</span>
        <span class="lstat">{{ lessonStat(l) }}</span>
      </button>
    </div>
  </div>
</template>
