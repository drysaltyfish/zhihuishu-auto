/**
 * 把 Playwright 自带的 Chromium 挪到 <仓库>/browsers，供打包版带上（安装后用户不用再装浏览器）。
 * 安装命令（下载时用国内镜像）：
 *   PLAYWRIGHT_BROWSERS_PATH=0 \
 *   PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright/ \
 *   node node_modules/playwright/cli.js install chromium
 * 本脚本只做「搬 + 瘦身 + 校验」，可重复执行。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'node_modules', 'playwright-core', '.local-browsers');
const DST = path.join(ROOT, 'browsers');
const KEEP = /^(chromium-\d+|winldd-\d+)$/; // 只要带界面的 chromium（不用 headless_shell / ffmpeg）

function rm(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 });
  } catch {}
}

function copyDir(from, to) {
  fs.cpSync(from, to, { recursive: true });
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error('[browsers] 没找到 ' + SRC);
    console.error(
      '[browsers] 先执行：PLAYWRIGHT_BROWSERS_PATH=0 PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright/ node node_modules/playwright/cli.js install chromium'
    );
    process.exit(1);
  }
  fs.mkdirSync(DST, { recursive: true });
  let moved = 0;
  for (const name of fs.readdirSync(SRC)) {
    if (!KEEP.test(name)) {
      console.log('[browsers] 跳过 ' + name);
      continue;
    }
    const from = path.join(SRC, name);
    const to = path.join(DST, name);
    if (!fs.existsSync(to)) {
      console.log('[browsers] 搬运 ' + name + ' …');
      copyDir(from, to);
      moved++;
    }
    rm(from); // 搬走后从 node_modules 里删掉，避免仓库里两份
  }
  rm(SRC); // 剩下不要的（headless_shell / ffmpeg）也别留在 node_modules，否则会被打进发行包
  const chromium = fs.readdirSync(DST).find((n) => /^chromium-\d+$/.test(n));
  if (!chromium) {
    console.error('[browsers] 没有 chromium-*，搬运失败');
    process.exit(1);
  }
  // 新版 Playwright 的目录名是 chrome-win64，老版本是 chrome-win
  const exe = ['chrome-win64', 'chrome-win']
    .map((d) => path.join(DST, chromium, d, 'chrome.exe'))
    .find((x) => fs.existsSync(x));
  if (!exe) {
    console.error('[browsers] chromium 里没找到 chrome.exe');
    process.exit(1);
  }
  const size = walk(DST);
  console.log('[browsers] 完成：' + chromium + '，' + (size / 1024 / 1024).toFixed(0) + ' MB，出口 ' + exe);
}

function walk(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    n += e.isDirectory() ? walk(p) : fs.statSync(p).size;
  }
  return n;
}

main();
