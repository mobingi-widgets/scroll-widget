const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ctx', {
  onItems: (cb) => ipcRenderer.on('items', (_e, d) => cb(d)),
  height: (v) => ipcRenderer.send('h', v),
  pick: (id, opt) => ipcRenderer.send('pick', id, opt),
});
