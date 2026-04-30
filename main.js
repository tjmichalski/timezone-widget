const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const Store = require('electron-store');

const store = new Store();

let mainWindow;
let tray;

function createWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;

  const savedPos  = store.get('windowPosition');
  const savedSize = store.get('windowSize');

  mainWindow = new BrowserWindow({
    width:  savedSize ? savedSize.w : 400,
    height: savedSize ? savedSize.h : 640,
    minWidth:  320,
    minHeight: 400,
    x: savedPos ? savedPos.x : width - 420,
    y: savedPos ? savedPos.y : 60,
    frame: false,
    transparent: true,
    alwaysOnTop: store.get('alwaysOnTop', true),
    resizable: true,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('moved', () => {
    const [x, y] = mainWindow.getPosition();
    store.set('windowPosition', { x, y });
  });

  mainWindow.on('resize', () => {
    const [w, h] = mainWindow.getSize();
    store.set('windowSize', { w, h });
  });
}

function createTray() {
  try {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  } catch (_) {
    tray = new Tray(nativeImage.createEmpty());
  }
  tray.setToolTip('World Clock Widget');
  const menu = Menu.buildFromTemplate([
    { label: 'Show',  click: () => mainWindow?.show() },
    { label: 'Hide',  click: () => mainWindow?.hide() },
    { type: 'separator' },
    { label: 'Quit',  click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => {
    mainWindow?.isVisible() ? mainWindow.hide() : mainWindow?.show();
  });
}

app.whenReady().then(() => {
  createWindow();
  try { createTray(); } catch (_) { /* tray is optional */ }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('store:get',  (_, key)        => store.get(key));
ipcMain.handle('store:set',  (_, key, value) => store.set(key, value));
ipcMain.handle('window:close',    () => app.quit());
ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:hide',     () => mainWindow?.hide());
ipcMain.handle('window:toggleAlwaysOnTop', () => {
  const next = !mainWindow?.isAlwaysOnTop();
  mainWindow?.setAlwaysOnTop(next);
  store.set('alwaysOnTop', next);
  return next;
});
