/** 托盘：关闭窗口不退出，从托盘再打开；菜单里可开机自启、退出 */
import { Tray, Menu, nativeImage } from './electron-api.mjs';
import fs from 'node:fs';

export function createTray({ iconPath, log, onOpen, onQuit, getAutoStart, setAutoStart }) {
  let image;
  try {
    image = nativeImage.createFromPath(iconPath);
  } catch {
    image = nativeImage.createEmpty();
  }
  const tray = new Tray(image);
  tray.setToolTip('智慧树自动听课');

  function rebuild() {
    const autostart = !!getAutoStart();
    const menu = Menu.buildFromTemplate([
      { label: '打开界面', click: onOpen },
      { type: 'separator' },
      {
        label: '开机自动启动',
        type: 'checkbox',
        checked: autostart,
        click: (item) => {
          setAutoStart(item.checked);
          rebuild();
        },
      },
      { type: 'separator' },
      { label: '退出', click: onQuit },
    ]);
    tray.setContextMenu(menu);
  }
  rebuild();
  tray.on('click', onOpen);
  tray.on('double-click', onOpen);
  return { tray, rebuild };
}

export function trayIconPath(assetsDir) {
  const ico = assetsDir + '/tray.ico';
  const png = assetsDir + '/tray.png';
  return fs.existsSync(ico) ? ico : png;
}
