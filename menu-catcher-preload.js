// The menu's click catcher (ctxmenu.js): any press on it - left, right or middle - closes the
// menu. Told over IPC: a data: page cannot signal by navigating (Chromium refuses top-frame
// navigations to data: URLs, hash changes too - the 1.4.0 catcher never closed the menu).
const { ipcRenderer } = require('electron');

window.addEventListener('pointerdown', () => ipcRenderer.send('ctxmenu-catch'), true);
window.addEventListener('contextmenu', (e) => e.preventDefault(), true);
