"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.mainWindow = void 0;
const electron_1 = require("electron");
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const ipc_1 = require("./ipc");
let mainWindow = null;
exports.mainWindow = mainWindow;
let tray = null;
let pythonProcess = null;
// 开发模式检测：检查是否有 Vite 服务运行或通过环境变量判断
const isDev = !electron_1.app.isPackaged;
/**
 * 创建主窗口
 */
function createWindow() {
    exports.mainWindow = mainWindow = new electron_1.BrowserWindow({
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
    }
    else {
        mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    }
    // 窗口关闭时最小化到托盘
    mainWindow.on('close', (event) => {
        event.preventDefault();
        mainWindow?.hide();
    });
    mainWindow.on('closed', () => {
        exports.mainWindow = mainWindow = null;
    });
}
/**
 * 创建系统托盘
 */
function createTray() {
    const icon = electron_1.nativeImage.createEmpty();
    tray = new electron_1.Tray(icon);
    const contextMenu = electron_1.Menu.buildFromTemplate([
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
                electron_1.app.quit();
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
function startPythonBackend() {
    const pythonPath = 'python';
    const scriptPath = path.join(__dirname, '../../backend/main.py');
    pythonProcess = (0, child_process_1.spawn)(pythonPath, ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8000'], {
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
function stopPythonBackend() {
    if (pythonProcess) {
        pythonProcess.kill();
        pythonProcess = null;
    }
}
// 应用就绪
electron_1.app.whenReady().then(() => {
    createWindow();
    createTray();
    startPythonBackend();
    (0, ipc_1.setupIPC)(mainWindow);
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
// 所有窗口关闭
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        stopPythonBackend();
        electron_1.app.quit();
    }
});
// 应用退出前
electron_1.app.on('before-quit', () => {
    stopPythonBackend();
});
