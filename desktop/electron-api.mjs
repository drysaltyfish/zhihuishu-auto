/**
 * Electron 的 'electron' 模块是 CJS，不能直接 `import { app } from 'electron'`（Node ESM 静态分析不到命名导出），
 * 这里用 createRequire 取真身，再按需导出，其它桌面模块统一从本文件拿 API。
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electron = require('electron');

export const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, shell, dialog, screen } = electron;
export default electron;
