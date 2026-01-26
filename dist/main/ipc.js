"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupIPC = setupIPC;
exports.sendPerceptionData = sendPerceptionData;
exports.sendAIResponse = sendAIResponse;
const electron_1 = require("electron");
// 键盘活动追踪
let keyboardActivityInterval = null;
let keyPressHistory = []; // 存储最近的按键时间戳
let totalKeyCount = 0;
let lastMouseMoveTime = Date.now();
// WPM 计算窗口 (10秒)
const WPM_WINDOW_MS = 10000;
// 心流豁免阈值 (字符/分钟)
const FLOW_IMMUNITY_THRESHOLD = 40;
/**
 * 设置 IPC 通信处理
 */
function setupIPC(mainWindow) {
    // 窗口控制
    electron_1.ipcMain.handle('window:minimize', () => {
        mainWindow?.minimize();
    });
    electron_1.ipcMain.handle('window:close', () => {
        mainWindow?.hide();
    });
    electron_1.ipcMain.handle('window:toggle-always-on-top', (_, value) => {
        mainWindow?.setAlwaysOnTop(value);
    });
    // 截屏功能 (用于 AI 分析)
    electron_1.ipcMain.handle('capture:screenshot', async () => {
        try {
            const sources = await electron_1.desktopCapturer.getSources({
                types: ['screen'],
                thumbnailSize: { width: 1920, height: 1080 },
            });
            if (sources.length > 0) {
                const screenshot = sources[0].thumbnail.toDataURL();
                return screenshot;
            }
            return null;
        }
        catch (error) {
            console.error('Screenshot capture failed:', error);
            return null;
        }
    });
    // 键盘活动监听
    electron_1.ipcMain.handle('keyboard:start-monitor', () => {
        if (keyboardActivityInterval)
            return true;
        keyboardActivityInterval = setInterval(() => {
            const now = Date.now();
            // 清理过期的按键记录
            keyPressHistory = keyPressHistory.filter(t => now - t < WPM_WINDOW_MS);
            // 计算 WPM (假设平均每个词 5 个字符)
            const charsPerMinute = (keyPressHistory.length / WPM_WINDOW_MS) * 60000;
            const wpm = Math.round(charsPerMinute / 5);
            // 判断是否活跃
            const isActive = keyPressHistory.length > 0 && (now - keyPressHistory[keyPressHistory.length - 1]) < 3000;
            // 鼠标空闲时间
            const mouseIdleTime = now - lastMouseMoveTime;
            mainWindow?.webContents.send('keyboard:activity', {
                isActive,
                keyCount: totalKeyCount,
                wpm,
                charsPerMinute: Math.round(charsPerMinute),
                mouseIdleTime,
                recentKeyCount: keyPressHistory.length,
            });
        }, 1000);
        return true;
    });
    electron_1.ipcMain.handle('keyboard:stop-monitor', () => {
        if (keyboardActivityInterval) {
            clearInterval(keyboardActivityInterval);
            keyboardActivityInterval = null;
        }
        return true;
    });
    // 模拟按键事件 (前端调用)
    electron_1.ipcMain.handle('keyboard:simulate-keypress', () => {
        const now = Date.now();
        keyPressHistory.push(now);
        totalKeyCount++;
        return true;
    });
    // 模拟鼠标移动 (前端调用)
    electron_1.ipcMain.handle('mouse:simulate-move', () => {
        lastMouseMoveTime = Date.now();
        return true;
    });
    // 获取当前 WPM
    electron_1.ipcMain.handle('keyboard:get-wpm', () => {
        const now = Date.now();
        keyPressHistory = keyPressHistory.filter(t => now - t < WPM_WINDOW_MS);
        const charsPerMinute = (keyPressHistory.length / WPM_WINDOW_MS) * 60000;
        return {
            wpm: Math.round(charsPerMinute / 5),
            charsPerMinute: Math.round(charsPerMinute),
            isInFlow: charsPerMinute >= FLOW_IMMUNITY_THRESHOLD,
        };
    });
    // 注册全局快捷键
    registerGlobalShortcuts(mainWindow);
}
/**
 * 注册全局快捷键
 */
function registerGlobalShortcuts(mainWindow) {
    // Ctrl+Shift+F: 快速启动/暂停专注
    electron_1.globalShortcut.register('CommandOrControl+Shift+F', () => {
        mainWindow?.webContents.send('shortcut:toggle-focus');
    });
    // Ctrl+Shift+B: 切换休息模式
    electron_1.globalShortcut.register('CommandOrControl+Shift+B', () => {
        mainWindow?.webContents.send('shortcut:toggle-break');
    });
    // ===== 演示用快捷键 (Demo Shortcuts) =====
    // Ctrl+Shift+1: 倒计时跳到 3 秒 (演示心流豁免)
    electron_1.globalShortcut.register('CommandOrControl+Shift+1', () => {
        mainWindow?.webContents.send('demo:jump-to-end');
    });
    // Ctrl+Shift+2: 模拟高速打字 (触发心流豁免)
    electron_1.globalShortcut.register('CommandOrControl+Shift+2', () => {
        // 模拟 100 次按键
        const now = Date.now();
        for (let i = 0; i < 100; i++) {
            keyPressHistory.push(now - i * 50);
        }
        totalKeyCount += 100;
        mainWindow?.webContents.send('demo:simulate-typing');
    });
    // Ctrl+Shift+3: 触发发呆检测
    electron_1.globalShortcut.register('CommandOrControl+Shift+3', () => {
        lastMouseMoveTime = Date.now() - 10000; // 模拟 10 秒无活动
        keyPressHistory = [];
        mainWindow?.webContents.send('demo:trigger-idle');
    });
    // Ctrl+Shift+4: 触发心流豁免动画
    electron_1.globalShortcut.register('CommandOrControl+Shift+4', () => {
        mainWindow?.webContents.send('demo:trigger-shhh');
    });
    // Esc: 最小化到托盘
    electron_1.globalShortcut.register('Escape', () => {
        if (mainWindow?.isFocused()) {
            mainWindow.hide();
        }
    });
}
/**
 * 发送感知数据到渲染进程
 */
function sendPerceptionData(mainWindow, data) {
    mainWindow?.webContents.send('perception:data', data);
}
/**
 * 发送 AI 响应到渲染进程
 */
function sendAIResponse(mainWindow, response) {
    mainWindow?.webContents.send('ai:response', response);
}
