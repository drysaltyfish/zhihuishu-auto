<script setup>
/**
 * 日志页：全屏日志查看器，读共享 store 里 SSE 推来的最近 300 条。
 * 级别筛选 / 关键字搜索 / 自动滚动 / 清屏（只清前端）/ 导出（桌面版）。
 */
import { computed, nextTick, ref, watch } from 'vue';
import { logs, desktop, exportLogs, busy } from '../store.js';

const level = ref('all');
const kw = ref('');
const autoScroll = ref(true);
const base = ref(0); // 清屏游标：只影响显示，不动 store 里的日志
const box = ref(null);

/* 日志环刷新后长度变短（新的一轮）就把游标复位 */
watch(logs, () => {
  if (logs.value.length < base.value) base.value = 0;
});

const visible = computed(() => logs.value.slice(base.value));
const filtered = computed(() => {
  const q = kw.value.trim().toLowerCase();
  return visible.value.filter((r) => {
    const kind = r && r.kind ? r.kind : 'info';
    if (level.value === 'info' && !(kind === 'info' || kind === 'ok')) return false;
    if (level.value === 'warn' && kind !== 'warn') return false;
    if (level.value === 'err' && !(kind === 'err' || kind === 'bad')) return false;
    if (q) {
      const hay = String((r && r.msg) || '') + ' ' + String((r && r.time) || '');
      if (!hay.toLowerCase().includes(q)) return false;
    }
    return true;
  });
});

const counts = computed(() => {
  const c = { info: 0, warn: 0, err: 0 };
  for (const r of visible.value) {
    const k = r && r.kind ? r.kind : 'info';
    if (k === 'warn') c.warn += 1;
    else if (k === 'err' || k === 'bad') c.err += 1;
    else c.info += 1;
  }
  return c;
});

function scrollToEnd() {
  if (!autoScroll.value) return;
  nextTick(() => {
    if (box.value) box.value.scrollTop = box.value.scrollHeight;
  });
}
watch(() => filtered.value.length, scrollToEnd, { flush: 'post' });

function clearView() {
  base.value = logs.value.length;
}

const levels = [
  { key: 'all', label: '全部' },
  { key: 'info', label: '信息' },
  { key: 'warn', label: '警告' },
  { key: 'err', label: '错误' },
];
</script>

<template>
  <div class="page logs-page">
    <section class="card logscard">
      <div class="chead">
        <span class="ctitle">运行日志</span>
        <span class="cmeta">{{ filtered.length }}/{{ visible.length }} 条 · 最近 300 条自动推送</span>
      </div>

      <div class="logsbar">
        <div class="seg">
          <button
            v-for="l in levels"
            :key="l.key"
            class="segbtn"
            :class="{ on: level === l.key }"
            @click="level = l.key"
          >
            {{ l.label }}
          </button>
        </div>
        <input class="inp search" v-model="kw" placeholder="搜关键字，例如 登录 / 弹题 / 失败" spellcheck="false" />
        <div class="logsright">
          <span class="smlabel">自动滚动</span>
          <button
            class="switch"
            :class="{ on: autoScroll }"
            role="switch"
            :aria-checked="autoScroll"
            @click="autoScroll = !autoScroll"
          >
            <span class="knob"></span>
          </button>
          <button class="btn mini" @click="clearView">清屏</button>
          <button class="btn mini" :disabled="!!busy" @click="exportLogs">导出日志</button>
        </div>
      </div>

      <div ref="box" class="logview">
        <div v-if="!filtered.length" class="empty-line">
          <template v-if="!visible.length">还没有日志，开始听课后这里会实时刷出来</template>
          <template v-else
            >当前筛选下没有日志（信息 {{ counts.info }} · 警告 {{ counts.warn }} · 错误 {{ counts.err }}）</template
          >
        </div>
        <div v-for="(r, i) in filtered" :key="base + i" class="logline" :class="r.kind">
          <span class="lt">{{ r.time }}</span>
          <span class="lm">{{ r.msg }}</span>
        </div>
      </div>

      <div class="logsfoot">
        <span class="muted">信息 {{ counts.info }}</span>
        <span class="muted">警告 {{ counts.warn }}</span>
        <span class="muted">错误 {{ counts.err }}</span>
        <span class="dim logsfoot-r">{{
          desktop ? '清屏只清界面，导出会写文件' : '浏览器版：导出日志请用桌面版'
        }}</span>
      </div>
    </section>
  </div>
</template>
