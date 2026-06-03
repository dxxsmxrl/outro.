const { app, BrowserWindow, ipcMain, session, desktopCapturer, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let mainWindow;

// ===== AD BLOCK =====
// Домены YouTube рекламы — блокируем запросы до создания окна
const AD_HOSTS = [
  '*://googleads.g.doubleclick.net/*',
  '*://ads.youtube.com/*',
  '*://www.googleadservices.com/*',
  '*://pagead2.googlesyndication.com/*',
  '*://tpc.googlesyndication.com/*',
  '*://partner.googleadservices.com/*',
  '*://adservice.google.com/*',
  '*://adservice.google.ru/*',
  '*://s0.2mdn.net/*',
  '*://ad.doubleclick.net/*',
  '*://imasdk.googleapis.com/*',      // YouTube IMA SDK — сам плеер рекламы
  '*://static.doubleclick.net/*',
  '*://survey.g.doubleclick.net/*',
];

function setupAdBlock(ses) {
  ses.webRequest.onBeforeRequest({ urls: AD_HOSTS }, (details, callback) => {
    callback({ cancel: true });
  });

  // Дополнительно — убираем рекламные заголовки
  ses.webRequest.onBeforeSendHeaders({ urls: ['*://*.youtube.com/*'] }, (details, callback) => {
    const headers = details.requestHeaders;
    delete headers['X-YouTube-Client-Name'];
    callback({ requestHeaders: headers });
  });
}

function createWindow() {
  // Настраиваем блокировку для всех сессий ДО создания окна
  setupAdBlock(session.defaultSession);

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

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(`
      const LA_POS = {
        coords: { latitude: 34.0522, longitude: -118.2437, accuracy: 20, altitude: 71, altitudeAccuracy: 10, heading: null, speed: null },
        timestamp: Date.now()
      };
      navigator.geolocation.getCurrentPosition = (success) => success(LA_POS);
      navigator.geolocation.watchPosition = (success) => { success(LA_POS); return 0; };
    `);
  });
}

app.whenReady().then(() => {
  app.commandLine.appendSwitch('lang', 'en-US');
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ===== SCREEN SHARE =====
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

// ===== WINDOW CONTROLS =====
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow.close());

// ===== OPEN FILE (фото/видео/файлы из чата) =====
// Принимает dataUrl или обычный URL, сохраняет во временный файл и открывает системным приложением
ipcMain.handle('open-file', async (event, { dataUrl, filename, url }) => {
  try {
    if (dataUrl) {
      // base64 → временный файл → shell.openPath
      const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
      if (!matches) return { error: 'Bad dataUrl' };
      const ext = matches[1].split('/')[1]?.split(';')[0] || 'bin';
      const name = filename || `outro_file_${Date.now()}.${ext}`;
      const tmpPath = path.join(os.tmpdir(), name);
      fs.writeFileSync(tmpPath, Buffer.from(matches[2], 'base64'));
      const err = await shell.openPath(tmpPath);
      return { ok: !err, error: err || null };
    } else if (url) {
      // Обычный URL — открываем в браузере
      await shell.openExternal(url);
      return { ok: true };
    }
    return { error: 'No file data' };
  } catch (e) {
    return { error: e.message };
  }
});

// ===== SAVE FILE =====
ipcMain.handle('save-file', async (event, { dataUrl, filename }) => {
  const { dialog } = require('electron');
  try {
    const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!matches) return { error: 'Bad dataUrl' };
    const ext = matches[1].split('/')[1]?.split(';')[0] || 'bin';
    const name = filename || `outro_file_${Date.now()}.${ext}`;
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: name,
      filters: [{ name: 'All Files', extensions: ['*'] }]
    });
    if (canceled || !filePath) return { ok: false };
    fs.writeFileSync(filePath, Buffer.from(matches[2], 'base64'));
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});

// ===== WEBVIEW: geolocation spoof + ad block для partition =====
app.on('web-contents-created', (event, contents) => {
  if (contents.getType() === 'webview') {
    // Блокируем рекламу и для webview сессий
    const wvSession = contents.session;
    if (wvSession && wvSession !== session.defaultSession) {
      setupAdBlock(wvSession);
    }

    contents.on('did-finish-load', () => {
      // Geolocation spoof
      contents.executeJavaScript(`
        const LA_POS = { coords: { latitude: 34.0522, longitude: -118.2437, accuracy: 20, altitude: 71, altitudeAccuracy: 10, heading: null, speed: null }, timestamp: Date.now() };
        navigator.geolocation.getCurrentPosition = (ok) => ok(LA_POS);
        navigator.geolocation.watchPosition = (ok) => { ok(LA_POS); return 0; };
      `).catch(() => {});

      // Скрываем рекламные оверлеи YouTube через CSS — второй уровень защиты
      const ytAdCSS = `
        .ad-showing .html5-main-video { opacity: 1 !important; }
        .video-ads, .ytp-ad-module, .ytp-ad-overlay-container,
        .ytp-ad-text-overlay, .ytp-ad-skip-button-container,
        .ytp-ad-player-overlay, .ytp-ad-progress,
        .ytp-ad-progress-list, #player-ads, #masthead-ad,
        .ytd-banner-promo-renderer, ytd-statement-banner-renderer,
        ytd-ad-slot-renderer, #ad-container, .ytp-ce-element,
        .ytp-endscreen-element { display: none !important; }
      `;
      contents.executeJavaScript(`
        (function() {
          var s = document.createElement('style');
          s.textContent = ${JSON.stringify(ytAdCSS)};
          document.head.appendChild(s);
        })();
      `).catch(() => {});

      // Автоматически пропускаем рекламу если всё же прорвалась
      contents.executeJavaScript(`
        (function() {
          var skipAd = setInterval(function() {
            var skip = document.querySelector('.ytp-ad-skip-button, .ytp-skip-ad-button');
            if (skip) { skip.click(); }
            var adVid = document.querySelector('.ad-showing video');
            if (adVid) { adVid.currentTime = adVid.duration; }
          }, 300);
        })();
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
