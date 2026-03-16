const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  Notification,
  shell,
  powerMonitor,
} = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const Store = require('electron-store');
const windowStateKeeper = require('electron-window-state');

const gameDetector = require('./gameDetector');

const isDev = !app.isPackaged;
const store = new Store({ name: 'settings' });

let mainWindow = null;
let tray = null;
let localServer = null;

// MIME types for local static server
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

// Start a local HTTP server to serve the built SvelteKit files
// This avoids file:// protocol issues with ES module dynamic imports
function startLocalServer(staticDir) {
  const resolvedBase = path.resolve(staticDir);
  // Cache index.html for SPA fallback to avoid re-reading on every 404
  let cachedIndex = null;
  try {
    cachedIndex = fs.readFileSync(path.join(resolvedBase, 'index.html'));
  } catch {}

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let pathname;
      try {
        pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      } catch {
        res.writeHead(400);
        res.end('Bad request');
        return;
      }
      let filePath = path.join(resolvedBase, pathname);

      // Prevent path traversal
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      // If path is a directory, serve index.html
      if (filePath.endsWith('/') || filePath.endsWith(path.sep)) {
        filePath = path.join(filePath, 'index.html');
      }

      fs.readFile(filePath, (err, data) => {
        if (err) {
          // SPA fallback: serve cached index.html for any missing file
          if (cachedIndex) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(cachedIndex);
          } else {
            res.writeHead(404);
            res.end('Not found');
          }
        } else {
          const ext = path.extname(filePath).toLowerCase();
          const contentType = MIME_TYPES[ext] || 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': contentType });
          res.end(data);
        }
      });
    });

    server.on('error', (err) => reject(err));
    server.listen(0, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

// First launch defaults
if (!store.has('firstLaunchDone')) {
  store.set('firstLaunchDone', true);
  store.set('closeToTray', true);
  store.set('startMinimized', false);
  store.set('openAtLogin', true);
}

// Always re-apply login item setting on startup (handles path changes after updates)
const openAtLogin = store.get('openAtLogin', false);
app.setLoginItemSettings({
  openAtLogin,
  args: openAtLogin ? ['--autostart'] : [],
});

function createWindow(url) {
  const mainWindowState = windowStateKeeper({
    defaultWidth: 1200,
    defaultHeight: 800,
  });

  mainWindow = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    title: 'SellServ Voice',
    icon: path.join(
      __dirname, 'icons',
      process.platform === 'win32' ? 'icon.ico'
        : process.platform === 'darwin' ? 'icon.icns'
        : '128x128.png',
    ),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Required: renderer loads from local HTTP server (127.0.0.1) but
      // makes API requests to the remote server — disabling webSecurity
      // allows these cross-origin requests without CORS headers.
      webSecurity: false,
    },
  });

  mainWindowState.manage(mainWindow);

  mainWindow.loadURL(url);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // Close-to-tray behavior
  mainWindow.on('close', (e) => {
    const closeToTray = store.get('closeToTray', true);
    if (closeToTray && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Auto-hide if started minimized via autostart
  const wasAutostarted = process.argv.includes('--autostart');
  const startMinimized = store.get('startMinimized', false);
  if (startMinimized && wasAutostarted) {
    mainWindow.hide();
  }
}

function createTray() {
  const iconPath = path.join(
    __dirname,
    'icons',
    process.platform === 'darwin' ? '32x32.png'
      : process.platform === 'win32' ? 'icon.ico'
      : '32x32.png',
  );
  tray = new Tray(iconPath);
  tray.setToolTip('SellServ Voice');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Window',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

// --- IPC Handlers ---

// Window controls
ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:toggleMaximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});
ipcMain.handle('window:close', () => mainWindow?.close());

// App info
ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('app:getPlatform', () => process.platform);

// Settings store
ipcMain.handle('store:get', (_e, key) => store.get(key));
ipcMain.handle('store:set', (_e, key, value) => store.set(key, value));

// Autostart
ipcMain.handle('autostart:isEnabled', () => {
  return store.get('openAtLogin', false);
});
ipcMain.handle('autostart:set', (_e, enabled) => {
  store.set('openAtLogin', enabled);
  app.setLoginItemSettings({
    openAtLogin: enabled,
    args: enabled ? ['--autostart'] : [],
  });
});

// Idle detection
ipcMain.handle('system:getIdleSeconds', () => {
  return powerMonitor.getSystemIdleTime();
});

// Notifications
ipcMain.handle('notification:send', (_e, title, body) => {
  new Notification({ title, body }).show();
});

// Shell
ipcMain.handle('shell:openExternal', (_e, url) => {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return;
    return shell.openExternal(url);
  } catch {
    return;
  }
});

