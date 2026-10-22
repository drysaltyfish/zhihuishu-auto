/**
 * 页内提取脚本（纯函数，只描述「怎么从 DOM 读数据」）。
 * 这些函数会被 Playwright 序列化后在页面里执行，所以：
 *  - 不能引用模块作用域的变量（闭包里拿不到），选择器等一律内联；
 *  - 只读 DOM，不注入、不改页面（铁律 1）；
 *  - 不 import 任何东西（页面里没有这些模块）。
 * 想改选择器时只改这个文件，node 侧定位器用下面导出的常量保持一致。
 */

/** 弹题弹窗的候选选择器（页面里用 querySelector 逐个试） */
export const DIALOG_BOX_CSS =
  '#playTopic-dialog, [class*="playTopic"], [class*="popupExam"], [class*="topicExam"], [class*="exam-dialog"]';

/** 视频播放/暂停键的候选选择器（按顺序试第一个可见的） */
export const PLAY_BUTTON_CSS = [
  '.play-btn',
  '.vjs-big-play-button',
  '.prism-big-play-btn',
  '.controls-play',
  '.prism-play-btn',
];

/** 视频状态 + 页面状态（只读采样用） */
export const VSTATE = () => {
  const vs = Array.from(document.querySelectorAll('video'));
  if (!vs.length) return null;
  vs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
  const v = vs[0];
  return {
    ct: +(+v.currentTime).toFixed(2),
    dur: +(+v.duration || 0).toFixed(2),
    paused: v.paused,
    rate: v.playbackRate,
    ended: v.ended,
    src: (v.currentSrc || v.src || '').slice(0, 120),
    vis: document.visibilityState,
    title: document.title,
    url: location.href,
  };
};

/** 让最大那个视频开始播（先静音，绕开自动播放限制） */
export const PLAY_VIDEO = () => {
  const vs = Array.from(document.querySelectorAll('video'));
  vs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
  const v = vs[0];
  if (!v) return false;
  try {
    v.muted = true;
  } catch {}
  try {
    const p = v.play();
    if (p && p.catch) p.catch(() => {});
  } catch {}
  return true;
};

/** 暂停最大那个视频（安静地，不报错） */
export const PAUSE_VIDEO = () => {
  const vs = Array.from(document.querySelectorAll('video'));
  vs.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
  if (vs[0]) {
    try {
      vs[0].pause();
    } catch {}
  }
  return true;
};

/** 弹题弹窗的完整结构（含题面/选项/是否已作答/正确答案/分页） */
export const DIALOG = () => {
  const sels = [
    '#playTopic-dialog',
    '[class*="playTopic"]',
    '[class*="popupExam"]',
    '[class*="topicExam"]',
    '[class*="exam-dialog"]',
  ];
  let box = null;
  for (const s of sels) {
    const e = document.querySelector(s);
    if (e) {
      box = e;
      break;
    }
  }
  if (!box) return { visible: false };
  const s = getComputedStyle(box);
  if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return { visible: false };
  const r = box.getBoundingClientRect();
  if (r.width < 120 || r.height < 60) return { visible: false };

  const lis = Array.from(box.querySelectorAll('ul.topic-list > li, ul.topic-list li'));
  const options = lis
    .map((li) => {
      const active = /active/.test(String(li.className)) || !!li.querySelector('.active');
      const labelEl = li.querySelector('.topic-option-item');
      const textEl = li.querySelector('.item-topic');
      return {
        label: labelEl ? (labelEl.innerText || '').replace(/\s+/g, ' ').trim() : '',
        text: textEl
          ? (textEl.innerText || '').replace(/\s+/g, ' ').trim()
          : (li.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 400),
        active,
      };
    })
    .filter((o) => o.text || o.label);

  const titleEl = box.querySelector('.topic-title');
  const typeEl = box.querySelector('.title-tit');
  const feedbackEl = box.querySelector('.topic-title .error, .topic-title .correct, .topic-title .right');
  const answerEl = box.querySelector('.answer');
  const pages = Array.from(box.querySelectorAll('.el-pager li.number')).map((e) => (e.innerText || '').trim());
  const activePage = box.querySelector('.el-pager li.number.active');
  const nextBtn = box.querySelector('.btn-next');
  const closeBtn = box.querySelector('.el-dialog__footer .btn, .dialog-footer .btn');
  const headerBtn = box.querySelector('button.el-dialog__headerbtn');

  return {
    visible: true,
    id: box.id || '',
    cls: String(box.className || '').slice(0, 80),
    title: (titleEl ? titleEl.innerText : '').replace(/\s+/g, ' ').trim().slice(0, 600),
    type: typeEl ? (typeEl.innerText || '').trim() : '',
    feedback: feedbackEl ? (feedbackEl.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 20) : '',
    answered: !!answerEl || !!feedbackEl,
    answerText: answerEl ? (answerEl.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60) : '',
    options,
    optionCount: options.length,
    pages: pages.length,
    pageIndex: activePage ? (activePage.innerText || '').trim() : pages[0] || '1',
    hasNextPage: !!(nextBtn && !nextBtn.disabled),
    hasClose: !!(closeBtn || headerBtn),
    closeText: closeBtn ? (closeBtn.innerText || '').replace(/\s+/g, ' ').trim() : '',
    selected: options.filter((o) => o.active).map((o) => o.label),
  };
};

