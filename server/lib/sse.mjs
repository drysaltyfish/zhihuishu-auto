/**
 * SSE 广播：状态/日志只有变了才推（原来 500ms 全量轮询 + mock 例外特判）。
 * 帧格式只在这里拼一次。
 */
export function createHub({ getState, getLogs, log, stateDelayMs = 60, logsDelayMs = 200 }) {
  const clients = new Set();
  let stateTimer = null;
  let logsTimer = null;
  let lastState = null;   // 上次推出去的 JSON 串，用来去重
  let lastLogsSig = '';

  function frame(event, payloadJson) {
    return 'event: ' + event + '\ndata: ' + payloadJson + '\n\n';
  }

  function write(res, text) {
    try { res.write(text); } catch { drop(res); }
  }

  function drop(res) {
    clients.delete(res);
  }

  function broadcast(event, payloadJson) {
    if (!clients.size) return;
    const text = frame(event, payloadJson);
    for (const res of clients) write(res, text);
  }

  function pushState() {
    let body;
    try { body = JSON.stringify(getState()); } catch (e) {
      if (log) log('err', '状态序列化失败：' + String((e && e.message) || e).slice(0, 120));
      return;
    }
    if (body === lastState) return;
    lastState = body;
    broadcast('state', body);
  }

  function pushLogs() {
    const rows = getLogs() || [];
    const last = rows[rows.length - 1];
    const sig = rows.length + ':' + (last ? last.time + ':' + last.msg : '');
    if (sig === lastLogsSig) return;
    lastLogsSig = sig;
    let body;
    try { body = JSON.stringify(rows); } catch (e) {
      if (log) log('warn', '日志序列化失败：' + String((e && e.message) || e).slice(0, 120));
      return;
    }
    broadcast('logs', body);
  }

  return {
    /** 客户端连上：先把当前状态和日志各推一份，之后等变化 */
    addClient(req, res) {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(':ok\n\n');
      clients.add(res);
      res.on('close', () => drop(res));
      res.on('error', () => drop(res));
      req.on('close', () => drop(res));
      // 首帧只发给这个连接（其它连接早就有了，不重复打扰）
      try { write(res, frame('state', JSON.stringify(getState()))); } catch { drop(res); }
      try { write(res, frame('logs', JSON.stringify(getLogs() || []))); } catch { drop(res); }
    },
    stateChanged() {
      if (stateTimer) return;
      stateTimer = setTimeout(() => { stateTimer = null; pushState(); }, stateDelayMs);
    },
    logsChanged() {
      if (logsTimer) return;
      logsTimer = setTimeout(() => { logsTimer = null; pushLogs(); }, logsDelayMs);
    },
    get clientCount() { return clients.size; },
    stop() {
      if (stateTimer) clearTimeout(stateTimer);
      if (logsTimer) clearTimeout(logsTimer);
      stateTimer = null; logsTimer = null;
      for (const res of clients) { try { res.end(); } catch {} }
      clients.clear();
    },
  };
}
