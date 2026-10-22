const TOKEN = new URLSearchParams(location.search).get('t') || '';

export function api(path, body) {
  return fetch(path + (path.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(TOKEN), {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => {
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error((j && j.message) || '请求失败');
    return j;
  });
}

export function subscribe(onState, onLogs, onStatus) {
  const es = new EventSource('/api/events?t=' + encodeURIComponent(TOKEN));
  es.addEventListener('state', (e) => onState(JSON.parse(e.data)));
  es.addEventListener('logs', (e) => onLogs(JSON.parse(e.data)));
  es.onopen = () => onStatus(true);
  es.onerror = () => onStatus(false);
  return es;
}
