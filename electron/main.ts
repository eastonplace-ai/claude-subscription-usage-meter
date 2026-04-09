import { app, BrowserWindow, shell, Tray, nativeImage, Menu, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { createServer } from 'http';
import os from 'os';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let menubarWindow: BrowserWindow | null = null;
let currentPort: number = 0;
let trayRefreshTimer: NodeJS.Timeout | null = null;

const isDev = !app.isPackaged;
const DEV_PORT = Number(process.env.CLAUDE_USAGE_PORT || 3099);

// Settings file path
const SETTINGS_DIR =
  process.env.CLAUDE_USAGE_CONFIG_DIR || path.join(os.homedir(), '.claude-usage-dashboard');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'menubar-settings.json');

const DEFAULT_SETTINGS = {
  enabled: true,
  showInMenubar: true,
  showFiveHour: true,
  showSevenDay: true,
  showSonnet: true,
  showCost: true,
  refreshInterval: 60,
};

function readSettings(): typeof DEFAULT_SETTINGS {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) };
    }
  } catch {
    // fall through to defaults
  }
  return { ...DEFAULT_SETTINGS };
}

function writeSettings(settings: Partial<typeof DEFAULT_SETTINGS>): void {
  try {
    if (!fs.existsSync(SETTINGS_DIR)) fs.mkdirSync(SETTINGS_DIR, { recursive: true });
    const current = readSettings();
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...current, ...settings }, null, 2));
  } catch (e) {
    console.error('Failed to write settings:', e);
  }
}

// Create a simple monochrome tray icon as a data URL (22x22 SVG circle)
function createTrayIcon(): Electron.NativeImage {
  // Simple Claude-ish icon: a small circle with a C
  const svgData = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
    <circle cx="11" cy="11" r="9" fill="none" stroke="#000" stroke-width="1.5"/>
    <path d="M14 8.5a4.5 4.5 0 1 0 0 5" stroke="#000" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  </svg>`;
  const base64 = Buffer.from(svgData).toString('base64');
  const dataUrl = `data:image/svg+xml;base64,${base64}`;
  const img = nativeImage.createFromDataURL(dataUrl);
  img.setTemplateImage(true);
  return img;
}

async function updateTrayTitle() {
  if (!tray) return;
  try {
    const res = await fetch(`http://127.0.0.1:${currentPort}/api/usage-live`);
    if (!res.ok) return;
    const data = await res.json() as { fiveHour?: number; sevenDay?: number; overage?: number } | null;
    if (!data) return;
    const settings = readSettings();
    const parts: string[] = [];
    if (settings.showFiveHour && data.fiveHour != null) parts.push(`5H: ${Math.round(data.fiveHour)}%`);
    if (settings.showSevenDay && data.sevenDay != null) parts.push(`7D: ${Math.round(data.sevenDay)}%`);
    if (settings.showSonnet && data.overage != null && data.overage > 0) {
      parts.push(`SON: ${Math.round(data.overage)}%`);
    }
    tray.setTitle(parts.join(' | '));
  } catch {
    // silently ignore — server may not be ready yet
  }
}

function startTrayRefresh(intervalSec: number) {
  if (trayRefreshTimer) clearInterval(trayRefreshTimer);
  trayRefreshTimer = setInterval(() => updateTrayTitle(), intervalSec * 1000);
}

function destroyTray() {
  if (trayRefreshTimer) {
    clearInterval(trayRefreshTimer);
    trayRefreshTimer = null;
  }
  if (menubarWindow && !menubarWindow.isDestroyed()) {
    menubarWindow.close();
  }
  menubarWindow = null;
  tray?.destroy();
  tray = null;
}

function createMenubarWindow(port: number) {
  if (menubarWindow && !menubarWindow.isDestroyed()) {
    menubarWindow.focus();
    return menubarWindow;
  }

  menubarWindow = new BrowserWindow({
    width: 360,
    height: 480,
    frame: false,
    transparent: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    backgroundColor: '#000000',
    show: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  menubarWindow.loadURL(`http://127.0.0.1:${port}/menubar`);

  menubarWindow.on('blur', () => {
    menubarWindow?.hide();
  });

  menubarWindow.on('closed', () => {
    menubarWindow = null;
  });

  return menubarWindow;
}

function showMenubarWindow() {
  if (!tray) return;

  const win = createMenubarWindow(currentPort);
  const trayBounds = tray.getBounds();
  const winBounds = win.getBounds();

  // Position below tray icon, centered horizontally on it
  const x = Math.round(trayBounds.x + trayBounds.width / 2 - winBounds.width / 2);
  const y = Math.round(trayBounds.y + trayBounds.height + 4);

  win.setPosition(x, y, false);
  win.show();
  win.focus();
}

function buildContextMenu(): Electron.Menu {
  return Menu.buildFromTemplate([
    {
      label: 'Open Dashboard',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    {
      label: 'Refresh',
      click: () => {
        if (menubarWindow && !menubarWindow.isDestroyed()) {
          menubarWindow.webContents.reload();
        }
        updateTrayTitle();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit(),
    },
  ]);
}

function createTray(port: number) {
  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('Claude Usage Dashboard');

  tray.on('click', () => {
    if (menubarWindow && !menubarWindow.isDestroyed() && menubarWindow.isVisible()) {
      menubarWindow.hide();
    } else {
      showMenubarWindow();
    }
  });

  tray.on('right-click', () => {
    tray?.popUpContextMenu(buildContextMenu());
  });
}

function syncTrayWithSettings(settings = readSettings()) {
  if (!settings.enabled || !settings.showInMenubar) {
    destroyTray();
    return;
  }

  if (!tray) {
    createTray(currentPort);
  }

  startTrayRefresh(settings.refreshInterval);
  setTimeout(() => updateTrayTitle(), 300);
}

// IPC handlers
ipcMain.handle('menubar:getSettings', () => readSettings());
ipcMain.handle('menubar:setSettings', (_event, settings: Partial<typeof DEFAULT_SETTINGS>) => {
  writeSettings(settings);
  const updated = readSettings();
  syncTrayWithSettings(updated);
  return updated;
});
ipcMain.handle('menubar:openDashboard', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
  menubarWindow?.hide();
});

async function startNextServer(): Promise<number> {
  // In production, start Next.js server
  const next = require('next');
  const nextApp = next({
    dev: false,
    dir: path.join(__dirname, '..'),
  });
  const handle = nextApp.getRequestHandler();
  await nextApp.prepare();

  const server = createServer((req, res) => {
    handle(req, res);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 3099;
      resolve(port);
    });
  });
}

async function createWindow() {
  let port = DEV_PORT;

  if (!isDev) {
    port = await startNextServer();
  }

  currentPort = port;

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  if (isDev && process.env.ELECTRON_OPEN_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Inject Nothing UI dot grid background directly on the scrollable content div
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.insertCSS(`
      .dot-grid-canvas {
        background-color: var(--nothing-bg, #000) !important;
        background-image: radial-gradient(circle, var(--dot-color, rgba(255,255,255,0.07)) 0.7px, transparent 0.7px) !important;
        background-size: 16px 16px !important;
      }
    `);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Create tray after window is set up
  syncTrayWithSettings();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // On macOS, keep the app alive in the tray even when all windows are closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
  // On macOS: do nothing — tray keeps the app running
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  destroyTray();
});
