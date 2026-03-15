const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  close: () => ipcRenderer.invoke('window:close'),

  // App info
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getPlatform: () => ipcRenderer.invoke('app:getPlatform'),

  // Settings store
  storeGet: (key) => ipcRenderer.invoke('store:get', key),
  storeSet: (key, value) => ipcRenderer.invoke('store:set', key, value),

  // Autostart
  isAutoStartEnabled: () => ipcRenderer.invoke('autostart:isEnabled'),
  setAutoStart: (enabled) => ipcRenderer.invoke('autostart:set', enabled),

  // Idle detection
  getIdleSeconds: () => ipcRenderer.invoke('system:getIdleSeconds'),

  // Notifications
  notify: (title, body) => ipcRenderer.invoke('notification:send', title, body),

  // Shell
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // Updater
  checkForUpdates: () => ipcRenderer.invoke('updater:checkForUpdates'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),

  // Global PTT
  configurePtt: (key) => ipcRenderer.invoke('ptt:configure', key),
  onPttDown: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('ptt:down', handler);
    return () => ipcRenderer.removeListener('ptt:down', handler);
  },
  onPttUp: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('ptt:up', handler);
    return () => ipcRenderer.removeListener('ptt:up', handler);
  },
});
