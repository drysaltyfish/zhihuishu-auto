<script setup>
/**
 * 设置页：模型设置（/api/config）+ 自动化开关（/api/settings）+ 桌面能力 + 关于。
 * 服务端还没实现 /api/config 时优雅降级：顶部提示「服务端版本较旧，请重启程序」，表单仍可看。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue';
import {
  S,
  llm,
  serverVersion,
  configError,
  desktop,
  autoStart,
  update,
  busy,
  say,
  loadConfig,
  saveConfig,
  setAuto,
  setAutoStart,
  loadAutoStart,
  openDataDir,
  exportLogs,
  checkUpdate,
  installUpdate,
  restartApp,
  control,
  llmCheck,
} from '../store.js';

/* ---------- 模型设置表单 ---------- */
const form = reactive({ apiKey: '', baseUrl: '', model: '', timeoutMs: 20000 });
const showKey = ref(false);

function fillFrom(llmValue) {
  const v = llmValue || {};
  form.apiKey = '';
  form.baseUrl = v.baseUrl || '';
  form.model = v.model || '';
  form.timeoutMs = v.timeoutMs || 20000;
}
watch(llm, fillFrom, { immediate: true });

onMounted(() => {
  loadConfig();
  loadAutoStart();
});

const hasKey = computed(() => !!(llm.value && llm.value.hasKey));
const keyMask = computed(() => (llm.value && llm.value.keyMask) || '');
const keyPlaceholder = computed(() => {
  if (hasKey.value) {
    return keyMask.value ? '已保存 ' + keyMask.value + '（留空表示不修改）' : '已保存（留空表示不修改）';
  }
  return '粘贴你的 API Key，例如 sk-…';
});
const provider = computed(() => (llm.value && llm.value.provider) || 'openai-compatible');
const saving = computed(() => busy.value === 'config');

function buildPatch() {
  const patch = {
    baseUrl: String(form.baseUrl || '').trim(),
    model: String(form.model || '').trim(),
    timeoutMs: Number(form.timeoutMs) || 20000,
  };
  const key = String(form.apiKey || '').trim();
  if (key) patch.apiKey = key;
  return patch;
}

async function persist() {
  if (busy.value) return false;
  const t = Number(form.timeoutMs);
  if (!Number.isFinite(t) || t < 3000 || t > 180000) {
    say('超时时间要在 3～180 秒之间（一般 20 秒就够）', 'warn');
    return false;
  }
  const ok = await saveConfig(buildPatch());
  if (ok) {
    say('模型设置已保存');
    form.apiKey = '';
    showKey.value = false;
  }
  return ok;
}

async function clearKey() {
  if (busy.value) return;
  const ok = await saveConfig({}, { clearKey: true });
  if (ok) say('已清除保存的 API Key');
}

async function saveAndRestart() {
  const ok = await persist();
  if (!ok) return;
  const done = await control('restart');
  if (done) {
    say('后台正在重启，页面会在 2 秒后刷新…');
    setTimeout(() => location.reload(), 2200);
  }
}

async function testModel() {
  if (busy.value) return;
  say('正在测试模型…');
  const r = await llmCheck();
  if (r && r.ok) {
    say('模型连通' + (r.model ? '：' + r.model : ''), '');
  } else {
    say('模型自检没通过：' + ((r && (r.why || r.message)) || '请检查 Key、Base URL 和模型名'), 'warn');
  }
}

/* ---------- 自动化开关 ---------- */
const auto = computed(() => {
  const s = S.value;
  return {
    autoAnswer: !!(s && s.answers && s.answers.auto),
    autoAdvance: !!(s && s.answers && s.answers.advance),
    quizAuto: !!(s && s.quizAuto),
  };
});

async function toggle(key, cur, onText, offText) {
  await setAuto(key, !cur, cur ? offText : onText);
}

