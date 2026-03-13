import { contextBridge, ipcRenderer, desktopCapturer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  invoke: (channel: string, ...args: any[]) => {
    const validChannels = [
      'window:get-bounds',
      'window:set-bounds',
      'window:minimize',
      'window:close',
      'mini-window:get-bounds',
      'mini-window:set-bounds',
      'screen:capture',
    ];
    if (validChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    return Promise.reject(new Error(`Invalid channel: ${channel}`));
  },
  on: (channel: string, listener: (...args: any[]) => void) => {
    const validChannels = ['focus:shortcut'];
    if (!validChannels.includes(channel)) {
      throw new Error(`Invalid channel: ${channel}`);
    }
    const wrapped = (_event: Electron.IpcRendererEvent, ...args: any[]) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  getDesktopSourceId: async () => {
    if (!desktopCapturer?.getSources) return null;
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 },
    });
    return sources[0]?.id ?? null;
  },
});
