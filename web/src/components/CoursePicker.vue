<script setup>
import { computed, onBeforeUnmount, onMounted } from 'vue';

const props = defineProps({
  courses: { type: Array, default: () => [] },
  current: { type: String, default: '' },
  busy: { type: Boolean, default: false },
  isIdle: { type: Boolean, default: false },
  isStopped: { type: Boolean, default: false },
});
const emit = defineEmits(['close', 'refresh', 'pick']);

const list = computed(() => props.courses || []);
const blocked = computed(() => props.isIdle || props.isStopped);

function onKey(e) {
  if (e.key === 'Escape') emit('close');
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="modal" role="dialog" aria-label="我的课程">
      <div class="mhead">
        <span class="mtitle">我的课程</span>
        <span class="cmeta">{{ isIdle || isStopped ? '先「开始听课」才能切课' : '点一门课切过去，不打断当前进度' }}</span>
        <button class="btn mini" :disabled="busy" @click="emit('refresh')">{{ busy ? '读取中…' : '刷新' }}</button>
        <button class="btn mini" title="关闭" @click="emit('close')">✕</button>
      </div>
      <div class="mbody">
        <div v-if="!list.length" class="mempty">
          {{ busy ? '正在读取你账号下的课程…' : '还没有课程列表，点右上「刷新」读一次' }}
        </div>
        <button
          v-for="(c, i) in list" :key="i" class="mrow" :class="{ cur: c.name === current }"
          :disabled="blocked" :title="'切到《' + c.name + '》'" @click="emit('pick', i)">
          <div class="mgrow">
            <div class="mname">{{ c.name }}</div>
            <div class="mmeta">
              <span>{{ c.school || c.teacher }}</span>
              <span class="meta-sep">·</span>
              <span>进度 {{ c.pct != null ? c.pct + '%' : '—' }}</span>
              <template v-if="c.now"><span class="meta-sep">·</span><span class="mnow">在学 {{ c.now }}</span></template>
            </div>
          </div>
          <span v-if="c.name === current" class="mtag">当前</span>
        </button>
      </div>
    </div>
  </div>
</template>
