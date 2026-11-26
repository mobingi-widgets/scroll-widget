const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notice', {
  // true = agreed / closed, false = not agreed, 'rollback' = go back to the version kept aside
  answer: (a) => ipcRenderer.send('notice', a === 'rollback' ? 'rollback' : !!a),
});
