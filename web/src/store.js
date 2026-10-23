/**
 * 模块级单例 store：整个应用只保留一份状态、一份日志、一条 SSE 连接。
 * - App.vue 挂载时 init() 一次；卸载时 destroy()
 * - 各页面只 import 这里暴露的 ref / computed / action，不要各自再建 EventSource
 * - 所有 action 内部统一 try/catch，失败用 toast 报人话，不把堆栈丢给界面
 */
import { computed, ref, watch } from 'vue';
import { api, subscribe } from './api.js';
import { phaseText as phaseLabelOf } from './domain/format.js';

/* ---------------- 状态 ---------------- */
export const S = ref(null); // /api/state 全量状态
export const logs = ref([]); // SSE 推送的最近 300 条日志
export const connected = ref(false); // SSE 是否连着本地服务
export const ready = ref(false); // 是否已经收到过状态
export const toast = ref(null); // { text, kind }
export const busy = ref(''); // 当前进行中的动作名（空串=空闲）
export const hintDismissed = ref(''); // 被手动关掉的提示文案（文本级记忆）
export const pickerOpen = ref(false); // 顶部「我的课程」弹层
export const llm = ref(null); // /api/config 的 llm 字段
export const serverVersion = ref(''); // /api/config 返回的 version
export const configError = ref(''); // 读/存配置失败的原因（人话）
export const autoStart = ref(null); // 开机自启（仅桌面版）
export const update = ref(null); // 检查更新结果（仅桌面版）
export const desktop = typeof window !== 'undefined' && window.desktop ? window.desktop : null;

let es = null;
let toastTimer = null;
let noticeTimer = null;
const noticeMuted = ref(false);

/* ---------------- 小工具 ---------------- */
export function say(msg, kind = '') {
  toast.value = { text: String(msg || ''), kind };
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = null;
  }, 2600);
}

/** 把各种异常翻译成用户能看懂的一句话 */
export function humanError(e) {
  const raw = String((e && e.message) || '').trim();
  if (!raw) return '操作没成功，请稍后重试';
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(raw)) {
    return '连不上本地服务，请确认程序还在运行';
  }
  return raw;
}

async function run(name, fn) {
  busy.value = name;
  try {
    await fn();
    return true;
  } catch (e) {
    say(humanError(e), 'bad');
    return false;
  } finally {
    busy.value = '';
  }
}

/* ---------------- 派生状态 ---------------- */
export const phaseText = computed(() => phaseLabelOf(S.value));
export const hasCourse = computed(() => {
  const s = S.value;
  return !!(s && s.course && s.course.name && s.course.name !== '未选择课程');
});
export const isPaused = computed(() => !!S.value && (S.value.phase === 'PAUSED' || !!S.value.paused));
export const isStopped = computed(() => !!S.value && S.value.phase === 'STOPPED');
export const isIdle = computed(() => !S.value || S.value.phase === 'IDLE');
export const canStart = computed(() => isIdle.value || isStopped.value);
/** 需要扫码登录：登录浮层据此显示（后端登录成功后置回 false 并清空 qrUrl） */
export const loginNeeded = computed(() => !!(S.value && S.value.loginNeeded));
export const qrUrl = computed(() => (S.value && S.value.qrUrl) || '');
export const courses = computed(() => (S.value && Array.isArray(S.value.courses) ? S.value.courses : []));
export const lessons = computed(() => (S.value && Array.isArray(S.value.lessons) ? S.value.lessons : []));
export const lessonsDone = computed(() => lessons.value.filter((l) => l.done).length);
export const courseTitle = computed(() => (S.value && S.value.course && S.value.course.name) || '未选择课程');
export const history = computed(() => (S.value && Array.isArray(S.value.history) ? S.value.history : []));
export const coursePct = computed(() => {
  const sm = S.value && S.value.summary;
  return sm && sm.course ? sm.course.pct : null;
});
/** 后台 Chrome 窗口是不是露在外面（隐藏时被搬到屏幕外、任务栏也不显示） */
export const browserVisible = computed(() => !!(S.value && S.value.browserVisible));

/* notice 出现 7 秒后自动从提示条撤掉（与旧版行为一致） */
watch(
  () => (S.value ? S.value.notice : ''),
  (v) => {
    noticeMuted.value = false;
    if (noticeTimer) clearTimeout(noticeTimer);
    if (v)
      noticeTimer = setTimeout(() => {
        noticeMuted.value = true;
      }, 7000);
  },
  { immediate: true }
);

