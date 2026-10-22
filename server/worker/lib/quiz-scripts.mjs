/**
 * 考试页（onlineexamh5new.zhihuishu.com）的页内提取脚本。
 * 与 page-scripts.mjs 同样的规矩：纯函数、自包含（会被序列化到页面里执行）、只读 DOM。
 *
 * 实测结构（2026-10-22，脚本 scripts/tmp-quizprobe4.mjs 存下来的快照见 docs/DESIGN.md）：
 *   div.examPaper_subject            每题一个，全部渲染，只有当前题可见
 *     div.subject_num                题号（1.）
 *     span.subject_type              【单选题】/【多选题】/【判断题】
 *     div.subject_describe           题干（经常是空的，只有选项）
 *     div.nodeLab                    每个选项（内含 input[type=radio|checkbox]，display:none）
 *       span.ABCase                  选项字母 A.
 *       div.node_detail              选项文字
 *   div.switch-btn-box button        上一题 / 下一题
 *   div.operateBtn_box               提交作业 / 暂存作业
 *   ul.answerCard_list1 > li         答题卡（white=未答，green=已答）
 */

/** 把整张试卷读出来：所有题目（含不可见的）+ 答题卡 + 正文 */
export const QUIZ_PAPER = () => {
  const txt = (e) => (e && (e.innerText || '').replace(/\s+/g, ' ').trim()) || '';
  const isShown = (e) => {
    if (!e) return false;
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false;
    const r = e.getBoundingClientRect();
    return r.width > 40 && r.height > 10;
  };
  const subjects = Array.from(document.querySelectorAll('.examPaper_subject'));
  const questions = subjects.map((el, idx) => {
    const numText = txt(el.querySelector('.subject_num'));
    const numM = /(\d+)/.exec(numText);
    const opts = Array.from(el.querySelectorAll('.nodeLab'))
      .map((lab) => {
        const input = lab.querySelector('input[type=radio], input[type=checkbox]');
        const label = txt(lab.querySelector('.ABCase'));
        const text = txt(lab.querySelector('.node_detail')) || txt(lab);
        return {
          label: label.replace(/\.$/, ''),
          text: text.replace(/^[A-H]\s*[.、]\s*/, '').slice(0, 600),
          // 智慧树选中状态不用原生 checked：点选后给 .ABCase / .node_detail 加 onChecked，
          // 并把 img.flagChecked 换成选中图。只读 input.checked 会永远 false（2026-10-22 实测）。
          checked: (input ? !!input.checked : false) || !!lab.querySelector('.onChecked'),
          inputType: input ? String(input.type || '') : '',
          value: input ? String(input.value || '') : '',
        };
      })
      .filter((o) => o.text || o.label);
    return {
      index: idx,
      num: numM ? Number(numM[1]) : idx + 1,
      type: txt(el.querySelector('.subject_type')) || '',
      stem: txt(el.querySelector('.subject_describe')).slice(0, 1200),
      options: opts,
      visible: isShown(el),
    };
  });

  const card = Array.from(document.querySelectorAll('ul.answerCard_list1 > li, ul.answerCard_list > li')).map(
    (li, i) => {
      const cls = String(li.className || '');
      return {
        index: i + 1,
        cls: cls.slice(0, 60),
        done: /green|done|active_?green|complete/i.test(cls),
        text: txt(li).slice(0, 12),
      };
    }
  );

  const btnTexts = Array.from(document.querySelectorAll('button, .switch-btn-box *, .operateBtn_box *'))
    .map((e) => txt(e))
    .filter((t) => t && t.length <= 12);

  const bodyAll = document.body ? document.body.innerText : '';
  const hasSubmit = /提交作业/.test(bodyAll);
  // 已交过的卷子：平台打开的是「查看」页（URL 里 checkHomework），没有「提交作业」按钮，
  // 每题旁边直接写「正确 / 本题的得分」。这种页面不能再作答，必须直接认下来跳过。
  const graded = /得\s*分\s*[:：]|本题的得分|查看解析|已批阅/.test(bodyAll);
  return {
    title: document.title,
    url: location.href,
    bodyText: bodyAll.replace(/\n{2,}/g, '\n').slice(0, 6000),
    questions,
    card,
    buttons: [...new Set(btnTexts)].slice(0, 40),
    submitted: /已提交|提交成功/.test(bodyAll),
    hasSubmit,
    graded,
    review: /checkHomework/i.test(location.href) || (graded && !hasSubmit),
  };
};

/** 提交后（或结果页）读正文，用来取分数 */
export const QUIZ_RESULT = () => ({
  title: document.title,
  url: location.href,
  bodyText: (document.body ? document.body.innerText : '').replace(/\n{2,}/g, '\n').slice(0, 4000),
});
