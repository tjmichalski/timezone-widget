const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  storeGet: (key) => ipcRenderer.invoke('store:get', key),
  storeSet: (key, value) => ipcRenderer.invoke('store:set', key, value),
  closeApp: () => ipcRenderer.invoke('window:close'),
  minimizeApp: () => ipcRenderer.invoke('window:minimize'),
  hideApp: () => ipcRenderer.invoke('window:hide'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('window:toggleAlwaysOnTop'),
});