/* ---------------- 提示条 ---------------- */
export const hint = computed(() => {
  const s = S.value;
  if (!s) return null;
  if (s.phase === 'WAIT_VERIFY') {
    return { kind: 'act', icon: '!', text: s.verifyHint || '需要人机验证：请到浏览器窗口里点一下' };
  }
  /* 自动切节反复失败、已转人工：常驻提示（notice 会 7 秒后消失，这条不会），直到点「继续」 */
  if (s.manualHint) return { kind: 'act', icon: '!', text: s.manualHint, sticky: true };
  /* 登录阶段由全屏登录浮层负责（二维码 + 说明），这里不再重复一条提示条 */
  if (s.loginNeeded) return null;
  if (s.notice && !noticeMuted.value) {
    const bad = /没|失败|错误|异常|拒绝|无法|中断/.test(s.notice);
    return { kind: bad ? 'bad' : 'warn', icon: '!', text: s.notice };
  }
  if (s.phase === 'COURSE_PICK' && s.pickHint) return { kind: 'warn', icon: '!', text: s.pickHint };
  return null;
});

export const hintShow = computed(() => {
  const h = hint.value;
  if (!h) return null;
  if (h.sticky) return h; // 转人工提示常驻，不允许关掉
  return h.text !== hintDismissed.value ? h : null;
});

/* 提示文案变了就重新显示 */
watch(
  () => (hint.value ? hint.value.text : ''),
  () => {
    hintDismissed.value = '';
  }
);

export function dismissHint() {
  hintDismissed.value = (hint.value && hint.value.text) || '';
}

/* ---------------- 生命周期 ---------------- */
export async function init() {
  if (es) return;
  try {
    S.value = await api('/api/state');
    ready.value = true;
  } catch (e) {
    say(humanError(e), 'bad');
  }
  es = subscribe(
    (st) => {
      S.value = st;
      ready.value = true;
    },
    (rows) => {
      if (Array.isArray(rows)) logs.value = rows.slice(-300);
    },
    (ok) => {
      connected.value = ok;
    }
  );
  loadConfig();
  loadAutoStart();
}

export function destroy() {
  if (es) {
    es.close();
    es = null;
  }
}

/* ---------------- 动作 ---------------- */
export function start() {
  return run('start', async () => {
    await api('/api/start', {});
    say('已开始，正在启动浏览器…');
  });
}

export function control(name) {
  return run(name, async () => {
    await api('/api/control', { action: name });
  });
}

/** 显示 / 隐藏后台浏览器窗口：实际状态由 worker 搬完窗口后回写 browserVisible */
export function toggleBrowser() {
  return control(browserVisible.value ? 'hideBrowser' : 'showBrowser');
}

function applySettings(patch) {
  const s = S.value;
  if (!s) return;
  if ('autoAnswer' in patch) s.answers = { ...s.answers, auto: !!patch.autoAnswer };
  if ('autoAdvance' in patch) s.answers = { ...s.answers, advance: !!patch.autoAdvance };
  if ('quizAuto' in patch) s.quizAuto = !!patch.quizAuto;
}

/** 自动化开关：POST /api/settings，成功后本地状态先跟上（SSE 随后覆盖） */
export function setAuto(key, next, text) {
  return run('settings', async () => {
    await api('/api/settings', { [key]: next });
    applySettings({ [key]: next });
    if (text) say(text);
  });
}

export function loadCourses() {
  return run('courses', async () => {
    const r = await api('/api/courses', {});
    if (r && Array.isArray(r.courses) && S.value) S.value = { ...S.value, courses: r.courses };
  });
}

export function pickCourse(index) {
  return run('course', async () => {
    await api('/api/course', { index });
  });
}

export function pickLesson(lesson) {
  const code = typeof lesson === 'string' ? lesson : (lesson && lesson.code) || '';
  return run('lesson', async () => {
    await api('/api/lesson', { code });
  });
}

/** 模型自检：不抛异常，统一返回 { ok, why, ... } */
export async function llmCheck() {
  busy.value = 'llmcheck';
  try {
    return await api('/api/llmcheck');
  } catch (e) {
    return { ok: false, why: humanError(e) };
  } finally {
    busy.value = '';
  }
}

/* ---------------- 配置文件（/api/config） ---------------- */
/** 兼容后端两种返回形状：{config:{llm,version}} 与旧的 {llm,version} */
function normalizeConfig(r) {
  const c = (r && r.config) || {};
  const l = c.llm || (r && r.llm) || {};
  const masked = l.apiKeyMasked || l.keyMask || '';
  const hasKey = typeof l.hasApiKey === 'boolean' ? l.hasApiKey : typeof l.hasKey === 'boolean' ? l.hasKey : !!masked;
  return {
    provider: l.provider || 'openai-compatible',
    baseUrl: l.baseUrl || '',
    model: l.model || '',
    timeoutMs: l.timeoutMs || 20000,
    hasApiKey: hasKey,
    hasKey,
    apiKeyMasked: masked,
    keyMask: masked,
  };
}

