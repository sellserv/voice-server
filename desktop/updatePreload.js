const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updateAPI', {
  onStatus: (callback) => ipcRenderer.on('update:status', (_e, text) => callback(text)),
  onProgress: (callback) => ipcRenderer.on('update:progress', (_e, percent) => callback(percent)),
});
