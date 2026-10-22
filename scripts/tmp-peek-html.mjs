import fs from 'node:fs';
const files = fs.readdirSync('data/debug').filter(x=>x.startsWith('learnhome-')&&x.endsWith('.html')).sort();
for (const f of files) {
  const h = fs.readFileSync('data/debug/'+f,'utf8');
  const i = h.indexOf('class="item-left-course"');
  if (i > 0) { console.log('FILE', f, 'idx', i); console.log(h.slice(i, i+1800).replace(/></g,'>\n<')); break; }
}