export async function loadConfig() {
  try {
    const r = await api('/api/config');
    llm.value = normalizeConfig(r);
    serverVersion.value = (r && r.config && r.config.version) || (r && r.version) || '';
    configError.value = '';
    return true;
  } catch (e) {
    configError.value = humanError(e);
    return false;
  }
}

/** 保存模型设置：PUT /api/config；opts.clearKey=true 表示清空已保存的 Key */
export function saveConfig(patch, opts = {}) {
  return run('config', async () => {
    const body = { llm: patch || {} };
    if (opts.clearKey) body.clearKey = true;
    const r = await api('/api/config', body, { method: 'PUT' });
    if (r && (r.config || r.llm)) llm.value = normalizeConfig(r);
    serverVersion.value = (r && r.config && r.config.version) || (r && r.version) || serverVersion.value;
    configError.value = '';
  });
}

/* ---------------- 桌面能力（window.desktop 以后由 preload 注入） ---------------- */
export function openDataDir() {
  if (!desktop) {
    say('浏览器版没有数据目录，请用桌面版打开', 'warn');
    return;
  }
  Promise.resolve(desktop.openDataDir())
    .then((r) => {
      if (r && r.ok === false) say((r && r.message) || '打开数据目录没成功', 'bad');
    })
    .catch(() => say('打开数据目录没成功', 'bad'));
}

export async function exportLogs() {
  if (!desktop || typeof desktop.exportLogs !== 'function') {
    say('浏览器版不支持导出日志，请用桌面版', 'warn');
    return false;
  }
  return run('export', async () => {
    const r = await desktop.exportLogs();
    if (!r || r.ok === false) throw new Error((r && r.message) || '导出日志没成功');
    const p = r.path || '';
    say(p ? '已导出日志：' + p : '已导出日志');
    // 让资源管理器选中这个 zip（openPath 对文件会定位而不是用压缩软件打开）
    if (p && typeof desktop.openPath === 'function') {
      try {
        const rr = await desktop.openPath(p);
        if (rr && rr.ok === false) say(rr.message || '导出成功，但没能打开文件所在的位置', 'warn');
      } catch (e) {
        /* 打开失败不影响导出结果 */
      }
    }
  });
}

export async function loadAutoStart() {
  if (!desktop || typeof desktop.getAutoStart !== 'function') return;
  try {
    const r = await desktop.getAutoStart();
    autoStart.value = !!(r && r.enabled);
  } catch (e) {
    /* 读不到就先不显示状态 */
  }
}

export async function setAutoStart(next) {
  if (!desktop || typeof desktop.setAutoStart !== 'function') {
    say('浏览器版不支持开机自启，请用桌面版', 'warn');
    return;
  }
  try {
    const r = await desktop.setAutoStart(!!next);
    autoStart.value = !!(r && r.enabled);
    say(autoStart.value ? '已开启开机自启' : '已关闭开机自启');
  } catch (e) {
    say('设置开机自启没成功', 'bad');
  }
}

export async function checkUpdate() {
  if (!desktop || typeof desktop.checkUpdate !== 'function') {
    say('浏览器版不支持检查更新，请用桌面版', 'warn');
    return;
  }
  busy.value = 'update';
  try {
    const r = await desktop.checkUpdate();
    update.value = r || null;
    if (r && r.message) say(r.message, r.ok === false ? 'warn' : '');
    else if (r && r.state === 'latest') say('已经是最新版本');
  } catch (e) {
    say('检查更新失败，请稍后再试', 'bad');
  } finally {
    busy.value = '';
  }
}

export async function installUpdate() {
  if (!desktop || typeof desktop.installUpdate !== 'function') {
    say('浏览器版不支持更新，请用桌面版', 'warn');
    return;
  }
  busy.value = 'update';
  try {
    const r = await desktop.installUpdate();
    if (r && r.message) say(r.message, r.ok === false ? 'warn' : '');
    else if (r && r.state === 'installing') say('正在重启并安装更新…');
    else if (r && r.state === 'downloading') say('正在下载更新，下载完再点一次「重启并安装」');
    if (r) update.value = { ...(update.value || {}), ...r };
  } catch (e) {
    say('下载更新没成功，请稍后再试', 'bad');
  } finally {
    busy.value = '';
  }
}

export async function restartApp() {
  if (!desktop || typeof desktop.restartApp !== 'function') {
    say('浏览器版不支持重启程序，请用桌面版', 'warn');
    return;
  }
  try {
    await desktop.restartApp();
  } catch (e) {
    say('重启程序没成功', 'bad');
  }
}
