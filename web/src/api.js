const TOKEN = new URLSearchParams(location.search).get('t') || '';

/**
 * 给后端返回的本地资源路径（例如二维码 "/api/qr?v=1690..."）拼上令牌。
 * 已经是完整 http(s) 地址的（比如后端直接给了二维码直链）原样返回。
 */
export function authUrl(path) {
  if (!path) return '';
  if (/^https?:/i.test(path)) return path;
  return path + (path.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(TOKEN);
}

/**
 * 统一请求：没 body 走 GET，有 body 走 POST；PUT 等其它方法显式传 opts.method。
 * - 所有请求都带 ?t=<token>（沿用启动页地址里的令牌）
 * - 服务端 404/403 多半说明这个接口在当前版本还没有（或令牌失效），
 *   统一翻译成用户能看懂的一句话，不把接口细节丢给界面
 */
export function api(path, body, opts = {}) {
  const method = opts.method || (body ? 'POST' : 'GET');
  const url = path + (path.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(TOKEN);
  return fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
    .then(async (r) => {
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        if (r.status === 404 || r.status === 403) throw new Error('服务端版本较旧，请重启程序');
        throw new Error((j && j.message) || '请求失败，请稍后重试');
      }
      return j;
    })
    .catch((e) => {
      if (e instanceof TypeError) throw new Error('连不上本地服务，请确认程序还在运行');
      throw e;
    });
}

/** SSE：状态 / 日志 / 连接状态，各页面共用一条（由 store 统一订阅） */
export function subscribe(onState, onLogs, onStatus) {
  const es = new EventSource('/api/events?t=' + encodeURIComponent(TOKEN));
  es.addEventListener('state', (e) => onState(JSON.parse(e.data)));
  es.addEventListener('logs', (e) => onLogs(JSON.parse(e.data)));
  es.onopen = () => onStatus(true);
  es.onerror = () => onStatus(false);
  return es;
}
