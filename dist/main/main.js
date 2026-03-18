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
const electron_3 = require("electron");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
let mainWindow = null;
exports.mainWindow = mainWindow;
let miniWindow = null;
let tray = null;
let isQuitting = false;
const isDev = !electron_1.app.isPackaged;
const MINI_DESIGN_WIDTH = 266;
const MINI_DESIGN_HEIGHT = 286;
const MINI_ASPECT_RATIO = MINI_DESIGN_WIDTH / MINI_DESIGN_HEIGHT;
const MINI_MIN_WIDTH = 220;
const MINI_MAX_WIDTH = 520;
const MINI_MIN_HEIGHT = Math.round(MINI_MIN_WIDTH / MINI_ASPECT_RATIO);
const MINI_MAX_HEIGHT = Math.round(MINI_MAX_WIDTH / MINI_ASPECT_RATIO);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
electron_1.app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const hideAllWindows = () => {
    mainWindow?.hide();
    miniWindow?.hide();
};
const showAllWindows = () => {
    mainWindow?.show();
    mainWindow?.focus();
    miniWindow?.show();
    miniWindow?.focus();
};
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
            sandbox: false,
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
        hideAllWindows();
    });
    mainWindow.on('minimize', (event) => {
        event.preventDefault();
        hideAllWindows();
    });
    electron_1.ipcMain.removeHandler('window:get-bounds');
    electron_1.ipcMain.removeHandler('window:set-bounds');
    electron_1.ipcMain.removeHandler('window:minimize');
    electron_1.ipcMain.removeHandler('window:close');
    electron_1.ipcMain.removeHandler('mini-window:get-bounds');
    electron_1.ipcMain.removeHandler('mini-window:set-bounds');
    electron_1.ipcMain.handle('window:get-bounds', (event) => {
        const target = electron_1.BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
        return target?.getBounds();
    });
    electron_1.ipcMain.handle('window:set-bounds', (event, bounds) => {
        const target = electron_1.BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
        if (!target)
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
        target.setBounds(nextBounds);
        return true;
    });
    electron_1.ipcMain.handle('window:minimize', (event) => {
        const target = electron_1.BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
        if (!target)
            return false;
        hideAllWindows();
        return true;
    });
    electron_1.ipcMain.handle('window:close', (event) => {
        const target = electron_1.BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
        if (!target)
            return false;
        target.close();
        return true;
    });
    electron_1.ipcMain.handle('mini-window:get-bounds', () => miniWindow?.getBounds());
    electron_1.ipcMain.handle('mini-window:set-bounds', (_event, bounds) => {
        if (!miniWindow)
            return false;
        if (!bounds || typeof bounds !== 'object')
            return false;
        const currentBounds = miniWindow.getBounds();
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
            console.error('[mini-window:set-bounds] invalid bounds', bounds);
            return false;
        }
        const widthDelta = Math.abs(nextBounds.width - currentBounds.width);
        const heightDelta = Math.abs(nextBounds.height - currentBounds.height);
        if (Number.isFinite(nextBounds.width) && Number.isFinite(nextBounds.height)) {
            if (widthDelta >= heightDelta) {
                nextBounds.width = clamp(nextBounds.width, MINI_MIN_WIDTH, MINI_MAX_WIDTH);
                nextBounds.height = Math.round(nextBounds.width / MINI_ASPECT_RATIO);
            }
            else {
                nextBounds.height = clamp(nextBounds.height, MINI_MIN_HEIGHT, MINI_MAX_HEIGHT);
                nextBounds.width = Math.round(nextBounds.height * MINI_ASPECT_RATIO);
            }
        }
        if (nextBounds.width < 1 || nextBounds.height < 1) {
            console.error('[mini-window:set-bounds] non-positive bounds', nextBounds);
            return false;
        }
        miniWindow.setBounds(nextBounds);
        return true;
    });
    electron_1.ipcMain.handle('screen:capture', async () => {
        try {
            const display = electron_1.screen.getPrimaryDisplay();
            const { width, height } = display.size;
            const sources = await electron_1.desktopCapturer.getSources({
                types: ['screen'],
                thumbnailSize: { width, height },
            });
            const primaryId = display.id.toString();
            const source = sources.find((item) => item.display_id === primaryId) ?? sources[0];
            if (!source)
                return null;
            return source.thumbnail.toDataURL();
        }
        catch (error) {
            console.error('[screen:capture] failed', error);
            return null;
        }
    });
    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
    else {
        mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    }
    mainWindow.webContents.on('did-finish-load', () => {
        console.log('[renderer] did-finish-load', mainWindow?.webContents.getURL());
        mainWindow?.webContents.executeJavaScript('console.log(\"[renderer] alive\")');
    });
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
        console.error('[renderer] process gone', details);
    });
    mainWindow.webContents.on('unresponsive', () => {
        console.error('[renderer] unresponsive');
    });
    mainWindow.on('closed', () => {
        exports.mainWindow = mainWindow = null;
    });
}
function createMiniWindow() {
    if (miniWindow)
        return;
    const miniWidth = MINI_DESIGN_WIDTH;
    const miniHeight = MINI_DESIGN_HEIGHT;
    const miniMinWidth = MINI_MIN_WIDTH;
    const miniMinHeight = MINI_MIN_HEIGHT;
    const miniMaxWidth = MINI_MAX_WIDTH;
    const miniMaxHeight = MINI_MAX_HEIGHT;
    miniWindow = new electron_1.BrowserWindow({
        width: miniWidth,
        height: miniHeight,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            preload: path.join(__dirname, 'preload.js'),
        },
    });
    miniWindow.setAspectRatio(MINI_ASPECT_RATIO);
    const mainBounds = mainWindow?.getBounds();
    const display = mainBounds ? electron_1.screen.getDisplayMatching(mainBounds) : electron_1.screen.getPrimaryDisplay();
    const { x: displayX, y: displayY, width: displayWidth, height: displayHeight } = display.workArea;
    const baseX = mainBounds ? mainBounds.x + mainBounds.width - 200 : displayX - 200;
    const baseY = mainBounds ? mainBounds.y + 120 : displayY + 120;
    const clampedX = Math.min(Math.max(baseX, displayX), displayX + displayWidth - miniWidth);
    const clampedY = Math.min(Math.max(baseY, displayY), displayY + displayHeight - miniHeight);
    miniWindow.setBounds({ x: clampedX, y: clampedY, width: miniWidth, height: miniHeight });
    miniWindow.setMinimumSize(miniMinWidth, miniMinHeight);
    miniWindow.setMaximumSize(miniMaxWidth, miniMaxHeight);
    miniWindow.on('close', (event) => {
        if (isQuitting)
            return;
        event.preventDefault();
        hideAllWindows();
    });
    miniWindow.on('minimize', (event) => {
        event.preventDefault();
        hideAllWindows();
    });
    if (isDev) {
        miniWindow.loadURL('http://localhost:5173/?mini=1');
    }
    else {
        miniWindow.loadFile(path.join(__dirname, '../renderer/index.html'), { search: 'mini=1' });
    }
    miniWindow.on('closed', () => {
        miniWindow = null;
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
        if (!mainWindow && !miniWindow)
            return;
        const shouldShow = !mainWindow?.isVisible() || !miniWindow?.isVisible();
        if (shouldShow) {
            showAllWindows();
            return;
        }
        mainWindow?.focus();
        miniWindow?.focus();
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
    createMiniWindow();
    createTray();
    const okScreen = electron_3.globalShortcut.register('CommandOrControl+1', () => {
        if (!mainWindow)
            return;
        console.log('[globalShortcut] screen triggered');
        mainWindow.webContents.send('focus:shortcut', 'screen');
    });
    const okFatigue = electron_3.globalShortcut.register('CommandOrControl+2', () => {
        if (!mainWindow)
            return;
        console.log('[globalShortcut] fatigue triggered');
        mainWindow.webContents.send('focus:shortcut', 'fatigue');
    });
    const okFinal = electron_3.globalShortcut.register('CommandOrControl+3', () => {
        if (!mainWindow)
            return;
        console.log('[globalShortcut] final10 triggered');
        mainWindow.webContents.send('focus:shortcut', 'final10');
    });
    if (!okScreen || !okFatigue || !okFinal) {
        console.warn('[globalShortcut] register failed', {
            screen: okScreen,
            fatigue: okFatigue,
            final10: okFinal,
        });
    }
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
            createMiniWindow();
        }
        mainWindow?.show();
        miniWindow?.show();
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && isQuitting) {
        electron_1.app.quit();
    }
});
electron_1.app.on('before-quit', () => {
    isQuitting = true;
    electron_3.globalShortcut.unregisterAll();
});
