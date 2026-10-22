/**
 * 章节测试的纯逻辑（不碰浏览器、不碰网络，全部可单测）：
 *  - 题目 → 提示词     buildQuizPrompt
 *  - 模型回复 → 选项   chooseLetters / parseLetters
 *  - 选不出来时的兜底   fallbackIdxs
 *  - 点哪些选项         planSelection
 *  - 章节归组与「该做哪一章」 groupChapters / pickChapterToQuiz / quizListOf
 *  - 试卷正文 → 标题/题数/总分，结果页 → 分数  parsePaperMeta / parseResult
 */

export const QUIZ_LETTERS = 'ABCDEFGH';

/** 题型：多选 / 判断 / 单选（平台文案是【单选题】这种） */
export function normalizeType(typeText) {
  const t = String(typeText || '');
  if (/多选/.test(t)) return 'multi';
  if (/判断/.test(t)) return 'judge';
  if (/单选/.test(t)) return 'single';
  return 'single';
}

/** 拼给模型的提示词（课程/试卷/题号/题型/题干/选项） */
export function buildQuizPrompt(meta, q) {
  const m = meta || {};
  const opts = (q && q.options ? q.options : [])
    .map((o, i) => (o.label ? o.label + '.' : QUIZ_LETTERS[i] + '.') + ' ' + String(o.text || '').trim())
    .join('\n');
  const type = normalizeType(q && q.type);
  const rule =
    type === 'multi'
      ? '这是多选题，可能有一个或多个正确答案；请输出所有正确选项的字母，例如 AC。'
      : type === 'judge'
        ? '这是判断题，只输出一个字母：A（对）或 B（错）。'
        : '这是单选题，只输出一个正确选项的字母。';
  const stem = String((q && q.stem) || '').trim();
  const stemLine = stem ? '题干：' + stem : '（这道题页面上没有单独显示题干，请直接判断哪个选项的陈述是正确的。）';
  return [
    '你在帮一个学生做大学课程的章节平时测试。' + rule,
    '只回复选项字母，不要解释、不要复述题目。',
    '课程：' + (m.courseName || '未知'),
    '试卷：' + (m.title || '未知'),
    '第 ' + ((q && q.num) || '?') + ' 题（' + String((q && q.type) || '') + '）',
    stemLine,
    '选项：',
    opts,
  ].join('\n');
}

