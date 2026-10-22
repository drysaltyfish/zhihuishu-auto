import fs from 'node:fs';
const url = fs.readFileSync('data/server.url','utf8').trim();
const t = new URL(url).searchParams.get('t');
const s = await (await fetch('http://127.0.0.1:8731/api/state?t='+t)).json();
console.log(Object.keys(s));
console.log('log lines:', Array.isArray(s.log)?s.log.length:'n/a');
const arr = s.log || s.logs || [];
console.log(arr.slice(-40).map(l=>typeof l==='string'?l:(l.at+' '+l.level+' '+l.text)).join('\n'));
