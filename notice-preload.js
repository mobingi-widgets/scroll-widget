const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notice', {
  answer: (ok) => ipcRenderer.send('notice', !!ok),
});
