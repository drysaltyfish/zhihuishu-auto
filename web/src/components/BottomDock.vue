<script setup>
import { computed, nextTick, ref, watch } from 'vue';

const props = defineProps({
  logs: { type: Array, default: () => [] },
  history: { type: Array, default: () => [] },
});

const tab = ref('logs');
const body = ref(null);
const recent = computed(() => (props.history || []).slice(0, 40));

watch(
  () => props.logs.length,
  async () => {
    if (tab.value !== 'logs') return;
    await nextTick();
    if (body.value) body.value.scrollTop = body.value.scrollHeight;
  }
);

function pick(name) {
  tab.value = name;
}
</script>

<template>
  <footer class="dock">
    <div class="dockhead">
      <button class="tab" :class="{ on: tab === 'logs' }" @click="pick('logs')">运行日志</button>
      <button class="tab" :class="{ on: tab === 'history' }" @click="pick('history')">答题记录</button>
      <span class="dockmeta">{{ tab === 'logs' ? logs.length + ' 条' : (history.length || 0) + ' 条' }}</span>
    </div>
    <div ref="body" class="dockbody">
      <template v-if="tab === 'logs'">
        <div v-if="!logs.length" class="empty-line">还没有日志</div>
        <div v-for="(l, i) in logs" :key="i" class="logline" :class="l.kind">
          <span class="lt">{{ l.time }}</span
          ><span class="lm">{{ l.msg }}</span>
        </div>
      </template>
      <template v-else>
        <div v-if="!history.length" class="empty-line">还没有答题记录（弹题作答后会记在这里）</div>
        <div v-for="(h, i) in recent" :key="i" class="hrow">
          <span class="hq">#{{ h.qid }}</span>
          <span class="hs" :title="h.summary">{{ h.summary }}</span>
          <span class="hr" :class="h.result === 'ok' ? 'okc' : 'badc'">{{ h.chosen }}</span>
          <span class="hc">{{ h.result === 'ok' ? '答对' : h.result ? '答错' : '—' }}</span>
        </div>
      </template>
    </div>
  </footer>
</template>
