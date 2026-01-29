import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';

let mainWindow: BrowserWindow | null = null;

const isDev = !app.isPackaged;

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
  mainWindow.setMinimumSize(640, Math.round(640 / aspectRatio));
  mainWindow.setMaximumSize(1600, Math.round(1600 / aspectRatio));

  ipcMain.removeHandler('window:get-bounds');
  ipcMain.removeHandler('window:set-bounds');
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

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

export { mainWindow };