/* ---------- 桌面能力 ---------- */
const version = computed(() => (desktop && desktop.version) || serverVersion.value || '—');
const canInstallUpdate = computed(
  () => !!update.value && ['available', 'downloading', 'ready'].includes(update.value.state)
);
const installLabel = computed(() => {
  const s = update.value && update.value.state;
  if (s === 'ready') return '重启并安装';
  if (s === 'downloading') return '下载中…';
  return '下载更新';
});
const updateText = computed(() => {
  const u = update.value;
  if (!u) return '';
  if (u.version && u.state && u.state !== 'latest') return '发现新版本 ' + u.version;
  if (u.message) return u.message;
  return u.state === 'latest' ? '已经是最新版本' : u.state || '';
});
</script>

<template>
  <div v-if="!S" class="empty">正在读取状态…</div>
  <div v-else class="page">
    <section class="card">
      <div class="chead">
        <span class="ctitle">模型设置</span>
        <span class="cmeta">用大模型自动答弹题 · 只保存在本机</span>
      </div>
      <div v-if="configError" class="degrade">
        <span class="di">!</span>
        <span class="dtext">{{ configError }}</span>
        <button class="btn mini" @click="loadConfig">重试</button>
      </div>
      <div class="formgrid">
        <label class="flabel" for="cfg-key">API Key</label>
        <div class="krow">
          <input
            id="cfg-key"
            class="inp"
            :type="showKey ? 'text' : 'password'"
            v-model="form.apiKey"
            :placeholder="keyPlaceholder"
            autocomplete="off"
            spellcheck="false"
          />
          <button class="btn mini" @click="showKey = !showKey">{{ showKey ? '隐藏' : '显示' }}</button>
        </div>

        <label class="flabel" for="cfg-base">Base URL</label>
        <input
          id="cfg-base"
          class="inp"
          v-model="form.baseUrl"
          spellcheck="false"
          placeholder="https://api.deepseek.com/v1"
        />

        <label class="flabel" for="cfg-model">模型名</label>
        <input id="cfg-model" class="inp" v-model="form.model" spellcheck="false" placeholder="deepseek-chat" />

        <label class="flabel" for="cfg-timeout">请求超时</label>
        <div class="krow">
          <input
            id="cfg-timeout"
            class="inp"
            type="number"
            min="3000"
            max="180000"
            step="1000"
            v-model.number="form.timeoutMs"
          />
          <span class="unit">毫秒</span>
        </div>

        <span class="flabel">接口格式</span>
        <span class="fvalue">{{ provider }}</span>
      </div>
      <div class="fhint">Key 只写进本机 data 目录，不会上传；填了新的才会覆盖，留空就是沿用已保存的那个。</div>
      <div class="fbtns">
        <button class="btn primary" :disabled="!!busy" @click="persist">{{ saving ? '保存中…' : '保存设置' }}</button>
        <button class="btn" :disabled="!!busy" @click="saveAndRestart">保存并重启后台</button>
        <button class="btn" :disabled="!!busy" @click="testModel">测试模型</button>
        <button v-if="hasKey" class="btn bad" :disabled="!!busy" @click="clearKey">清除 Key</button>
      </div>
    </section>

    <section class="card">
      <div class="chead">
        <span class="ctitle">自动化开关</span>
        <span class="cmeta">改完立刻生效，不用重启</span>
      </div>
      <div class="setrow">
        <div class="sdesc">
          <div class="sk">弹题自动作答</div>
          <div class="ss">视频中间弹出题目时，自动选一个答案交上去</div>
        </div>
        <button
          class="switch"
          :class="{ on: auto.autoAnswer }"
          role="switch"
          :aria-checked="auto.autoAnswer"
          @click="toggle('autoAnswer', auto.autoAnswer, '已开启弹题自动作答', '已关闭弹题自动作答')"
        >
          <span class="knob"></span>
        </button>
      </div>
      <div class="setrow">
        <div class="sdesc">
          <div class="sk">看完自动跳下一节</div>
          <div class="ss">一节看完后自己切到下一个任务点</div>
        </div>
        <button
          class="switch"
          :class="{ on: auto.autoAdvance }"
          role="switch"
          :aria-checked="auto.autoAdvance"
          @click="toggle('autoAdvance', auto.autoAdvance, '已开启自动跳下一节', '已关闭自动跳下一节')"
        >
          <span class="knob"></span>
        </button>
      </div>
      <div class="setrow">
        <div class="sdesc">
          <div class="sk">自动做章节测试</div>
          <div class="ss">章节学完后自动把测试题答了</div>
        </div>
        <button
          class="switch"
          :class="{ on: auto.quizAuto }"
          role="switch"
          :aria-checked="auto.quizAuto"
          @click="toggle('quizAuto', auto.quizAuto, '已开启自动章节测试', '已关闭自动章节测试')"
        >
          <span class="knob"></span>
        </button>
      </div>
    </section>

    <section class="card">
      <div class="chead">
        <span class="ctitle">桌面能力</span>
        <span class="cmeta">{{ desktop ? '桌面版 · v' + version : '浏览器版' }}</span>
      </div>
      <template v-if="desktop">
        <div class="setrow">
          <div class="sdesc">
            <div class="sk">数据目录</div>
            <div class="ss">账号、日志和配置都放在这里</div>
          </div>
          <button class="btn mini" @click="openDataDir">打开</button>
        </div>
        <div class="setrow">
          <div class="sdesc">
            <div class="sk">导出日志</div>
            <div class="ss">把运行日志存成一个文件，方便排查问题</div>
          </div>
          <button class="btn mini" :disabled="!!busy" @click="exportLogs">导出日志</button>
        </div>
        <div class="setrow">
          <div class="sdesc">
            <div class="sk">开机自启</div>
            <div class="ss">开机后自动在后台跑，不弹窗口</div>
          </div>
          <button
            class="switch"
            :class="{ on: !!autoStart }"
            role="switch"
            :aria-checked="!!autoStart"
            @click="setAutoStart(!autoStart)"
          >
            <span class="knob"></span>
          </button>
        </div>
        <div class="setrow">
          <div class="sdesc">
            <div class="sk">检查更新</div>
            <div class="ss">{{ updateText || '看看有没有新版本' }}</div>
          </div>
          <button class="btn mini" :disabled="!!busy" @click="checkUpdate">检查更新</button>
        </div>
        <div class="setrow" v-if="canInstallUpdate">
          <div class="sdesc">
            <div class="sk">{{ update && update.state === 'ready' ? '安装更新' : '下载更新' }}</div>
            <div class="ss">
              {{ update && update.state === 'ready' ? '下载好了，点一下重启安装' : '下载完还要再点一次「重启并安装」' }}
            </div>
          </div>
          <button
            class="btn mini"
            :disabled="!!busy || (update && update.state === 'downloading')"
            @click="installUpdate"
          >
            {{ installLabel }}
          </button>
        </div>
        <div class="setrow">
          <div class="sdesc">
            <div class="sk">重启程序</div>
            <div class="ss">后台卡住时用这个，比手动关再开省事</div>
          </div>
          <button class="btn mini bad" @click="restartApp">重启程序</button>
        </div>
      </template>
      <div v-else class="muted">浏览器版：不需要这些</div>
    </section>

    <section class="card about">
      <div class="chead">
        <span class="ctitle">关于</span>
        <span class="cmeta">版本 {{ version }}</span>
      </div>
      <p class="about-p">智慧树自动听课 · 在你自己的电脑上跑的小工具：自动播课、自动答弹题、自动做章节测试。</p>
      <p class="about-p dim">
        免责声明：本工具只在本机运行，不会上传你的账号和课程数据；使用风险与平台规则请自行评估。
      </p>
      <div class="links">
        <span class="alink">README.md</span>
        <span class="sep">·</span>
        <span class="alink">docs/DESIGN.md</span>
        <span class="sep">·</span>
        <span class="alink">项目说明</span>
        <span class="dim">（仓库根目录下的文档）</span>
      </div>
    </section>
  </div>
</template>
