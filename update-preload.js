const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('upd', {
  onModel: (fn) => ipcRenderer.on('update', (_e, m) => fn(m)),
  act: (action, arg) => ipcRenderer.send('update-ui', action, arg),
});
