<script setup>
defineProps({
  logs: { type: Array, default: () => [] },
});
</script>

<template>
  <footer class="foot">
    <div class="loghead">运行日志</div>
    <div class="logs">
      <div v-for="(l, i) in logs" :key="i" class="logline" :class="l.kind">
        <span class="lt">{{ l.time }}</span><span class="lm">{{ l.msg }}</span>
      </div>
    </div>
  </footer>
</template>
