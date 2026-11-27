// The toast window's bridge (toast-ui.js): its feed in, its height / empty / hover out.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('toastHost', {
  onFeed: (fn) => ipcRenderer.on('toast-feed', (_e, data) => fn(data)),
  send: (action, arg) => ipcRenderer.send('toastui', action, arg),
});
