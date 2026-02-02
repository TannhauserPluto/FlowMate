"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electron', {
    invoke: (channel, ...args) => {
        const validChannels = [
            'window:get-bounds',
            'window:set-bounds',
            'window:minimize',
            'window:close',
            'screen:capture',
        ];
        if (validChannels.includes(channel)) {
            return electron_1.ipcRenderer.invoke(channel, ...args);
        }
        return Promise.reject(new Error(`Invalid channel: ${channel}`));
    },
    on: (channel, listener) => {
        const validChannels = ['focus:shortcut'];
        if (!validChannels.includes(channel)) {
            throw new Error(`Invalid channel: ${channel}`);
        }
        const wrapped = (_event, ...args) => listener(...args);
        electron_1.ipcRenderer.on(channel, wrapped);
        return () => electron_1.ipcRenderer.removeListener(channel, wrapped);
    },
    getDesktopSourceId: async () => {
        if (!electron_1.desktopCapturer?.getSources)
            return null;
        const sources = await electron_1.desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 0, height: 0 },
        });
        return sources[0]?.id ?? null;
    },
});
