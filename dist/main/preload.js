"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// 暴露安全的 API 给渲染进程
electron_1.contextBridge.exposeInMainWorld('electron', {
    // IPC 调用
    invoke: (channel, ...args) => {
        const validChannels = [
            'window:minimize',
            'window:close',
            'window:toggle-always-on-top',
            'capture:screenshot',
            'keyboard:start-monitor',
            'keyboard:stop-monitor',
            'keyboard:simulate-keypress',
            'keyboard:get-wpm',
            'mouse:simulate-move',
        ];
        if (validChannels.includes(channel)) {
            return electron_1.ipcRenderer.invoke(channel, ...args);
        }
        return Promise.reject(new Error(`Invalid channel: ${channel}`));
    },
    // 监听事件
    on: (channel, callback) => {
        const validChannels = [
            'keyboard:activity',
            'shortcut:toggle-focus',
            'shortcut:toggle-break',
            'demo:jump-to-end',
            'demo:simulate-typing',
            'demo:trigger-idle',
            'demo:trigger-shhh',
            'start-focus',
            'take-break',
        ];
        if (validChannels.includes(channel)) {
            electron_1.ipcRenderer.on(channel, (_, ...args) => callback(...args));
        }
    },
    // 移除监听器
    removeListener: (channel, callback) => {
        electron_1.ipcRenderer.removeListener(channel, callback);
    },
});
