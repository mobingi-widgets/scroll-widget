const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widget', {
  onFeed: (fn) => ipcRenderer.on('feed', (_e, data) => fn(data)),
  cmd: (obj) => ipcRenderer.send('cmd', obj),
  ui: (action, arg) => ipcRenderer.send('ui', action, arg),
  tip: (action, arg) => ipcRenderer.send('tipui', action, arg),
});
