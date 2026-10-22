import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeType,
  buildQuizPrompt,
  parseLetters,
  chooseLetters,
  fallbackIdxs,
  planSelection,
  groupChapters,
  pickChapterToQuiz,
  quizListOf,
  platformDoneMap,
  parsePaperMeta,
  parseResult,
  QUIZ_LETTERS,
} from '../server/worker/lib/quiz-logic.mjs';

const q = (over = {}) => ({
  num: 1,
  type: '【单选题】',
  stem: '',
  options: [
    { label: 'A', text: '说法甲' },
    { label: 'B', text: '说法乙比较长一点' },
    { label: 'C', text: '说法丙' },
    { label: 'D', text: '以上都不对' },
  ],
  ...over,
});

test('normalizeType 认得出单选/多选/判断', () => {
  assert.equal(normalizeType('【单选题】'), 'single');
  assert.equal(normalizeType('【多选题】'), 'multi');
  assert.equal(normalizeType('【判断题】'), 'judge');
  assert.equal(normalizeType(''), 'single');
});

test('buildQuizPrompt 带上课程/试卷/选项，多选时说明可多选', () => {
  const p = buildQuizPrompt({ courseName: '心理学', title: '第一章单元测试' }, q({ type: '【多选题】' }));
  assert.match(p, /多选题/);
  assert.match(p, /心理学/);
  assert.match(p, /第一章单元测试/);
  assert.match(p, /A\. 说法甲/);
  assert.match(p, /只回复选项字母/);
});

test('buildQuizPrompt 没题干时明确让模型按选项判断', () => {
  const p = buildQuizPrompt({}, q());
  assert.match(p, /没有单独显示题干/);
});

test('parseLetters 支持各种回复格式', () => {
  assert.deepEqual(parseLetters('B', 4), ['B']);
  assert.deepEqual(parseLetters('AC', 4), ['A', 'C']);
  assert.deepEqual(parseLetters('答案：C', 4), ['C']);
  assert.deepEqual(parseLetters('应选 A、C。', 4), ['A', 'C']);
  assert.deepEqual(parseLetters('正确答案是 D', 4), ['D']);
  assert.deepEqual(parseLetters('我觉得都不对', 4), []);
  assert.deepEqual(parseLetters('', 4), []);
});

test('parseLetters 认得「字母打头 + 解释」的回复', () => {
  assert.deepEqual(parseLetters('D', 4), ['D']);
  assert.deepEqual(parseLetters('D. 学习是经验引起的变化', 4), ['D']);
  assert.deepEqual(parseLetters('D、因为学习需要经验', 4), ['D']);
  assert.deepEqual(parseLetters('B 是对的，其他不成立', 4), ['B']);
  assert.deepEqual(parseLetters('AC。理由：前者更全面', 4), ['A', 'C']);
});

test('chooseLetters 单选题/判断题只取第一个字母（模型多给时不误判多选）', () => {
  const r = chooseLetters({ text: '答案：B，C 不对', question: q(), optionCount: 4 });
  assert.deepEqual(r.idxs, [1]);
  const judge = q({
    type: '【判断题】',
    options: [
      { label: 'A', text: '对' },
      { label: 'B', text: '错' },
    ],
  });
  assert.deepEqual(chooseLetters({ text: 'B，A 是错的', question: judge, optionCount: 2 }).idxs, [1]);
  const multi = chooseLetters({ text: '答案：A、C', question: q({ type: '【多选题】' }), optionCount: 4 });
  assert.deepEqual(multi.idxs, [0, 2]);
});

test('parseLetters 不会把超出选项范围的字母算进去', () => {
  assert.deepEqual(parseLetters('F', 4), []);
  assert.deepEqual(parseLetters('AB', 2), ['A', 'B']);
});

test('chooseLetters 单选题取字母', () => {
  const r = chooseLetters({ text: 'B', question: q(), optionCount: 4 });
  assert.deepEqual(r.idxs, [1]);
});

test('chooseLetters 判断题兼容「对/错」', () => {
  const judge = q({
    type: '【判断题】',
    options: [
      { label: 'A', text: '对' },
      { label: 'B', text: '错' },
    ],
  });
  assert.deepEqual(chooseLetters({ text: '对', question: judge, optionCount: 2 }).idxs, [0]);
  assert.deepEqual(chooseLetters({ text: '错', question: judge, optionCount: 2 }).idxs, [1]);
  assert.deepEqual(chooseLetters({ text: 'A', question: judge, optionCount: 2 }).idxs, [0]);
});

test('chooseLetters 多选题取多个字母', () => {
  const r = chooseLetters({ text: 'AC', question: q({ type: '【多选题】' }), optionCount: 4 });
  assert.deepEqual(r.idxs, [0, 2]);
});

test('chooseLetters 解析不出来时给空（交给兜底）', () => {
  assert.deepEqual(chooseLetters({ text: '不知道', question: q(), optionCount: 4 }).idxs, []);
});

test('fallbackIdxs 单选选最长、判断选「对」、排除「以上都不对」', () => {
  assert.deepEqual(fallbackIdxs(q()), [1]);
  assert.deepEqual(
    fallbackIdxs(
      q({
        type: '【判断题】',
        options: [
          { label: 'A', text: '错' },
          { label: 'B', text: '对' },
        ],
      })
    ),
    [1]
  );
  assert.deepEqual(fallbackIdxs(q({ type: '【多选题】' })), [0]);
  const noD = q({
    options: [
      { label: 'A', text: '以上都不对' },
      { label: 'B', text: '短' },
      { label: 'C', text: '长一些' },
    ],
  });
  assert.deepEqual(fallbackIdxs(noD), [2]);
});

