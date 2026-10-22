<script setup>
import { computed, reactive } from 'vue';
import { api } from '../api.js';
import { makeToggle } from '../composables/useAction.js';

const props = defineProps({
  state: { type: Object, required: true },
  isStopped: { type: Boolean, default: false },
  say: { type: Function, required: true },
});
const S = computed(() => props.state);

const llmCheck = reactive({ busy: false, text: '', ok: null });
async function runLlmCheck() {
  if (llmCheck.busy) return;
  llmCheck.busy = true;
  llmCheck.text = '正在用一道样题试模型…';
  try {
    const r = await api('/api/llmcheck');
    if (r.ok) {
      llmCheck.ok = true;
      llmCheck.text = (r.model || '模型') + ' 正常 · 样题选 ' + r.letter + ' 正确 · ' + r.ms + 'ms';
    } else {
      llmCheck.ok = false;
      llmCheck.text = '没通过：' + (r.why || '模型没给出可用答案');
    }
  } catch (e) {
    llmCheck.ok = false;
    llmCheck.text = '测试失败：' + (e.message || '服务没响应');
  } finally {
    llmCheck.busy = false;
  }
}

const toggle = makeToggle(api, (msg, kind) => props.say(msg, kind));
function toggleAuto() {
  if (!S.value) return;
  toggle({
    current: S.value.answers.auto,
    key: 'autoAnswer',
    on: '已开启自动答题',
    off: '已关闭自动答题（弹题时会暂停等你）',
  });
}
function toggleAdvance() {
  if (!S.value) return;
  toggle({
    current: S.value.answers.advance,
    key: 'autoAdvance',
    on: '已开启：看完自动跳下一节',
    off: '已关闭自动跳节（看完会停下等你选）',
  });
}
const llmOn = computed(() => S.value.answers.strategy === 'llm');
</script>

<template>
  <section class="card autop">
    <div class="chead">
      <span class="ctitle">自动答题</span>
      <span class="cmeta">弹题来了自动处理</span>
    </div>

    <div class="setrow">
      <div>
        <div class="sk">弹题自动作答</div>
        <div class="ss">关闭后视频会停在弹题处等你手答</div>
      </div>
      <button class="switch" :class="{ on: S.answers.auto }" :disabled="isStopped" @click="toggleAuto">
        <span class="knob"></span>
      </button>
    </div>

    <div class="setrow">
      <div>
        <div class="sk">看完自动跳下一节</div>
        <div class="ss">关闭后每节播完会停下，等你在目录里选</div>
      </div>
      <button class="switch" :class="{ on: S.answers.advance }" :disabled="isStopped" @click="toggleAdvance">
        <span class="knob"></span>
      </button>
    </div>

    <div class="setrow">
      <div style="min-width: 0">
        <div class="sk">答题模型</div>
        <div class="ss" :class="{ okc: llmCheck.ok === true, badc: llmCheck.ok === false }" :title="llmCheck.text">
          {{ llmCheck.text || '点右边试一下模型通不通' }}
        </div>
      </div>
      <button class="btn mini" :disabled="llmCheck.busy" @click="runLlmCheck">
        {{ llmCheck.busy ? '测试中…' : '测试模型' }}
      </button>
    </div>

    <div class="chiprow">
      <span class="chip" :class="llmOn ? 'ok' : 'warn'">策略 · {{ llmOn ? 'LLM 作答' : '随机（未配 Key）' }}</span>
      <span class="chip"
        >今日已答 {{ S.answers.count }} 题<template v-if="S.answers.right != null">
          · 对 {{ S.answers.right }}</template
        ></span
      >
    </div>
  </section>
</template>
