import { app, BrowserWindow, shell } from 'electron';
import path from 'path';
import { createServer } from 'http';

let mainWindow: BrowserWindow | null = null;
const isDev = !app.isPackaged;
const DEV_PORT = 3099;

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

  if (isDev) {
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
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