test('planSelection 只点需要改的选项', () => {
  const opts = [{ checked: false }, { checked: true }, { checked: false }];
  assert.deepEqual(planSelection(opts, [0]), [0, 1]);
  assert.deepEqual(planSelection(opts, [1]), []);
  assert.deepEqual(planSelection(opts, []), [1]);
  const multi = [{ checked: false }, { checked: false }, { checked: false }];
  assert.deepEqual(planSelection(multi, [0, 2]), [0, 2]);
});

test('groupChapters 按章归组并判断全章看完', () => {
  const lessons = [
    { chapter: '第一章 概述', code: '1.1', doneAttr: true },
    { chapter: '第一章 概述', code: '1.2', pct: 100 },
    { chapter: '第二章 自我', code: '2.1', pct: 50 },
    { chapter: '第二章 自我', code: '2.2', pct: null },
  ];
  const g = groupChapters(lessons);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0], { key: '第一章 概述', chapter: '第一章 概述', total: 2, done: 2, started: 2, allDone: true });
  assert.equal(g[1].allDone, false);
  assert.equal(g[1].started, 1);
});

test('pickChapterToQuiz 只挑全章看完且没做过的，优先当前章', () => {
  const chapters = groupChapters([
    { chapter: '第一章', doneAttr: true },
    { chapter: '第二章', doneAttr: true },
    { chapter: '第三章', pct: 30 },
  ]);
  assert.equal(pickChapterToQuiz(chapters, [], '第二章').key, '第二章');
  assert.equal(pickChapterToQuiz(chapters, [{ key: '第二章', status: 'done' }], '第二章').key, '第一章');
  assert.equal(
    pickChapterToQuiz(
      chapters,
      [
        { key: '第一章', status: 'done' },
        { key: '第二章', status: 'done' },
      ],
      ''
    ),
    null
  );
  assert.equal(pickChapterToQuiz(chapters, [{ key: '第一章', status: 'failed' }], '第一章').key, '第二章');
});

test('quizListOf 合并断点、给出默认标题', () => {
  const chapters = groupChapters([{ chapter: '第一章 概述', doneAttr: true }]);
  const list = quizListOf(chapters, { '第一章 概述': { status: 'done', score: 12, total: 12, count: 6 } });
  assert.equal(list.length, 1);
  assert.equal(list[0].status, 'done');
  assert.equal(list[0].score, 12);
  assert.equal(list[0].count, 6);
  assert.match(list[0].title, /平时测试/);
  assert.equal(quizListOf(chapters, {})[0].status, 'todo');
});

test('platformDoneMap 只收课程树上标了已交的测试', () => {
  const map = platformDoneMap([
    { chapter: '第一章 概述', done: true },
    { chapter: '第二章 自我', done: false },
    { chapter: '第三章 学习' },
    { text: '平时测试', done: true },
  ]);
  assert.deepEqual(map, { '第一章 概述': true });
  assert.deepEqual(platformDoneMap(null), {});
});

test('quizListOf 平台已交优先：本地没记录也显示 done/platform', () => {
  const chapters = groupChapters([
    { chapter: '第一章 概述', doneAttr: true },
    { chapter: '第二章 自我', doneAttr: true },
  ]);
  // 本地把第一章记成失败（旧版本重复作答的痕迹），但平台已经交过 → 以平台为准
  const list = quizListOf(chapters, { '第一章 概述': { status: 'failed', note: '没做完' } }, { '第一章 概述': true });
  assert.equal(list[0].status, 'done');
  assert.equal(list[0].source, 'platform');
  assert.equal(list[1].status, 'todo');
  assert.equal(list[1].source, '');
  // 没有平台标记时仍然用本地状态
  const list2 = quizListOf(chapters, { '第一章 概述': { status: 'done', score: 10, total: 12 } }, {});
  assert.equal(list2[0].source, 'self');
  assert.equal(list2[0].score, 10);
  // 自己刚交完、平台也打了勾：仍然是 self（不是「之前交的」）
  const list3 = quizListOf(
    chapters,
    { '第一章 概述': { status: 'done', score: 10, total: 12 } },
    { '第一章 概述': true }
  );
  assert.equal(list3[0].source, 'self');
  assert.equal(list3[0].status, 'done');
});

test('parsePaperMeta 从正文里读题数/总分/章节/标题', () => {
  const meta = parsePaperMeta('第一章单元测试\n对应章节 第一章\n题目数：7 总分数：12 截止时间 2026-11-15', '');
  assert.equal(meta.count, 7);
  assert.equal(meta.total, 12);
  assert.equal(meta.chapter, '第一章');
  assert.match(meta.title, /单元测试/);
  assert.equal(typeof parsePaperMeta('', 'x').title, 'string'); // 空正文也不崩
});

test('parseResult 读得出得分与是否提交', () => {
  assert.deepEqual(
    { score: parseResult('提交成功 得分：12/12').score, total: parseResult('提交成功 得分：12/12').total },
    { score: 12, total: 12 }
  );
  assert.equal(parseResult('已提交，等待批阅').submitted, true);
  assert.equal(parseResult('已提交，等待批阅').score, null);
  assert.equal(parseResult('12.5分').score, 12.5);
});

test('QUIZ_LETTERS 覆盖到 8 个选项', () => {
  assert.equal(QUIZ_LETTERS.length, 8);
});
