const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ctx', {
  onItems: (fn) => ipcRenderer.on('menu', (_e, items) => fn(items)),
  pick: (id, opt) => ipcRenderer.send('ctxmenu', 'pick', id, opt),
  height: (h) => ipcRenderer.send('ctxmenu', 'height', h),
});