// Updater — initialize once at module level to avoid error handler races
const { autoUpdater } = require('electron-updater');
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.on('error', (e) => console.error('[Updater]', e?.message || e));

ipcMain.handle('updater:checkForUpdates', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    if (result && result.updateInfo) {
      const remote = result.updateInfo.version;
      const current = app.getVersion();
      console.log(`[Updater] Current: ${current}, Remote: ${remote}`);
      // Only report update if remote version is actually newer
      const r = remote.split('.').map(Number);
      const c = current.split('.').map(Number);
      let isNewer = false;
      for (let i = 0; i < Math.max(r.length, c.length); i++) {
        if ((r[i] || 0) > (c[i] || 0)) { isNewer = true; break; }
        if ((r[i] || 0) < (c[i] || 0)) break;
      }
      if (isNewer) {
        return { available: true, version: remote, current };
      }
    }
    return { available: false };
  } catch (e) {
    console.error('[Updater]', e);
    return { available: false };
  }
});

ipcMain.handle('updater:download', async () => {
  await autoUpdater.downloadUpdate();
});

ipcMain.handle('updater:install', () => {
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.quitAndInstall();
});

// --- Global PTT (works even when app is not focused) ---
const { uIOhook } = require('uiohook-napi');

// Map web KeyboardEvent.code → uiohook keycode
const WEB_TO_UIOHOOK = {
  Backquote: 0x29, Digit1: 0x02, Digit2: 0x03, Digit3: 0x04, Digit4: 0x05,
  Digit5: 0x06, Digit6: 0x07, Digit7: 0x08, Digit8: 0x09, Digit9: 0x0A,
  Digit0: 0x0B, Minus: 0x0C, Equal: 0x0D, Backspace: 0x0E, Tab: 0x0F,
  KeyQ: 0x10, KeyW: 0x11, KeyE: 0x12, KeyR: 0x13, KeyT: 0x14,
  KeyY: 0x15, KeyU: 0x16, KeyI: 0x17, KeyO: 0x18, KeyP: 0x19,
  BracketLeft: 0x1A, BracketRight: 0x1B, Enter: 0x1C,
  ControlLeft: 0x1D, KeyA: 0x1E, KeyS: 0x1F, KeyD: 0x20, KeyF: 0x21,
  KeyG: 0x22, KeyH: 0x23, KeyJ: 0x24, KeyK: 0x25, KeyL: 0x26,
  Semicolon: 0x27, Quote: 0x28, ShiftLeft: 0x2A, Backslash: 0x2B,
  KeyZ: 0x2C, KeyX: 0x2D, KeyC: 0x2E, KeyV: 0x2F, KeyB: 0x30,
  KeyN: 0x31, KeyM: 0x32, Comma: 0x33, Period: 0x34, Slash: 0x35,
  ShiftRight: 0x36, AltLeft: 0x38, Space: 0x39, CapsLock: 0x3A,
  F1: 0x3B, F2: 0x3C, F3: 0x3D, F4: 0x3E, F5: 0x3F,
  F6: 0x40, F7: 0x41, F8: 0x42, F9: 0x43, F10: 0x44,
  F11: 0x57, F12: 0x58, NumLock: 0x45, ScrollLock: 0x46, Escape: 0x01,
  AltRight: 0x0E38, ControlRight: 0x0E1D,
  ArrowUp: 0x0E48, ArrowDown: 0x0E50, ArrowLeft: 0x0E4B, ArrowRight: 0x0E4D,
  Home: 0x0E47, End: 0x0E4F, PageUp: 0x0E49, PageDown: 0x0E51,
  Insert: 0x0E52, Delete: 0x0E53, MetaLeft: 0x0E5B, MetaRight: 0x0E5C,
};

// Web MouseEvent.button → uiohook button
const WEB_MOUSE_TO_UIOHOOK = { 0: 1, 1: 3, 2: 2, 3: 4, 4: 5 };

let pttMatch = null; // { type: 'key', keycode } or { type: 'mouse', button }

