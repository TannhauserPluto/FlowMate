import { contextBridge, ipcRenderer } from 'electron';

// 暴露安全的 API 给渲染进程
contextBridge.exposeInMainWorld('electron', {
  // IPC 调用
  invoke: (channel: string, ...args: any[]) => {
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
      return ipcRenderer.invoke(channel, ...args);
    }
    return Promise.reject(new Error(`Invalid channel: ${channel}`));
  },

  // 监听事件
  on: (channel: string, callback: (...args: any[]) => void) => {
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
      ipcRenderer.on(channel, (_, ...args) => callback(...args));
    }
  },

  // 移除监听器
  removeListener: (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.removeListener(channel, callback);
  },
});