/** 弹窗原始 HTML（排错存盘用） */
export const DIALOG_HTML = () => {
  const sels = [
    '#playTopic-dialog',
    '[class*="playTopic"]',
    '[class*="popupExam"]',
    '[class*="topicExam"]',
    '[class*="exam-dialog"]',
  ];
  let box = null;
  for (const s of sels) {
    const e = document.querySelector(s);
    if (e) {
      box = e;
      break;
    }
  }
  if (!box) return null;
  return { html: box.outerHTML.slice(0, 40000), frameUrl: location.href };
};

/** 课程树：章节标题 + 每一节（编号/名称/进度/时长/是否已完成/是否当前节） */
export const COURSE_TREE = () => {
  const txt = (e) => (e && (e.innerText || '').replace(/\s+/g, ' ').trim()) || '';
  const first = (sels) => {
    for (const s of sels) {
      const e = document.querySelector(s);
      const t = txt(e);
      if (t && t.length < 80) return t;
    }
    return '';
  };
  const out = [];
  const tests = [];
  let curChapter = '';
  const nodes = Array.from(document.querySelectorAll('li'));
  for (const li of nodes) {
    const cls = String(li.className || '');
    if (!/video|chapter|test/.test(cls)) continue;
    // 测试节点要排在章头判断之前：它自己不带章名，得靠前面记住的 curChapter 归属
    if (/chapter-test|test-item/.test(cls)) {
      const t = txt(li);
      // b.finish = 这章的测试已经交过（平台课程树上有对勾）；没交过是
      // span.iconbaizhoumoshi-zhangceshi-shubiaoyiru（hover 图标）。
      if (t)
        tests.push({
          chapter: curChapter,
          text: t.replace(/\s*\d{1,3}%\s*$/, '').trim(),
          cls: cls.slice(0, 90),
          done: !!li.querySelector('b.finish'),
        });
      continue;
    }
    if (/chapter/.test(cls) && !/video/.test(cls)) {
      curChapter = txt(li);
      continue;
    }
    if (!/video/.test(cls)) continue;
    const t = txt(li);
    if (!t) continue;
    const pctM = /(\d{1,3})%/.exec(t);
    const durM = /(\d{2}):(\d{2}):(\d{2})/.exec(t);
    const codeM = /^(\d+\.\d+)/.exec(t);
    const icons = Array.from(li.querySelectorAll('i, em, b, span[class]'))
      .map((x) => String(x.className || ''))
      .filter(Boolean)
      .slice(0, 8);
    const bar = li.querySelector('[role="progressbar"]');
    const barPct = bar && bar.getAttribute('aria-valuenow');
    const finished = !!li.querySelector('b.time_icofinish');
    const half = !!li.querySelector('b.time_ico_half');
    out.push({
      code: codeM ? codeM[1] : '',
      name: t
        .replace(/^\d+\.\d+\s*/, '')
        .replace(/\s*\d{1,3}%\s*/, ' ')
        .replace(/\s*\d{2}:\d{2}:\d{2}\s*$/, '')
        .trim(),
      pct: barPct != null ? Number(barPct) : pctM ? Number(pctM[1]) : null,
      durText: durM ? durM[0] : '',
      durSec: durM ? Number(durM[1]) * 3600 + Number(durM[2]) * 60 + Number(durM[3]) : 0,
      current: /current_play/.test(cls),
      chapter: curChapter,
      cls: cls.slice(0, 90),
      icons,
      finished,
      half,
      doneAttr:
        finished || /finish|complete|done|already|isLearn|learnd/i.test(cls) || !!li.querySelector('.el-icon-check'),
      html: out.length < 3 ? li.outerHTML.slice(0, 600) : '',
    });
  }
  return {
    title: document.title,
    url: location.href,
    courseName: first(['.source-name', '.course-name', '.courseName', '.sourceName']),
    school: first(['.source-down']),
    chapter: first(['.videotop_lesson']),
    lesson: first(['.videotop_lesson_tit']),
    lessons: out,
    tests,
  };
};

