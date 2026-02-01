import { app, BrowserWindow, ipcMain } from 'electron';
import { Menu, Tray, nativeImage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

const isDev = !app.isPackaged;

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function createWindow(): void {
  const aspectRatio = 985.766 / 554.493;
  const baseWidth = 986;
  const baseHeight = 554;

  mainWindow = new BrowserWindow({
    width: baseWidth,
    height: baseHeight,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.setAspectRatio(aspectRatio);
  mainWindow.setBounds({ width: baseWidth, height: baseHeight });
  mainWindow.setMinimumSize(380, Math.round(380 / aspectRatio));
  mainWindow.setMaximumSize(1600, Math.round(1600 / aspectRatio));

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow?.hide();
  });

  ipcMain.removeHandler('window:get-bounds');
  ipcMain.removeHandler('window:set-bounds');
  ipcMain.removeHandler('window:minimize');
  ipcMain.removeHandler('window:close');
  ipcMain.handle('window:get-bounds', () => mainWindow?.getBounds());
  ipcMain.handle('window:set-bounds', (_event, bounds) => {
    if (!mainWindow) return false;
    if (!bounds || typeof bounds !== 'object') return false;
    const nextBounds = {
      x: Math.round(Number(bounds.x)),
      y: Math.round(Number(bounds.y)),
      width: Math.round(Number(bounds.width)),
      height: Math.round(Number(bounds.height)),
    };
    if (
      !Number.isFinite(nextBounds.x) ||
      !Number.isFinite(nextBounds.y) ||
      !Number.isFinite(nextBounds.width) ||
      !Number.isFinite(nextBounds.height)
    ) {
      console.error('[window:set-bounds] invalid bounds', bounds);
      return false;
    }
    if (nextBounds.width < 1 || nextBounds.height < 1) {
      console.error('[window:set-bounds] non-positive bounds', nextBounds);
      return false;
    }
    mainWindow.setBounds(nextBounds);
    return true;
  });
  ipcMain.handle('window:minimize', () => {
    if (!mainWindow) return false;
    mainWindow.minimize();
    return true;
  });
  ipcMain.handle('window:close', () => {
    if (!mainWindow) return false;
    mainWindow.close();
    return true;
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer] process gone', details);
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.error('[renderer] unresponsive');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function resolveTrayIconPath(): string | null {
  const candidates = [
    path.join(app.getAppPath(), 'src', 'renderer', 'assets', 'figma', 'logo.png'),
    path.join(app.getAppPath(), 'dist', 'renderer', 'assets', 'figma', 'logo.png'),
    path.join(__dirname, '../renderer/assets/figma/logo.png'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function createTray(): void {
  if (tray) return;
  const iconPath = resolveTrayIconPath();
  const trayIcon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(trayIcon);
  tray.setToolTip('FlowMate');

  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.focus();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '退出应用',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
    mainWindow?.show();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

export { mainWindow };
