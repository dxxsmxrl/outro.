const { app, BrowserWindow, ipcMain, session, desktopCapturer, screen } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    titleBarStyle: 'hiddenInset',
    frame: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
      webSecurity: true,
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Spoof geolocation to Los Angeles for dxxsmxrl
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'geolocation') {
      callback(true);
    } else {
      callback(true);
    }
  });

  // Intercept geolocation — force LA coords
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(`
      // Override geolocation to Los Angeles
      const _getCurrentPosition = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
      const _watchPosition = navigator.geolocation.watchPosition.bind(navigator.geolocation);
      
      const LA_POS = {
        coords: {
          latitude: 34.0522,
          longitude: -118.2437,
          accuracy: 20,
          altitude: 71,
          altitudeAccuracy: 10,
          heading: null,
          speed: null
        },
        timestamp: Date.now()
      };

      navigator.geolocation.getCurrentPosition = (success, error, options) => success(LA_POS);
      navigator.geolocation.watchPosition = (success, error, options) => { success(LA_POS); return 0; };
    `);
  });
}

app.whenReady().then(() => {
  // Set locale to en-US
  app.commandLine.appendSwitch('lang', 'en-US');
  
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC: get screen sources for screen share
ipcMain.handle('get-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 300, height: 200 }
  });
  return sources.map(s => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL(),
  }));
});

// IPC: window controls
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow.close());

// Webview geolocation spoof + URL sync
app.on('web-contents-created', (event, contents) => {
  if (contents.getType() === 'webview') {
    contents.on('did-finish-load', () => {
      contents.executeJavaScript(`
        const LA_POS = { coords: { latitude: 34.0522, longitude: -118.2437, accuracy: 20, altitude: 71, altitudeAccuracy: 10, heading: null, speed: null }, timestamp: Date.now() };
        navigator.geolocation.getCurrentPosition = (ok) => ok(LA_POS);
        navigator.geolocation.watchPosition = (ok) => { ok(LA_POS); return 0; };
      `).catch(() => {});
    });
    contents.on('did-navigate', (e, url) => {
      if (mainWindow) mainWindow.webContents.send('webview-navigated', url);
    });
    contents.on('did-navigate-in-page', (e, url) => {
      if (mainWindow) mainWindow.webContents.send('webview-navigated', url);
    });
  }
});

ipcMain.on('window-navigate-webview', (event, url) => {
  if (mainWindow) mainWindow.webContents.send('do-navigate-webview', url);
});
