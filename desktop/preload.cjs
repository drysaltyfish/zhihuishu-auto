/** 只暴露桌面能力，不碰 Node；页面里用 window.desktop?.xxx 判空 */
const { contextBridge, ipcRenderer } = require('electron');

function readVersion() {
  const arg = process.argv.find((a) => a.startsWith('--zhs-version='));
  return arg ? arg.split('=').slice(1).join('=') : '';
}

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  version: readVersion(),
  openDataDir: () => ipcRenderer.invoke('desktop:openDataDir'),
  openPath: (p) => ipcRenderer.invoke('desktop:openPath', p),
  exportLogs: () => ipcRenderer.invoke('desktop:exportLogs'),
  checkUpdate: () => ipcRenderer.invoke('desktop:checkUpdate'),
  installUpdate: () => ipcRenderer.invoke('desktop:installUpdate'),
  restartApp: () => ipcRenderer.invoke('desktop:restartApp'),
  quitApp: () => ipcRenderer.invoke('desktop:quitApp'),
  retryServer: () => ipcRenderer.invoke('desktop:retryServer'),
  getAutoStart: () => ipcRenderer.invoke('desktop:getAutoStart'),
  setAutoStart: (v) => ipcRenderer.invoke('desktop:setAutoStart', v),
});
