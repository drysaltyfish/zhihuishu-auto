/** data/config.json：LLM 等设置；按文件修改时间缓存，改完不用重启 */
import fs from 'node:fs';
import path from 'node:path';

const TEMPLATE = {
  _说明: 'llm.apiKey 填你的 DeepSeek API Key（其它字段一般不用改）。改完刷新网页即可，不用重启服务。',
  llm: {
    provider: 'deepseek',
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    timeoutMs: 20000,
  },
};

const DEFAULTS = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  timeoutMs: 20000,
};

/** 只留前 3 位和后 4 位，界面上展示用；完整 Key 永远不出后端 */
function maskKey(key) {
  const s = String(key || '');
  if (!s) return '';
  if (s.length <= 8) return '****';
  return s.slice(0, 3) + '****' + s.slice(-4);
}

export function createConfigStore({ dataDir, log } = {}) {
  const file = path.join(dataDir, 'config.json');
  let cache = null;
  let cacheKey = '';

  function read() {
    let key;
    try {
      const st = fs.statSync(file);
      key = st.mtimeMs + ':' + st.size;
    } catch {
      key = 'missing';
    }
    if (cache && key === cacheKey) return cache;
    let raw = null;
    if (key !== 'missing') {
      try {
        raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (e) {
        if (log) log('warn', '配置文件读不动（' + String((e && e.message) || e).slice(0, 80) + '），先按空配置跑');
      }
    }
    cache = raw && typeof raw === 'object' ? raw : {};
    cacheKey = key;
    return cache;
  }

  /** 先写临时文件再改名：写到一半断电也不会把原配置写坏 */
  function write(obj) {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
    fs.renameSync(tmp, file);
    cache = null;
    cacheKey = '';
  }

  function llm() {
    const c = read();
    return c.llm && typeof c.llm === 'object' ? c.llm : {};
  }

  function redacted() {
    const v = llm();
    const key = String(v.apiKey || '');
    return {
      provider: v.provider || DEFAULTS.provider,
      baseUrl: v.baseUrl || DEFAULTS.baseUrl,
      model: v.model || DEFAULTS.model,
      timeoutMs: Number(v.timeoutMs) || DEFAULTS.timeoutMs,
      hasApiKey: key.length > 0,
      apiKeyMasked: maskKey(key),
    };
  }

  function saveLlm(patch = {}) {
    const cur = JSON.parse(JSON.stringify(read() || {}));
    const next = { ...(cur.llm || {}) };
    const pick = (k) => (typeof patch[k] === 'string' ? patch[k].trim() : '');
    if (pick('provider')) next.provider = pick('provider');
    if (pick('baseUrl')) next.baseUrl = pick('baseUrl');
    if (pick('model')) next.model = pick('model');
    if (patch.timeoutMs !== undefined && patch.timeoutMs !== null && patch.timeoutMs !== '') {
      const n = Number(patch.timeoutMs);
      if (Number.isFinite(n) && n > 0) next.timeoutMs = Math.round(n);
    }
    if (patch.clearKey === true) next.apiKey = '';
    else if (pick('apiKey')) next.apiKey = pick('apiKey');
    cur.llm = next;
    write(cur);
    return next;
  }

  return {
    all: read,
    llm,
    redacted,
    saveLlm,
    hasKey: () => String(llm().apiKey || '').length > 0,
    /** 第一次启动写一份模板；已有文件绝不覆盖（Key 在里面） */
    ensureTemplate() {
      if (fs.existsSync(file)) return false;
      try {
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify(TEMPLATE, null, 2) + '\n');
        return true;
      } catch (e) {
        if (log) log('warn', '写配置模板失败：' + String((e && e.message) || e).slice(0, 120));
        return false;
      }
    },
  };
}
