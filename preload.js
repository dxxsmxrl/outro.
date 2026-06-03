const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getSources: () => ipcRenderer.invoke('get-sources'),
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  navigateWebview: (url) => ipcRenderer.send('window-navigate-webview', url),
  onWebviewNavigated: (cb) => ipcRenderer.on('webview-navigated', (e, url) => cb(url)),
  onDoNavigateWebview: (cb) => ipcRenderer.on('do-navigate-webview', (e, url) => cb(url)),
});
