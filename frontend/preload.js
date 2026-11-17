const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  get: (url) => ipcRenderer.invoke('api', { method: 'GET', url }),
  post: (url, body) => ipcRenderer.invoke('api', { method: 'POST', url, body }),
  put: (url, body) => ipcRenderer.invoke('api', { method: 'PUT', url, body }),
});
