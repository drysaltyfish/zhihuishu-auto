/** 开发用：轮询 /api/state，状态变化就打印一行，直到 phase 命中目标或超时。
 * 用法：node scripts/waitfor.mjs ANSWERING,PAUSED 400 */
import fs from 'node:fs';
import http from 'node:http';

const targets = (process.argv[2] || '').split(',').filter(Boolean);
const limitSec = Number(process.argv[3] || 300);
const url = fs.readFileSync('data/server.url', 'utf8').trim();
const tok = url.split('t=')[1];

function get() {
  return new Promise((resolve) => {
    http
      .get('http://127.0.0.1:8731/api/state?t=' + tok, (res) => {
        let b = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(b));
          } catch {
            resolve(null);
          }
        });
      })
      .on('error', () => resolve(null));
  });
}

const t0 = Date.now();
let lastSig = '';
while (true) {
  const s = await get();
  if (s) {
    const sig = [
      s.phase,
      s.notice,
      Math.round(s.video.ct),
      Math.round(s.video.dur),
      s.video.paused,
      s.answers.count,
      s.questionPoints.map((q) => (q.answered ? 'd' : 'n')).join(''),
    ].join('|');
    if (sig !== lastSig) {
      lastSig = sig;
      console.log(
        new Date().toTimeString().slice(0, 8),
        s.phase,
        'ct=' + Math.round(s.video.ct) + '/' + Math.round(s.video.dur),
        s.video.paused ? 'paused' : 'playing',
        'answered=' + s.answers.count,
        s.notice ? '| ' + s.notice : ''
      );
    }
    if (targets.includes(s.phase)) {
      console.log('HIT ' + s.phase);
      break;
    }
  }
  if (Date.now() - t0 > limitSec * 1000) {
    console.log('TIMEOUT');
    break;
  }
  await new Promise((r) => setTimeout(r, 3000));
}