/** 从模型回复里抠选项字母（支持「AC」「答案：B」「A、C」） */
export function parseLetters(text, count) {
  const s = String(text || '').trim();
  const n = Math.max(1, Math.min(Number(count) || 4, QUIZ_LETTERS.length));
  const valid = QUIZ_LETTERS.slice(0, n);
  const out = [];
  const push = (ch) => {
    const c = String(ch || '').toUpperCase();
    if (valid.includes(c) && !out.includes(c)) out.push(c);
  };
  if (!s) return out;
  // 「答案：AC」「应选 A、C」「正确答案是 B」
  const m = /(?:答案|应选|选择|选项|答)\s*(?:是|为|:|：)?\s*[*#"“'【\[]*[A-Ha-h]/.exec(s);
  if (m) {
    const tail = s.slice(m.index);
    const head = tail.slice(0, 12);
    for (const ch of head.match(/[A-Ha-h]/g) || []) push(ch);
  }
  // 整句就是字母串
  if (!out.length && /^[*#"“'【\[\s]*[A-Ha-h][A-Ha-h\s,，、/和]*$/.test(s)) {
    for (const ch of s.match(/[A-Ha-h]/g) || []) push(ch);
  }
  // 开头就是字母："D" / "D." / "D、学习是…" / "AB"
  if (!out.length) {
    const lead = /^[*#"“'【\[\s]*([A-Ha-h](?:\s*[,，、/和]?\s*[A-Ha-h])*)(?=[.。:：、,，\s]|[\u4e00-\u9fa5]|$)/.exec(s);
    if (lead) for (const ch of lead[1].match(/[A-Ha-h]/g) || []) push(ch);
  }
  // 全文只有一个选项字母
  if (!out.length) {
    const all = [...new Set((s.match(/\b[A-Ha-h]\b/g) || []).map((x) => x.toUpperCase()))].filter((c) =>
      valid.includes(c)
    );
    if (all.length === 1) push(all[0]);
  }
  return out;
}

/** 模型回复 → 要点的选项下标（判断题兼容「对/错」） */
export function chooseLetters({ text, question, optionCount }) {
  const q = question || {};
  const opts = q.options || [];
  const n = Math.max(1, Number(optionCount) || opts.length || QUIZ_LETTERS.length);
  const type = normalizeType(q.type);
  if (type === 'judge') {
    const raw = String(text || '').trim();
    const saysTrue = /^(对|正确|√|true|是)/i.test(raw);
    const saysFalse = /^(错|错误|×|false|否)/i.test(raw);
    const trueIdx = opts.findIndex((o) => /^(对|正确|√|true|是)/i.test(String(o.text || '').trim()));
    const falseIdx = opts.findIndex((o) => /^(错|错误|×|false|否)/i.test(String(o.text || '').trim()));
    const letters = parseLetters(raw, n);
    if (!letters.length) {
      if (saysTrue && trueIdx >= 0) return { idxs: [trueIdx], why: '模型回答「对」' };
      if (saysFalse && falseIdx >= 0) return { idxs: [falseIdx], why: '模型回答「错」' };
    }
  }
  const letters = parseLetters(text, n);
  let idxs = letters.map((c) => QUIZ_LETTERS.indexOf(c)).filter((i) => i >= 0 && i < n);
  // 单选题/判断题只要一个：模型多给了就取第一个，免得多选被平台判错
  if (type !== 'multi' && idxs.length > 1) idxs = idxs.slice(0, 1);
  if (idxs.length) return { idxs, why: '模型给了 ' + letters.join('') };
  return { idxs: [], why: '模型回复里没解析出选项字母' };
}

const DISTRACTOR = /^(以上都|都不对|以上全|全部|none|all of the above|无法确定|不确定)/i;

/** 模型答不出来时的兜底（单选选最长，判断选「对」，多选选第一个） */
export function fallbackIdxs(question) {
  const q = question || {};
  const opts = (q.options || []).filter((o) => String(o.text || '').trim());
  if (!opts.length) return [];
  const all = q.options || [];
  const type = normalizeType(q.type);
  const clean = all.map((o, i) => ({ o, i })).filter(({ o }) => !DISTRACTOR.test(String(o.text || '').trim()));
  const pool = clean.length ? clean : all.map((o, i) => ({ o, i }));
  if (!pool.length) return [];
  if (type === 'multi') return [pool[0].i];
  if (type === 'judge') {
    const t = pool.find(({ o }) => /^(对|正确|√|true|是)/i.test(String(o.text || '').trim()));
    return [t ? t.i : pool[0].i];
  }
  let best = pool[0];
  for (const x of pool) if (String(x.o.text || '').length > String(best.o.text || '').length) best = x;
  return [best.i];
}

/** 当前选择状态 → 还要点哪些选项（让 checked 集合等于想要的集合） */
export function planSelection(options, desired) {
  const want = new Set((desired || []).map(Number));
  const clicks = [];
  (options || []).forEach((o, i) => {
    const checked = !!o.checked;
    if (checked !== want.has(i)) clicks.push(i);
  });
  return clicks;
}

/** 课程树里的小节按章归组，并算「这一章是否全部看完」 */
export function groupChapters(lessons) {
  const map = new Map();
  for (const l of lessons || []) {
    const key = String((l && l.chapter) || '').trim() || '未分章';
    if (!map.has(key)) map.set(key, { key, chapter: key, lessons: [] });
    map.get(key).lessons.push(l);
  }
  return Array.from(map.values()).map((g) => {
    const total = g.lessons.length;
    const done = g.lessons.filter((l) => l.doneAttr || (l.pct != null && l.pct >= 100)).length;
    const started = g.lessons.filter((l) => l.doneAttr || (l.pct != null && l.pct > 0)).length;
    return { key: g.key, chapter: g.chapter, total, done, started, allDone: total > 0 && done === total };
  });
}

/** 该做哪一章的测试：全章看完、还没做过；优先当前所在章 */
export function pickChapterToQuiz(chapters, quizzes, currentChapter) {
  const statusOf = (k) => {
    const q = (quizzes || []).find((x) => x.key === k);
    return q ? q.status : 'todo';
  };
  const pending = (chapters || []).filter(
    (c) => c.allDone && !['done', 'doing', 'skipped', 'failed'].includes(statusOf(c.key))
  );
  if (!pending.length) return null;
  const cur = pending.find((c) => c.key === currentChapter);
  return cur || pending[0];
}

/** 课程树里的测试节点 → { 章节名: true }（平台自己标了「已交」的） */
export function platformDoneMap(tests) {
  const out = {};
  for (const t of tests || []) if (t && t.done && t.chapter) out[t.chapter] = true;
  return out;
}

/**
 * 拼出给前端看的章节测试列表（合并已保存的结果 + 平台课程树上的「已交」标记）。
 * 平台标记优先：本地没记录但平台显示已交，也算 done（不重复做）。
 */
export function quizListOf(chapters, doneMap, platformDone) {
  const map = doneMap || {};
  const pDone = platformDone || {};
  return (chapters || []).map((c) => {
    const d = map[c.key] || {};
    // 本地已经记成 done 的（自己交的）就不改来源，只有本地没交过才标成「平台已交」
    const byPlatform = !!pDone[c.key] && d.status !== 'done';
    const guessTitle = (String(c.chapter || c.key).replace(/\s+/g, '') || '本课') + '·平时测试';
    return {
      key: c.key,
      chapter: c.chapter || c.key,
      title: d.title || guessTitle,
      status: byPlatform ? 'done' : d.status || 'todo',
      source: byPlatform ? 'platform' : d.status ? 'self' : '',
      count: d.count == null ? null : d.count,
      total: d.total == null ? null : d.total,
      score: d.score == null ? null : d.score,
      answered: d.answered || 0,
      at: d.at || 0,
      note: byPlatform ? d.note || '平台显示这份测试已经交过' : d.note || '',
    };
  });
}

/** 试卷正文 → 标题 / 对应章节 / 题目数 / 总分 */
export function parsePaperMeta(bodyText, fallbackTitle) {
  const t = String(bodyText || '');
  const num = (re) => {
    const m = re.exec(t);
    return m ? Number(m[1]) : null;
  };
  const total = num(/(?:总分数|总分)\s*[：:\s]*([\d.]+)/);
  const count = num(/(?:题目数|题数)\s*[：:\s]*(\d+)/) || num(/共\s*(\d+)\s*题/);
  const capM = /对应章节\s*[：:\s]*([^\n]{1,40})/.exec(t);
  const titleM = /([\u4e00-\u9fa5A-Za-z0-9]{2,30}(?:单元测试|平时测验|平时测试|章节测试|测验|测试))/.exec(t);
  return {
    title:
      (titleM && titleM[1]) ||
      String(fallbackTitle || '')
        .replace(/[-_].*$/, '')
        .slice(0, 40) ||
      '章节测试',
    chapter: capM ? capM[1].trim() : '',
    count: count || null,
    total: total || null,
  };
}

/** 结果页正文 → 分数（平台可能只回「已提交」） */
export function parseResult(bodyText) {
  const t = String(bodyText || '');
  const m = /(?:得分|成绩|分数|得分率)\s*[：:\s]*([\d.]+)\s*(?:\/\s*([\d.]+))?/.exec(t);
  let score = m ? Number(m[1]) : null;
  let total = m && m[2] ? Number(m[2]) : null;
  if (score == null) {
    const m2 = /([\d.]+)\s*分(?![钟\/])/.exec(t);
    if (m2) score = Number(m2[1]);
  }
  const submitted = /已提交|提交成功|提交完成/.test(t);
  return {
    score: Number.isFinite(score) ? score : null,
    total: Number.isFinite(total) ? total : null,
    submitted,
    text: t.replace(/\s+/g, ' ').slice(0, 200),
  };
}