/** 平台的反脚本提示（合成事件/自动化环境会触发） */
export const ABNORMAL = () => {
  const els = Array.from(
    document.querySelectorAll('.el-message-box, .el-dialog, .layui-layer, [class*="message-box"]')
  );
  for (const e of els) {
    const t = (e.innerText || '').replace(/\s+/g, ' ');
    if (!((e.offsetWidth || 0) > 0 && (e.offsetHeight || 0) > 0)) continue;
    if (t.includes('异常脚本') || t.includes('关闭插件')) return t.slice(0, 160);
  }
  return '';
};

/** 人机验证（腾讯 tcaptcha 的 iframe 常驻在屏幕外，必须判断「在屏幕内」才算弹出） */
export const VERIFY = () => {
  const onScreen = (e) => {
    const b = e.getBoundingClientRect();
    if (!(b.width > 80 && b.height > 40)) return false;
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    return b.bottom > 0 && b.right > 0 && b.top < vh && b.left < vw && b.top > -200;
  };
  const RE = /请完成安全验证|请完成验证|拖动滑块|按住滑块|请依次点击|点击.{0,8}验证/;
  const boxes = document.querySelectorAll(
    '.el-dialog__wrapper, .el-dialog, [class*="verify"], [class*="captcha"], [class*="yidun"], [class*="geetest"], [class*="nc_wrapper"], [class*="slide"], [id^="tcaptcha"]'
  );
  for (const e of boxes) {
    if (!onScreen(e)) continue;
    const t = (e.innerText || '').replace(/\s+/g, ' ').trim();
    if (t && RE.test(t)) return t.slice(0, 90);
  }
  for (const e of document.querySelectorAll('iframe')) {
    if (!onScreen(e)) continue;
    const src = (e.getAttribute('src') || '') + '';
    if (/captcha|verify|turing\./i.test(src)) return '验证码 iframe';
  }
  const t = document.body ? document.body.innerText || '' : '';
  if (/请完成安全验证|拖动滑块|按住滑块|请依次点击/.test(t)) return '页面出现安全验证';
  return '';
};

/** 学堂首页的课程卡片列表 */
export const COURSE_LIST = () => {
  const txt = (e) => (e && (e.innerText || '').replace(/\s+/g, ' ').trim()) || '';
  const out = [];
  const nodes = Array.from(document.querySelectorAll('.item-left-course'));
  nodes.forEach((el, i) => {
    const spans = Array.from(el.querySelectorAll('.teacherName span')).map(txt).filter(Boolean);
    const pctTxt = txt(el.querySelector('.processNum'));
    const m = /([\d.]+)\s*%/.exec(pctTxt);
    const dl = el.closest('dl');
    const a = dl ? dl.querySelector('.right-item-course a[href*="recruitId"]') : null;
    const rm = a ? /recruitId=(\d+)/.exec(a.href) : null;
    out.push({
      i,
      name: txt(el.querySelector('.courseName')),
      teacher: spans[0] || '',
      school: spans[1] || '',
      now: txt(el.querySelector('.nowCourse .name')),
      pct: m ? Number(m[1]) : null,
      recruitId: rm ? rm[1] : '',
    });
  });
  return out;
};

/** 课堂页面正文（排错用） */
export const PAGE_TEXT = () =>
  document.body ? (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 1200) : '';
