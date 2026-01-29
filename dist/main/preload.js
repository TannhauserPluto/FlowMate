"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electron', {
    invoke: (channel, ...args) => {
        const validChannels = ['window:get-bounds', 'window:set-bounds'];
        if (validChannels.includes(channel)) {
            return electron_1.ipcRenderer.invoke(channel, ...args);
        }
        return Promise.reject(new Error(`Invalid channel: ${channel}`));
    },
});
