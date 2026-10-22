/**
 * 章节测试的断点：data/quizzes.json 记每一章做过没有、得了多少分。
 * 结构：{ "<章节名>": { status, title, count, total, score, answered, at, note } }
 * 只保留 JSON 小文件，写用「临时文件 + rename」避免断电写坏。
 */
import fs from 'node:fs';
import path from 'node:path';

export function quizzesPath(dataDir) {
  return path.join(dataDir || '.', 'quizzes.json');
}

export function loadQuizzes(dataDir) {
  try {
    const raw = fs.readFileSync(quizzesPath(dataDir), 'utf8');
    const j = JSON.parse(raw);
    if (!j || typeof j !== 'object' || Array.isArray(j)) return {};
    const out = {};
    for (const [k, v] of Object.entries(j)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveQuizzes(dataDir, map) {
  try {
    const dir = dataDir || '.';
    fs.mkdirSync(dir, { recursive: true });
    const file = quizzesPath(dir);
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(map || {}, null, 2));
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}
