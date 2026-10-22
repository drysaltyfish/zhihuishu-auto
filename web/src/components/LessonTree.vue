<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { lessonStat } from '../domain/format.js';

const props = defineProps({
  lessons: { type: Array, default: () => [] },
  busy: { type: String, default: '' },
  isIdle: { type: Boolean, default: false },
  isStopped: { type: Boolean, default: false },
  /* true = 交给外层页面滚动（选课页全量展示），false = 卡片内自己滚（总览一屏） */
  autoHeight: { type: Boolean, default: false },
});
const emit = defineEmits(['pick']);

const groups = computed(() => {
  const out = [];
  for (const l of props.lessons || []) {
    const name = l.chapter || '未分章';
    let g = out.find((x) => x.name === name);
    if (!g) {
      g = { name, items: [], done: 0 };
      out.push(g);
    }
    g.items.push(l);
    if (l.done) g.done += 1;
  }
  return out;
});

// 列数按卡片宽度算；分组按顺序切成 N 段，既保持章节顺序又尽量等高。
const box = ref(null);
const cols = ref(4);
function measure() {
  const el = box.value;
  if (!el) return;
  const w = el.clientWidth || 0;
  const n = Math.max(1, Math.min(6, Math.floor((w + 14) / 244)));
  if (n !== cols.value) cols.value = n;
}
let ro = null;
onMounted(() => {
  measure();
  if (typeof ResizeObserver !== 'undefined' && box.value) {
    ro = new ResizeObserver(() => measure());
    ro.observe(box.value);
  }
});
onBeforeUnmount(() => {
  if (ro) ro.disconnect();
});

const buckets = computed(() => {
  const n = Math.max(1, cols.value);
  const gs = groups.value;
  if (!gs.length) return [[]];
  const weight = (g) => g.items.length + 1.2;
  const total = gs.reduce((s, g) => s + weight(g), 0);
  const goal = total / n;
  const out = [];
  let cur = [];
  let load = 0;
  for (let k = 0; k < gs.length; k++) {
    cur.push(gs[k]);
    load += weight(gs[k]);
    const left = gs.slice(k + 1).reduce((s, g) => s + weight(g), 0);
    const needMore = n - out.length - 1 > 0;
    if (needMore && load >= goal * (out.length + 1) && left > 0) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  while (out.length < n) out.push([]);
  return out;
});

// 当前节变化时滚到可见位置（只滚动目录卡片内部，不动整页）
watch(
  () => (props.lessons || []).find((l) => l.current),
  async (cur) => {
    if (!cur) return;
    await nextTick();
    const el = box.value && box.value.querySelector('.lrow.cur');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  },
  { immediate: true }
);
</script>

<template>
  <div v-if="!lessons || !lessons.length" class="empty-line">进入视频页后会自动读取课程目录</div>
  <div
    v-else
    ref="box"
    class="ltree"
    :class="{ full: autoHeight }"
    :style="{ gridTemplateColumns: 'repeat(' + cols + ',minmax(0,1fr))' }"
  >
    <div v-for="(col, ci) in buckets" :key="ci" class="lcol">
      <div v-for="g in col" :key="g.name" class="lgroup">
        <div class="gname">
          <b>{{ g.name }}</b
          ><span>{{ g.done }}/{{ g.items.length }}</span>
        </div>
        <button
          v-for="l in g.items"
          :key="l.code"
          class="lrow"
          :class="{ cur: l.current, done: l.done }"
          :disabled="!!busy || l.current || isStopped || isIdle"
          :title="l.code + ' ' + l.name"
          @click="emit('pick', l)"
        >
          <span class="lcode">{{ l.code }}</span>
          <span class="lname">{{ l.name }}</span>
          <span class="lstat">{{ lessonStat(l) }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
