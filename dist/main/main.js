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
const electron_2 = require("electron");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
let mainWindow = null;
exports.mainWindow = mainWindow;
let tray = null;
let isQuitting = false;
const isDev = !electron_1.app.isPackaged;
function createWindow() {
    const aspectRatio = 985.766 / 554.493;
    const baseWidth = 986;
    const baseHeight = 554;
    exports.mainWindow = mainWindow = new electron_1.BrowserWindow({
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
        if (isQuitting)
            return;
        event.preventDefault();
        mainWindow?.hide();
    });
    electron_1.ipcMain.removeHandler('window:get-bounds');
    electron_1.ipcMain.removeHandler('window:set-bounds');
    electron_1.ipcMain.removeHandler('window:minimize');
    electron_1.ipcMain.removeHandler('window:close');
    electron_1.ipcMain.handle('window:get-bounds', () => mainWindow?.getBounds());
    electron_1.ipcMain.handle('window:set-bounds', (_event, bounds) => {
        if (!mainWindow)
            return false;
        if (!bounds || typeof bounds !== 'object')
            return false;
        const nextBounds = {
            x: Math.round(Number(bounds.x)),
            y: Math.round(Number(bounds.y)),
            width: Math.round(Number(bounds.width)),
            height: Math.round(Number(bounds.height)),
        };
        if (!Number.isFinite(nextBounds.x) ||
            !Number.isFinite(nextBounds.y) ||
            !Number.isFinite(nextBounds.width) ||
            !Number.isFinite(nextBounds.height)) {
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
    electron_1.ipcMain.handle('window:minimize', () => {
        if (!mainWindow)
            return false;
        mainWindow.minimize();
        return true;
    });
    electron_1.ipcMain.handle('window:close', () => {
        if (!mainWindow)
            return false;
        mainWindow.close();
        return true;
    });
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
    else {
        mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    }
    mainWindow.on('closed', () => {
        exports.mainWindow = mainWindow = null;
    });
}
function resolveTrayIconPath() {
    const candidates = [
        path.join(electron_1.app.getAppPath(), 'src', 'renderer', 'assets', 'figma', 'logo.png'),
        path.join(electron_1.app.getAppPath(), 'dist', 'renderer', 'assets', 'figma', 'logo.png'),
        path.join(__dirname, '../renderer/assets/figma/logo.png'),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate))
            return candidate;
    }
    return null;
}
function createTray() {
    if (tray)
        return;
    const iconPath = resolveTrayIconPath();
    const trayIcon = iconPath ? electron_2.nativeImage.createFromPath(iconPath) : electron_2.nativeImage.createEmpty();
    tray = new electron_2.Tray(trayIcon);
    tray.setToolTip('FlowMate');
    tray.on('click', () => {
        if (!mainWindow)
            return;
        if (mainWindow.isVisible()) {
            mainWindow.focus();
        }
        else {
            mainWindow.show();
            mainWindow.focus();
        }
    });
    const contextMenu = electron_2.Menu.buildFromTemplate([
        {
            label: '退出应用',
            click: () => {
                isQuitting = true;
                electron_1.app.quit();
            },
        },
    ]);
    tray.setContextMenu(contextMenu);
}
electron_1.app.whenReady().then(() => {
    createWindow();
    createTray();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
        mainWindow?.show();
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && isQuitting) {
        electron_1.app.quit();
    }
});
electron_1.app.on('before-quit', () => {
    isQuitting = true;
});
