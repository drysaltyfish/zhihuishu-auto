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

export function createConfigStore({ dataDir, log } = {}) {
  const file = path.join(dataDir, 'config.json');
  let cache = null;
  let cacheKey = '';

  function read() {
    let key;
    try { const st = fs.statSync(file); key = st.mtimeMs + ':' + st.size; }
    catch { key = 'missing'; }
    if (cache && key === cacheKey) return cache;
    let raw = null;
    if (key !== 'missing') {
      try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
      catch (e) { if (log) log('warn', '配置文件读不动（' + String((e && e.message) || e).slice(0, 80) + '），先按空配置跑'); }
    }
    cache = raw && typeof raw === 'object' ? raw : {};
    cacheKey = key;
    return cache;
  }

  return {
    all: read,
    llm() {
      const c = read();
      return c.llm && typeof c.llm === 'object' ? c.llm : {};
    },
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
