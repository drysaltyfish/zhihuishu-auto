/** 路径规划的纯逻辑单测：不需要 electron / 真实打包产物 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { planRuntime, isTempDir, samePath, modeLabel } from '../desktop/paths-plan.mjs';

const TMP = 'C:/Temp';
const APPDATA = 'D:/AppData/Roaming';
const PRODUCT = 'ZhihuishuAuto';

function base(over) {
  return {
    packaged: true,
    appRoot: 'D:/repo/resources/app',
    exeDir: 'D:/Apps/ZhihuishuAuto',
    exePath: 'D:/Apps/ZhihuishuAuto/ZhihuishuAuto.exe',
    appDataDir: APPDATA,
    tmpRoots: [TMP],
    installRoots: ['C:/Users/me/AppData/Local/Programs', 'C:/Program Files'],
    productName: PRODUCT,
    ...over,
  };
}

test('isTempDir：命中临时目录本身/子目录，大小写与尾分隔符不敏感；同前缀的兄弟目录不算', () => {
  assert.equal(isTempDir('C:/Temp', [TMP]), true);
  assert.equal(isTempDir('c:\\temp\\abc', [TMP]), true);
  assert.equal(isTempDir('C:/Temp/', [TMP]), true);
  assert.equal(isTempDir('C:/TempX', [TMP]), false);
  assert.equal(isTempDir('D:/Apps', [TMP]), false);
  assert.equal(isTempDir('', [TMP]), false);
});

test('samePath：忽略大小写与尾分隔符', () => {
  assert.equal(samePath('D:/Apps/a', 'd:\\apps\\a\\'), true);
  assert.equal(samePath('D:/Apps/a', 'D:/Apps/b'), false);
  assert.equal(samePath('', 'D:/Apps/a'), false);
});

test('开发模式：数据放仓库 data/，不是免安装形态', () => {
  const p = planRuntime(
    base({ packaged: false, appRoot: 'D:/repo', exeDir: 'D:/node/electron', exePath: 'D:/node/electron/electron.exe' })
  );
  assert.equal(p.mode, 'dev');
  assert.equal(p.isPortable, false);
  assert.ok(samePath(p.dataCandidates[0].dir, 'D:/repo/data'));
  assert.ok(samePath(p.launchExe, 'D:/node/electron/electron.exe'));
});

test('ZHS_DATA 环境变量优先于一切', () => {
  const p = planRuntime(base({ envData: 'E:/custom/data' }));
  assert.ok(samePath(p.dataCandidates[0].dir, 'E:/custom/data'));
  assert.ok(samePath(p.dataCandidates[1].dir, 'D:/Apps/ZhihuishuAuto/data'));
});

test('单文件免安装版：数据放启动器所在目录，不用 %TEMP% 里的 execPath', () => {
  const p = planRuntime(
    base({
      exeDir: 'C:/Temp/zhihuishu-abc/app',
      exePath: 'C:/Temp/zhihuishu-abc/app/ZhihuishuAuto.exe',
      portableDir: 'D:/Apps/ZhihuishuAuto',
      portableFile: 'D:/Apps/ZhihuishuAuto/ZhihuishuAuto.exe',
    })
  );
  assert.equal(p.mode, 'portable-file');
  assert.equal(p.isPortable, true);
  assert.ok(samePath(p.launchExe, 'D:/Apps/ZhihuishuAuto/ZhihuishuAuto.exe'));
  assert.ok(samePath(p.dataCandidates[0].dir, 'D:/Apps/ZhihuishuAuto/data'));
  // 候选里不能出现临时目录
  for (const c of p.dataCandidates) assert.equal(isTempDir(c.dir, [TMP]), false, c.dir);
});

test('单文件免安装版：只有 PORTABLE_EXECUTABLE_FILE 时也能定位', () => {
  const p = planRuntime(
    base({
      exeDir: 'C:/Temp/x/app',
      exePath: 'C:/Temp/x/app/ZhihuishuAuto.exe',
      portableFile: 'D:/Green/ZhihuishuAuto.exe',
    })
  );
  assert.equal(p.mode, 'portable-file');
  assert.ok(samePath(p.launchExe, 'D:/Green/ZhihuishuAuto.exe'));
  assert.ok(samePath(p.dataCandidates[0].dir, 'D:/Green/data'));
});

test('exe 就在临时目录里跑（例如直接在压缩包预览里双击）：数据只放用户数据目录', () => {
  const p = planRuntime(base({ exeDir: 'C:/Temp/Temp1_x/app', exePath: 'C:/Temp/Temp1_x/app/ZhihuishuAuto.exe' }));
  assert.equal(p.mode, 'temp-exe');
  assert.equal(p.dataCandidates.length, 1);
  assert.ok(samePath(p.dataCandidates[0].dir, 'D:/AppData/Roaming/ZhihuishuAuto/data'));
  assert.ok(samePath(p.fallbackDataDir, 'D:/AppData/Roaming/ZhihuishuAuto/data'));
  assert.equal(p.isPortable, true);
});

test('解压即用的目录版：数据放 exe 同级 data/', () => {
  const p = planRuntime(base());
  assert.equal(p.mode, 'portable-dir');
  assert.equal(p.isPortable, true);
  assert.ok(samePath(p.dataCandidates[0].dir, 'D:/Apps/ZhihuishuAuto/data'));
  assert.ok(samePath(p.dataCandidates[1].dir, 'D:/AppData/Roaming/ZhihuishuAuto/data'));
});

test('安装版（历史形态）：数据放安装目录 data/，且不算免安装', () => {
  const p = planRuntime(
    base({
      exeDir: 'C:/Users/me/AppData/Local/Programs/ZhihuishuAuto',
      exePath: 'C:/Users/me/AppData/Local/Programs/ZhihuishuAuto/ZhihuishuAuto.exe',
    })
  );
  assert.equal(p.mode, 'installed');
  assert.equal(p.isPortable, false);
  assert.ok(samePath(p.dataCandidates[0].dir, 'C:/Users/me/AppData/Local/Programs/ZhihuishuAuto/data'));
  assert.ok(samePath(p.launchExe, 'C:/Users/me/AppData/Local/Programs/ZhihuishuAuto/ZhihuishuAuto.exe'));
});

test('候选目录去重：ZHS_DATA 与 exe 同级 data 相同时只留一条', () => {
  const p = planRuntime(base({ envData: 'D:/Apps/ZhihuishuAuto/data' }));
  assert.equal(p.dataCandidates.length, 2);
  assert.ok(samePath(p.dataCandidates[0].dir, 'D:/Apps/ZhihuishuAuto/data'));
});

test('modeLabel：四种形态都有中文名', () => {
  assert.equal(modeLabel('dev'), '开发版');
  assert.equal(modeLabel('portable-file'), '免安装（单文件）');
  assert.equal(modeLabel('portable-dir'), '免安装（解压即用）');
  assert.equal(modeLabel('temp-exe'), '临时目录运行');
  assert.equal(modeLabel('installed'), '安装版');
  assert.equal(modeLabel('???'), '未知形态');
});
