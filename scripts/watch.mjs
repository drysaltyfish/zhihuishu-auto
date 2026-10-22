/** 开发用：盯 SSE 事件流，把日志与状态变化写到 data/watch.log */
import fs from 'node:fs';
import http from 'node:http';

const url = fs.readFileSync('data/server.url', 'utf8').trim();
const tok = url.split('t=')[1];
const out = fs.createWriteStream('data/watch.log', { flags: 'a' });
const W = (s) => out.write(new Date().toTimeString().slice(0, 8) + ' ' + s + '\n');

let lastPhase = '';
let lastCt = -1;
let lastLogLen = 0;
let lastPoints = '';

function connect() {
  const req = http.get('http://127.0.0.1:8731/api/events?t=' + tok, (res) => {
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const ev = /event: (\w+)/.exec(frame);
        const dm = /data: (.*)/s.exec(frame);
        if (!ev || !dm) continue;
        let payload; try { payload = JSON.parse(dm[1]); } catch { continue; }
        if (ev[1] === 'logs' && Array.isArray(payload)) {
          for (let i = lastLogLen; i < payload.length; i++) W('[' + payload[i].kind + '] ' + payload[i].msg);
          lastLogLen = payload.length;
        }
        if (ev[1] === 'state') {
          const p = payload.phase + (payload.notice ? ' notice=' + payload.notice : '');
          if (p !== lastPhase) { lastPhase = p; W('== phase ' + p); }
          const pts = JSON.stringify((payload.questionPoints || []).map((q) => q.timeSec + ':' + (q.answered ? 'done' : 'next')));
          if (pts !== lastPoints) { lastPoints = pts; W('== points ' + pts); }
          const ct = Math.round(payload.video && payload.video.ct || 0);
          if (ct !== lastCt) { lastCt = ct; W('== ct ' + ct + '/' + Math.round(payload.video.dur) + (payload.video.paused ? ' paused' : '')); }
        }
      }
    });
    res.on('end', () => setTimeout(connect, 1000));
  });
  req.on('error', () => setTimeout(connect, 2000));
}
connect();
