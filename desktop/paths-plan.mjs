/**
 * 路径规划的纯逻辑：只做字符串/路径计算，不引用 electron、不读写磁盘。
 * 主进程用它决定「数据目录该放哪」，因为纯函数，可以直接被 test/paths-plan.test.mjs 覆盖。
 *
 * 为什么要单独拆出来：打包成 Portable 后 process.execPath 指向自解压出来的 %TEMP% 目录，
 * 直接按「exe 同级 data/」放会写进临时目录、退出即被清理。这里把各种运行形态的候选顺序写死并测出来：
 *   - dev           开发模式（electron .），数据放仓库 data/
 *   - portable-file 单文件免安装版：启动器把程序解压到 %TEMP% 运行，PORTABLE_EXECUTABLE_DIR 指向真正的 exe 所在目录
 *   - portable-dir  解压即用目录版：exe 在普通目录里，数据放 exe 同级 data/
 *   - temp-exe      exe 本身就在临时目录里（例如直接在压缩包预览里双击），数据放用户数据目录
 *   - installed     安装版（%LOCALAPPDATA%\Programs 或 Program Files），数据放安装目录 data/
 */
import path from 'node:path';

function norm(p) {
  const abs = path.resolve(String(p));
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

/** 两个路径是否指向同一位置（Windows 大小写不敏感、忽略尾部分隔符） */
export function samePath(a, b) {
  if (!a || !b) return false;
  return norm(a) === norm(b);
}

/** dir 是否等于某个临时目录根，或落在它下面。tmpRoots 由调用方给（os.tmpdir()/TEMP/TMP），保证纯函数可测。 */
export function isTempDir(dir, tmpRoots = []) {
  if (!dir) return false;
  const d = norm(dir);
  for (const root of tmpRoots) {
    if (!root) continue;
    const r = norm(root);
    if (d === r || d.startsWith(r.endsWith(path.sep) ? r : r + path.sep)) return true;
  }
  return false;
}

/** dir 是否落在「安装目录」根下（安装版判断，Portable 交付已经不再产出安装包，留着做兜底判断） */
export function isInstalledDir(dir, installRoots = []) {
  return isTempDir(dir, installRoots);
}

/**
 * 算出运行形态、数据目录候选与「开机自启/重启该拉起哪个 exe」。
 * @param {object} o
 * @param {boolean} o.packaged       app.isPackaged
 * @param {string}  o.appRoot        app.getAppPath()
 * @param {string}  o.exeDir         path.dirname(process.execPath)
 * @param {string}  o.exePath        process.execPath
 * @param {string}  o.appDataDir     app.getPath('appData') 的兜底值
 * @param {string} [o.envData]       process.env.ZHS_DATA
 * @param {string} [o.portableDir]   process.env.PORTABLE_EXECUTABLE_DIR
 * @param {string} [o.portableFile]  process.env.PORTABLE_EXECUTABLE_FILE
 * @param {string[]} [o.tmpRoots]    临时目录根列表
 * @param {string[]} [o.installRoots] 安装目录根列表
 * @param {string} [o.productName]   用户数据目录名，默认 ZhihuishuAuto
 */
export function planRuntime(o) {
  const {
    packaged,
    appRoot,
    exeDir,
    exePath,
    appDataDir,
    envData,
    portableDir,
    portableFile,
    tmpRoots = [],
    installRoots = [],
    productName = 'ZhihuishuAuto',
  } = o;

  const pDir = portableDir ? path.resolve(String(portableDir)) : '';
  const pFile = portableFile ? path.resolve(String(portableFile)) : '';
  const portableHome = pDir || (pFile ? path.dirname(pFile) : '');
  const exeInTemp = isTempDir(exeDir, tmpRoots);

  let mode = 'portable-dir';
  if (!packaged) mode = 'dev';
  else if (portableHome) mode = 'portable-file';
  else if (exeInTemp) mode = 'temp-exe';
  else if (isInstalledDir(exeDir, installRoots)) mode = 'installed';

  // 开机自启 / 重启要拉起的 exe：单文件免安装版必须用原始 exe，不能用 %TEMP% 里的 process.execPath
  let launchExe = exePath;
  if (mode === 'portable-file') launchExe = pFile || path.join(portableHome, productName + '.exe');

  const appDataData = path.join(appDataDir, productName, 'data');
  const list = [];
  const push = (dir, why) => {
    if (!dir) return;
    const abs = path.resolve(String(dir));
    if (list.some((x) => samePath(x.dir, abs))) return;
    list.push({ dir: abs, why });
  };

  if (envData) push(envData, 'ZHS_DATA 环境变量指定的位置');
  if (mode === 'dev') {
    push(path.join(appRoot, 'data'), '仓库里的 data/（开发模式）');
    push(appDataData, '用户数据目录（仓库不可写时兜底）');
  } else if (mode === 'portable-file') {
    push(path.join(portableHome, 'data'), '程序所在目录的 data/（单文件免安装版，内容不会随临时目录被删）');
    push(appDataData, '用户数据目录（程序所在目录不可写时兜底）');
  } else if (mode === 'temp-exe') {
    // 程序本身在临时目录里，data 绝不能跟着放进去；直接落到用户数据目录
    push(appDataData, '用户数据目录（程序在临时目录里运行，数据不能放临时目录）');
  } else if (mode === 'installed') {
    push(path.join(exeDir, 'data'), '安装目录的 data/');
    push(appDataData, '用户数据目录（安装目录不可写时兜底）');
  } else {
    push(path.join(exeDir, 'data'), '程序所在目录的 data/（解压即用）');
    push(appDataData, '用户数据目录（程序所在目录不可写时兜底）');
  }

  return {
    mode,
    isPortable: packaged && mode !== 'installed',
    launchExe,
    portableDir: portableHome,
    portableFile: pFile,
    exeInTemp,
    tempRoot: exeInTemp ? String(tmpRoots.find((r) => isTempDir(exeDir, [r])) || '') : '',
    dataCandidates: list,
    fallbackDataDir: appDataData,
  };
}

/** 运行形态的中文名，用于日志/导出信息/错误提示 */
export function modeLabel(mode) {
  switch (mode) {
    case 'dev':
      return '开发版';
    case 'portable-file':
      return '免安装（单文件）';
    case 'portable-dir':
      return '免安装（解压即用）';
    case 'temp-exe':
      return '临时目录运行';
    case 'installed':
      return '安装版';
    default:
      return '未知形态';
  }
}
