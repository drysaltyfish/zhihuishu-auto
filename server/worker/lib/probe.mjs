/**
 * 探针：把「在哪个 frame 里读什么」这件事收进一个适配层。
 * main.mjs 只调这里的方法，不直接拼 page.evaluate（换选择器只改 page-scripts.mjs）。
 */
import {
  ABNORMAL,
  COURSE_LIST,
  COURSE_TREE,
  DIALOG,
  DIALOG_HTML,
  PAUSE_VIDEO,
  PAGE_TEXT,
  PLAY_VIDEO,
  VSTATE,
  VERIFY,
} from './page-scripts.mjs';

export function createProbe({ getPage }) {
  const page = () => getPage();
  const alive = () => {
    const p = page();
    return !!p && !p.isClosed();
  };

  /** 在主页 + 所有子 frame 里找可见弹窗（智慧树的弹窗可能在 iframe 里） */
  async function findDialog() {
    const p = page();
    if (!p || p.isClosed()) return null;
    for (const fr of p.frames()) {
      try {
        const d = await fr.evaluate(DIALOG);
        if (d && d.visible) return { frame: fr, d, frameUrl: fr.url() };
      } catch {}
    }
    return null;
  }

  /** 同样在所有 frame 里找视频 */
  async function findVideo() {
    const p = page();
    if (!p || p.isClosed()) return null;
    let best = null;
    for (const fr of p.frames()) {
      try {
        const v = await fr.evaluate(VSTATE);
        if (v && v.dur > 0) {
          if (!best || v.dur > best.v.dur) best = { frame: fr, v };
        }
      } catch {}
    }
    return best;
  }

  /** 一次采样：视频 + 弹窗（弹窗可能来自别的 frame，所以单独给 dialogFrame） */
  async function pageState() {
    const out = { video: null, dialog: { visible: false }, dialogFrame: null };
    const fv = await findVideo();
    if (fv) out.video = fv.v;
    const fd = await findDialog();
    if (fd) out.dialog = fd.d;
    out.dialogFrame = fd ? fd.frame : null;
    return out;
  }

  async function detectAbnormal() {
    const p = page();
    if (!p || p.isClosed()) return '';
    try {
      return (await p.evaluate(ABNORMAL)) || '';
    } catch {
      return '';
    }
  }

  async function detectVerify() {
    const p = page();
    if (!p || p.isClosed()) return '';
    for (const f of p.frames()) {
      try {
        const r = await f.evaluate(VERIFY);
        if (r) return r;
      } catch {}
    }
    return '';
  }

  /** 让视频开始播：先 evaluate play()（静音），再点播放键兜底 */
  async function playInFrame(frame) {
    try {
      await frame.evaluate(PLAY_VIDEO);
    } catch {}
  }

  async function pauseVideoQuiet() {
    const fv = await findVideo();
    if (!fv) return;
    try {
      await fv.frame.evaluate(PAUSE_VIDEO);
    } catch {}
  }

  async function readCourseTree() {
    const p = page();
    if (!p || p.isClosed()) return null;
    return await p.evaluate(COURSE_TREE);
  }

  async function dialogHtml(frame) {
    try {
      return await frame.evaluate(DIALOG_HTML);
    } catch {
      return null;
    }
  }

  async function readCourseList(tab) {
    return await tab.evaluate(COURSE_LIST);
  }

  async function pageText(p) {
    const target = p || page();
    if (!target || target.isClosed()) return '';
    try {
      return await target.evaluate(PAGE_TEXT);
    } catch {
      return '';
    }
  }

  return {
    alive,
    findDialog,
    findVideo,
    pageState,
    detectAbnormal,
    detectVerify,
    playInFrame,
    pauseVideoQuiet,
    readCourseTree,
    dialogHtml,
    readCourseList,
    pageText,
  };
}
