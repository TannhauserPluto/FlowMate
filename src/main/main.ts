import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { setupIPC } from './ipc';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let pythonProcess: ChildProcess | null = null;

// 开发模式检测：检查是否有 Vite 服务运行或通过环境变量判断
const isDev = !app.isPackaged;

/**
 * 创建主窗口
 */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 600,
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

  // 加载应用
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // 窗口关闭时最小化到托盘
  mainWindow.on('close', (event) => {
    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * 创建系统托盘
 */
function createTray(): void {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => mainWindow?.show(),
    },
    {
      label: '开始专注',
      click: () => mainWindow?.webContents.send('start-focus'),
    },
    {
      label: '休息一下',
      click: () => mainWindow?.webContents.send('take-break'),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        mainWindow?.destroy();
        app.quit();
      },
    },
  ]);

  tray.setToolTip('FlowMate-Echo');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    mainWindow?.show();
  });
}

/**
 * 启动 Python 后端服务
 */
function startPythonBackend(): void {
  const pythonPath = 'python';
  const scriptPath = path.join(__dirname, '../../backend/main.py');

  pythonProcess = spawn(pythonPath, ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8000'], {
    cwd: path.join(__dirname, '../../backend'),
    stdio: 'pipe',
  });

  pythonProcess.stdout?.on('data', (data) => {
    console.log(`[Python Backend] ${data}`);
  });

  pythonProcess.stderr?.on('data', (data) => {
    console.error(`[Python Backend Error] ${data}`);
  });

  pythonProcess.on('close', (code) => {
    console.log(`Python backend exited with code ${code}`);
  });
}

/**
 * 停止 Python 后端服务
 */
function stopPythonBackend(): void {
  if (pythonProcess) {
    pythonProcess.kill();
    pythonProcess = null;
  }
}

// 应用就绪
app.whenReady().then(() => {
  createWindow();
  createTray();
  startPythonBackend();
  setupIPC(mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 所有窗口关闭
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopPythonBackend();
    app.quit();
  }
});

// 应用退出前
app.on('before-quit', () => {
  stopPythonBackend();
});

export { mainWindow };
