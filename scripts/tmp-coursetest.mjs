import fs from 'node:fs';
const u = new URL(fs.readFileSync('data/server.url', 'utf8').trim());
const t = u.searchParams.get('t');
const base = 'http://127.0.0.1:8731';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = () => fetch(base + '/api/state?t=' + t).then((r) => r.json());
const post = (p, body) => fetch(base + p + '?t=' + t, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => r.text());

console.log('start ->', await post('/api/start'));
let s;
for (let i = 0; i < 90; i++) { s = await state(); if (s.phase === 'PLAYING') break; await sleep(2000); }
console.log('phase', s.phase, '| course', s.course.name, '| ct', Math.round(s.video.ct), '/', Math.round(s.video.dur));

console.log('courses ->', await post('/api/courses'));
for (let i = 0; i < 20; i++) { s = await state(); if ((s.courses || []).length) break; await sleep(1500); }
console.log('courses:', JSON.stringify(s.courses, null, 1));

if ((s.courses || []).length) {
  console.log('switch course 0 ->', await post('/api/course', { index: 0 }));
  for (let i = 0; i < 40; i++) { s = await state(); if (s.phase === 'PLAYING' && /stuStudy/i.test(s.resumeUrl || '') && (s.lessons || []).length) break; await sleep(2000); }
  console.log('after switch: phase', s.phase, '| course', s.course.name, '| lessons', (s.lessons || []).length, '| ct', Math.round(s.video.ct));
}
console.log('notice:', s.notice);