// Game Activity
ipcMain.handle('game:getCurrent', () => gameDetector.getCurrentGame());
ipcMain.handle('game:getSettings', () => ({
  enabled: store.get('gameActivityEnabled', true),
  visibility: store.get('gameActivityVisibility', 'all'),
  selectedServerIds: store.get('gameActivityServerIds', []),
  customGames: store.get('customGames', {}),
}));
ipcMain.handle('game:setEnabled', (_e, enabled) => store.set('gameActivityEnabled', enabled));
ipcMain.handle('game:setVisibility', (_e, visibility) => store.set('gameActivityVisibility', visibility));
ipcMain.handle('game:setServerIds', (_e, ids) => store.set('gameActivityServerIds', ids));
ipcMain.handle('game:addCustomGame', (_e, exe, name) => {
  const custom = store.get('customGames', {});
  custom[exe.toLowerCase()] = name;
  store.set('customGames', custom);
});
ipcMain.handle('game:removeCustomGame', (_e, exe) => {
  const custom = store.get('customGames', {});
  delete custom[exe.toLowerCase()];
  store.set('customGames', custom);
});
ipcMain.handle('game:getCustomGames', () => store.get('customGames', {}));

ipcMain.handle('ptt:configure', (_e, pttKeyStr) => {
  if (!pttKeyStr) {
    pttMatch = null;
    return;
  }
  if (pttKeyStr.startsWith('Mouse')) {
    const webBtn = parseInt(pttKeyStr.replace('Mouse', ''), 10);
    pttMatch = { type: 'mouse', button: WEB_MOUSE_TO_UIOHOOK[webBtn] ?? webBtn + 1 };
  } else {
    const keycode = WEB_TO_UIOHOOK[pttKeyStr];
    pttMatch = keycode != null ? { type: 'key', keycode } : null;
  }
});

uIOhook.on('keydown', (e) => {
  if (pttMatch?.type === 'key' && e.keycode === pttMatch.keycode) {
    mainWindow?.webContents.send('ptt:down');
  }
});
uIOhook.on('keyup', (e) => {
  if (pttMatch?.type === 'key' && e.keycode === pttMatch.keycode) {
    mainWindow?.webContents.send('ptt:up');
  }
});
uIOhook.on('mousedown', (e) => {
  if (pttMatch?.type === 'mouse' && e.button === pttMatch.button) {
    mainWindow?.webContents.send('ptt:down');
  }
});
uIOhook.on('mouseup', (e) => {
  if (pttMatch?.type === 'mouse' && e.button === pttMatch.button) {
    mainWindow?.webContents.send('ptt:up');
  }
});

uIOhook.start();

// --- App lifecycle ---

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    let url;
    if (isDev) {
      url = 'http://localhost:5173';
    } else {
      const staticDir = path.join(process.resourcesPath, 'app');
      localServer = await startLocalServer(staticDir);
      const port = localServer.address().port;
      url = `http://127.0.0.1:${port}`;
    }

    // Auto-update on startup (production only)
    if (!isDev) {
      try {
        const result = await autoUpdater.checkForUpdates();
        if (result && result.updateInfo) {
          const remote = result.updateInfo.version;
          const current = app.getVersion();
          const r = remote.split('.').map(Number);
          const c = current.split('.').map(Number);
          let isNewer = false;
          for (let i = 0; i < Math.max(r.length, c.length); i++) {
            if ((r[i] || 0) > (c[i] || 0)) { isNewer = true; break; }
            if ((r[i] || 0) < (c[i] || 0)) break;
          }
          if (isNewer) {
            console.log(`[Updater] Auto-updating ${current} -> ${remote}`);
            await autoUpdater.downloadUpdate();
            autoUpdater.quitAndInstall();
            return;
          }
        }
      } catch (e) {
        console.error('[Updater] Auto-update check failed:', e?.message || e);
      }
    }

    createWindow(url);
    createTray();

    // Start game detection
    gameDetector.start(store, (game) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('game:activity-changed', game);
      }
    });
  }).catch((err) => {
    console.error('[App] Failed to start:', err);
    app.quit();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    mainWindow?.show();
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
    gameDetector.stop();
    if (tray) {
      tray.destroy();
      tray = null;
    }
    if (localServer) {
      localServer.close();
    }
  });
}
