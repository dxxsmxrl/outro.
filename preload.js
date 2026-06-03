const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Existing
  getSources: () => ipcRenderer.invoke('get-sources'),
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  navigateWebview: (url) => ipcRenderer.send('window-navigate-webview', url),
  onWebviewNavigated: (cb) => ipcRenderer.on('webview-navigated', (e, url) => cb(url)),
  onDoNavigateWebview: (cb) => ipcRenderer.on('do-navigate-webview', (e, url) => cb(url)),

  // New: open file with system app
  openFile: (opts) => ipcRenderer.invoke('open-file', opts),
  // New: save file via dialog
  saveFile: (opts) => ipcRenderer.invoke('save-file', opts),
  // Mute/unmute webview by partition
  mutePartition: (partition, muted) => ipcRenderer.send('mute-partition', { partition, muted }),
});