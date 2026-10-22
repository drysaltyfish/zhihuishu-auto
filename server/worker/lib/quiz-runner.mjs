/**
 * 章节「平时测试」的自动化执行器：点课程树里的测试节点 → 新标签页里逐题作答 → 提交 → 关标签页。
 * 只做 IO 和流程，判题/解析都在 quiz-logic.mjs（纯函数），页内提取在 quiz-scripts.mjs。
 *
 * 依赖注入（方便换成假页面做测试）：
 *   getPage()   课程视频页
 *   getCtx()    浏览器上下文（能等到新标签页）
 *   readTree()  读课程树（probe.readCourseTree）
 *   log / patch 日志与状态推送
 *   getLlm()    当前 LLM 配置（data/config.json 的 llm 段）
 *   askQuiz()   server/llm.mjs 的 askQuiz
 *   sleep / dump / shot  调试用
 */
import { QUIZ_PAPER, QUIZ_RESULT } from './quiz-scripts.mjs';
import {
  buildQuizPrompt,
  chooseLetters,
  fallbackIdxs,
  normalizeType,
  parsePaperMeta,
  parseResult,
  planSelection,
} from './quiz-logic.mjs';

export function createQuizRunner(deps) {
  const {
    getPage,
    getCtx,
    readTree,
    log,
    patch,
    getLlm,
    askQuiz,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    dump = () => {},
    shot = async () => {},
    debug = false,
  } = deps;

  let busy = false;

  const view = async (tab) => {
    const paper = await tab.evaluate(QUIZ_PAPER).catch(() => null);
    if (!paper) return null;
    const q = (paper.questions || []).find((x) => x.visible) || (paper.questions || [])[0] || null;
    return { paper, question: q };
  };

  /** 点课程树里的「平时测试」节点，返回新开的考试页标签 */
  async function openQuizTab(key, tree) {
    const page = getPage();
    const ctx = getCtx();
    if (!page || page.isClosed()) return { ok: false, note: '课程页面不见了' };
    if (!ctx) return { ok: false, note: '浏览器上下文不见了' };
    const tests = (tree && tree.tests) || [];
    const idx = tests.findIndex((t) => String(t.chapter || '').trim() === key);
    if (idx < 0) return { ok: false, note: '课程树里没找到这一章的测试入口' };
    const nodes = page.locator('li.chapter-test, li.test-item');
    const n = await nodes.count().catch(() => 0);
    if (!n) return { ok: false, note: '课程树里没有测试入口' };
    const target = nodes.nth(Math.min(idx, n - 1));
    await target.scrollIntoViewIfNeeded().catch(() => {});
    await sleep(300);
    const box = await target.boundingBox().catch(() => null);
    if (!box) return { ok: false, note: '测试入口看不见（可能在折叠的章节里）' };

    const tabP = ctx.waitForEvent('page', { timeout: 25000 }).catch(() => null);
    // 真实鼠标点击（isTrusted=true）：平台对脚本合成的 click 敏感
    await page.mouse.click(box.x + Math.min(60, box.width / 2), box.y + box.height / 2);
    let tab = await tabP;
    if (!tab) {
      for (let i = 0; i < 24; i++) {
        await sleep(500);
        const cand = ctx.pages().find((p) => /onlineexamh5new|stuExamWeb/i.test(p.url()));
        if (cand) {
          tab = cand;
          break;
        }
      }
    }
    if (!tab) return { ok: false, note: '点了测试入口但没打开考试页' };
    await tab.waitForLoadState('domcontentloaded').catch(() => {});
    try {
      await tab.waitForSelector('.examPaper_subject', { timeout: 45000 });
    } catch {
      const body = await tab.evaluate(QUIZ_RESULT).catch(() => null);
      if (debug) {
        dump('quiz-open-fail-' + Date.now() + '.txt', (body && body.bodyText) || '没有正文');
        await shot('quiz-open-fail.png');
      }
      return { ok: false, note: '考试页打开了但没加载出题目', tab };
    }
    return { ok: true, tab };
  }

  /** 让当前题的勾选状态等于想要的下标集合（真实点击；回读不对就再补一次） */
  async function applySelection(tab, question, wantIdxs) {
    const want = new Set(wantIdxs.map(Number));
    let clicks = planSelection(question.options, wantIdxs);
    if (!clicks.length) return { ok: true, clicked: 0 };
    let clickedTimes = 0;
    for (let round = 0; round < 2; round++) {
      clicks = round === 0 ? planSelection(question.options, wantIdxs) : await currentMismatch(tab, want);
      if (!clicks.length) break;
      const res = await clickOptions(tab, clicks);
      clickedTimes += res.clicked;
      if (!res.ok) return { ok: false, why: res.why, clicked: clickedTimes };
    }
    const now = await view(tab);
    const bad = now && now.question ? now.question.options.some((o, i) => !!o.checked !== want.has(i)) : true;
    return { ok: !bad, clicked: clickedTimes, why: bad ? '点了但勾选状态不对' : '' };
  }

  /** 回读当前题，返回「和想要的状态不一致」的下标 */
  async function currentMismatch(tab, want) {
    const now = await view(tab);
    if (!now || !now.question) return [];
    const out = [];
    now.question.options.forEach((o, i) => {
      if (!!o.checked !== want.has(i)) out.push(i);
    });
    return out;
  }

  async function clickOptions(tab, clicks) {
    let clicked = 0;
    for (const i of clicks) {
      const boxes = tab.locator('.examPaper_subject:visible .nodeLab');
      const count = await boxes.count().catch(() => 0);
      if (i >= count) return { ok: false, why: '选项下标越界（选项 ' + count + ' 个，要点第 ' + (i + 1) + ' 个）' };
      const el = boxes.nth(i);
      await el.scrollIntoViewIfNeeded().catch(() => {});
      let clicked = false;
      try {
        await el.click({ timeout: 5000 });
        clicked = true;
      } catch {}
      if (!clicked) {
        try {
          await el.locator('.label').first().click({ timeout: 3000 });
          clicked = true;
        } catch {}
      }
      if (!clicked) {
        try {
          await el.locator('.node_detail').first().click({ timeout: 3000 });
          clicked = true;
        } catch {}
      }
      if (!clicked) return { ok: false, why: '选项点不动', clicked };
      clicked += 1;
      await sleep(220);
    }
    return { ok: true, clicked };
  }

  /** 点「下一题」并确认真的翻页了 */
  async function clickNext(tab) {
    const before = await view(tab);
    const beforeNum = before && before.question ? before.question.num : -1;
    const tries = [
      tab.locator('.switch-btn-box button').filter({ hasText: '下一题' }),
      tab.locator('button').filter({ hasText: '下一题' }),
    ];
    for (const loc of tries) {
      const cnt = await loc.count().catch(() => 0);
      if (!cnt) continue;
      const btn = loc.first();
      const disabled = await btn.isDisabled().catch(() => false);
      if (disabled) return { ok: false, why: '「下一题」是禁用的' };
      try {
        await btn.click({ timeout: 4000 });
      } catch {
        continue;
      }
      for (let i = 0; i < 12; i++) {
        await sleep(300);
        const now = await view(tab);
        const num = now && now.question ? now.question.num : -1;
        if (num !== beforeNum) return { ok: true, to: num };
      }
      return { ok: false, why: '点了「下一题」但没翻页' };
    }
    return { ok: false, why: '没找到「下一题」按钮' };
  }

  /** 答当前题：LLM → 解析 → 兜底 → 点选项；返回 { chosen:['B'], strategy } */
  async function answerCurrent(tab, question, meta) {
    let idxs = [];
    let strategy = 'llm';
    let why = '';
    if (getLlm() && getLlm().apiKey) {
      const prompt = buildQuizPrompt(meta, question);
      const res = await askQuiz(getLlm(), prompt);
      if (res && res.ok) {
        const picked = chooseLetters({
          text: res.raw || res.content || '',
          question,
          optionCount: question.options.length,
        });
        idxs = picked.idxs;
        why = picked.why;
        if (!idxs.length) {
          // 模型写了长篇解释、里面字母太多没法确定答案：追一句「只给字母」再问一次
          log('info', '第 ' + question.num + ' 题模型回复没解析出字母，再问一次（只许回字母）');
          const retry = await askQuiz(
            getLlm(),
            prompt +
              '\n\n只回复选项字母（如 B 或 AC），不要任何解释、标点或空格。（上一次的回复无法解析，请只回字母。）'
          );
          if (retry && retry.ok) {
            const p2 = chooseLetters({
              text: retry.raw || retry.content || '',
              question,
              optionCount: question.options.length,
            });
            if (p2.idxs.length) {
              idxs = p2.idxs;
              why = '重问一次：' + p2.why;
            }
          }
        }
      } else {
        why = (res && res.why) || '模型没回话';
      }
    } else {
      why = '还没配 API Key';
    }
    if (!idxs.length) {
      idxs = fallbackIdxs(question);
      strategy = 'fallback';
    }
    const sel = await applySelection(tab, question, idxs);
    if (!sel.ok) return { ok: false, why: sel.why, idxs, strategy, mwhy: why };
    return {
      ok: true,
      idxs,
      strategy,
      mwhy: why,
      letters: idxs.map((i) => (question.options[i] && question.options[i].label) || String.fromCharCode(65 + i)),
    };
  }

  /** 有题没答上时：按答题卡跳过去补 */
  async function repairUnanswered(tab, meta, total) {
    let answered = 0;
    for (let round = 0; round < 2; round++) {
      const v = await view(tab);
      if (!v) break;
      const card = v.paper.card || [];
      const todo = card.filter((c) => !c.done).map((c) => c.index - 1);
      if (!todo.length) return { ok: true, answered: card.filter((c) => c.done).length };
      const cards = tab.locator('ul.answerCard_list1 > li, ul.answerCard_list > li');
      for (const i of todo) {
        const cnt = await cards.count().catch(() => 0);
        if (i >= cnt) break;
        await cards
          .nth(i)
          .scrollIntoViewIfNeeded()
          .catch(() => {});
        try {
          await cards.nth(i).click({ timeout: 4000 });
        } catch {
          continue;
        }
        await sleep(600);
        const v2 = await view(tab);
        if (!v2 || !v2.question) continue;
        const a = await answerCurrent(tab, v2.question, meta);
        if (!a.ok) continue;
        await clickNext(tab);
        await sleep(500);
        answered += 1;
      }
      if (round >= 1) break;
    }
    const v = await view(tab);
    const card = (v && v.paper.card) || [];
    return { ok: card.length > 0 && card.every((c) => c.done), answered: card.filter((c) => c.done).length };
  }

  /** 点「提交作业」并在确认弹窗里点「确定」 */
  async function submitPaper(tab) {
    const byText = (re) => tab.locator('button, .operateBtn_box *, .operateBtn_box').filter({ hasText: re });
    let clicked = false;
    for (const loc of [byText('提交作业'), tab.getByText('提交作业', { exact: false })]) {
      const cnt = await loc.count().catch(() => 0);
      if (!cnt) continue;
      try {
        await loc.first().click({ timeout: 4000 });
        clicked = true;
        break;
      } catch {}
    }
    if (!clicked) return { ok: false, why: '没找到「提交作业」按钮' };
    await sleep(900);
    const confirms = [
      tab.locator('.el-message-box__btns button').filter({ hasText: '确定' }),
      tab.locator('.dialog-footer button').filter({ hasText: '确定' }),
      tab.getByRole('button', { name: '确定' }),
      tab.getByText('确定', { exact: true }),
    ];
    for (const loc of confirms) {
      const cnt = await loc.count().catch(() => 0);
      if (!cnt) continue;
      try {
        await loc.first().click({ timeout: 4000 });
        await sleep(2200);
        return { ok: true };
      } catch {}
    }
    // 没弹确认框也可能已经提交
    const r = await tab.evaluate(QUIZ_RESULT).catch(() => null);
    return { ok: !!(r && /已提交|提交成功/.test(r.bodyText || '')), why: '没找到确认按钮（可能已直接提交）' };
  }

  /**
   * 跑一章的平时测试。
   * @param {string} key 章节名（课程树里 li.chapter 的文本）
   * @returns {Promise<{ok:boolean, status:string, title?:string, chapter?:string, count?:number, total?:number, score?:number, answered?:number, note?:string}>}
   */
  async function run(key, opts) {
    const noSubmit = !!(opts && opts.noSubmit);
    if (busy) return { ok: false, status: 'failed', note: '已经在做测试了' };
    busy = true;
    const t0 = Date.now();
    let tab = null;
    try {
      log('info', '准备做「' + key + '」的平时测试');
      const tree = await readTree();
      if (!tree) return { ok: false, status: 'failed', note: '读不到课程树' };
      let opened = await openQuizTab(key, tree);
      if (!opened.ok && /没打开考试页/.test(opened.note || '')) {
        // 播放页可能正在切节/弹题（页面刚导航过），第一下点空了很常见：等页面稳住再试一次
        log('info', '测试入口第一下没点开（页面可能正在切节），3 秒后再试一次');
        await sleep(3000);
        const tree2 = await readTree();
        opened = await openQuizTab(key, tree2 || tree);
      }
      if (!opened.ok) return { ok: false, status: 'failed', note: opened.note };
      tab = opened.tab;
      await tab.bringToFront().catch(() => {});

      const first = await view(tab);
      if (!first || !first.paper.questions.length) return { ok: false, status: 'failed', note: '试卷里没有题目' };
      const meta = parsePaperMeta(first.paper.bodyText, first.paper.title);
      const total = first.paper.questions.length;

      // 平台显示这份卷子已经交过（打开的是「查看」页）：直接认下来，绝不重答
      if (first.paper.review) {
        const parsed = parseResult(first.paper.bodyText);
        log(
          'ok',
          '「' +
            (meta.title || key) +
            '」平台显示已经交过了' +
            (parsed.score == null ? '' : '（得分 ' + parsed.score + '）') +
            '，跳过'
        );
        return {
          ok: true,
          status: 'already',
          title: meta.title || first.paper.title || key,
          chapter: meta.chapter || key,
          count: total,
          total: parsed.total || meta.total || null,
          score: parsed.score,
          answered: total,
          note: '平台显示这份测试已经交过',
        };
      }
      const chapterName = meta.chapter || key;
      const title = meta.title || first.paper.title || key + ' 平时测试';
      log('ok', '试卷已打开：' + title + '（' + total + ' 题' + (meta.total ? '，' + meta.total + ' 分' : '') + '）');
      patch({
        quiz: {
          running: true,
          key,
          title,
          i: 0,
          n: total,
          answered: 0,
          strategy: '',
          last: null,
          result: null,
          error: '',
        },
      });

      // 逐题作答：靠「下一题」前进（每题点选项只是勾选，点下一题才保存）
      let answered = 0;
      for (let step = 0; step < total; step++) {
        const v = await view(tab);
        if (!v || !v.question) {
          log('warn', '第 ' + (step + 1) + ' 题读不到，先停下');
          break;
        }
        const type = normalizeType(v.question.type);
        const prompt = buildQuizPrompt({ courseName: tree.courseName, title }, v.question);
        if (debug)
          dump(
            'quiz-q' + (step + 1) + '-' + Date.now() + '.json',
            JSON.stringify({ meta, question: v.question, prompt }, null, 2)
          );
        patch({ quiz: { running: true, key, title, i: step + 1, n: total, answered, strategy: '', last: null } });
        log(
          'info',
          '第 ' +
            (step + 1) +
            '/' +
            total +
            ' 题（' +
            (v.question.type || '题目') +
            '）' +
            (type === 'multi' ? ' 多选' : '')
        );

        const a = await answerCurrent(tab, v.question, { courseName: tree.courseName, title });
        if (!a.ok) {
          log('warn', '第 ' + (step + 1) + ' 题没答上：' + a.why);
        }
        const lettersText = (a.letters || []).join('') || '?';
        log(
          a.ok ? 'ok' : 'warn',
          '选 ' + lettersText + '（' + (a.strategy === 'llm' ? '模型' : '兜底') + (a.mwhy ? '，' + a.mwhy : '') + '）'
        );
        patch({
          quiz: {
            running: true,
            key,
            title,
            i: step + 1,
            n: total,
            answered: answered + (a.ok ? 1 : 0),
            strategy: a.strategy,
            last: {
              num: v.question.num,
              type: v.question.type || '',
              chosen: a.letters || [],
              result: a.ok ? '已选' : '失败',
            },
          },
        });
        if (!a.ok) continue;
        answered += 1;

        const nx = await clickNext(tab);
        if (nx.ok) {
          await sleep(500);
          continue;
        }
        // 最后一题：没有「下一题」或按钮禁用，直接跳出准备提交
        if (/没翻页|禁用/.test(nx.why || '')) {
          log('info', '已经是最后一题');
          break;
        }
        log('warn', '翻页失败：' + nx.why);
      }

      // 校验答题卡：还有没答的题就按答题卡跳过去补
      const repaired = await repairUnanswered(tab, { courseName: tree.courseName, title }, total);
      if (!repaired.ok) {
        log('warn', '还有题目没答上（已答 ' + repaired.answered + '/' + total + '），为了不交白卷，先不提交');
        await shot('quiz-unfinished.png');
        return {
          ok: false,
          status: 'failed',
          title,
          chapter: chapterName,
          count: total,
          total: meta.total || null,
          answered: repaired.answered,
          note: '有 ' + (total - repaired.answered) + ' 题没答上，没敢提交（可以手动进去补）',
        };
      }

      if (noSubmit) {
        log('ok', '调试模式：' + total + ' 题都填好了，这次不提交（关掉试卷页）');
        return {
          ok: true,
          status: 'dry',
          title,
          chapter: chapterName,
          count: total,
          total: meta.total || null,
          answered: repaired.answered,
          note: '调试运行，没有提交',
          ms: Date.now() - t0,
        };
      }

      log('ok', '全部 ' + total + ' 题已作答，正在提交…');
      patch({ quiz: { running: true, key, title, i: total, n: total, answered: total, strategy: 'llm', last: null } });
      const sub = await submitPaper(tab);
      if (!sub.ok) {
        log('warn', '提交没成功：' + (sub.why || ''));
        return {
          ok: false,
          status: 'failed',
          title,
          chapter: chapterName,
          count: total,
          total: meta.total || null,
          answered: total,
          note: '答案都填了但提交没成功：' + (sub.why || ''),
        };
      }
      const res = await tab.evaluate(QUIZ_RESULT).catch(() => null);
      const parsed = parseResult(res && res.bodyText);
      if (debug) dump('quiz-result-' + Date.now() + '.txt', (res && res.bodyText) || '');
      const scoreText =
        parsed.score == null ? '已提交' : '得分 ' + parsed.score + (parsed.total ? '/' + parsed.total : '') + ' 分';
      log('ok', '「' + title + '」提交完成：' + scoreText);
      return {
        ok: true,
        status: 'done',
        title,
        chapter: chapterName,
        count: total,
        total: parsed.total || meta.total || null,
        score: parsed.score,
        answered: total,
        note: parsed.score == null ? '已提交（平台没回分数）' : '',
        ms: Date.now() - t0,
      };
    } catch (e) {
      const msg = String((e && e.message) || e).slice(0, 160);
      log('err', '做章节测试时出错：' + msg);
      if (tab) {
        if (debug) await shot('quiz-error.png');
      }
      return { ok: false, status: 'failed', note: '出错了：' + msg };
    } finally {
      try {
        if (tab && !tab.isClosed()) await tab.close();
      } catch {}
      busy = false;
      patch({ quiz: { running: false } });
    }
  }

  return { run, busy: () => busy };
}
