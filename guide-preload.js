const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('guide', {
  onModel: (fn) => ipcRenderer.on('guide', (_e, m) => fn(m)),
});
