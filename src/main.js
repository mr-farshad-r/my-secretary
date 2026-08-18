const { app, BrowserWindow, ipcMain, shell, net } = require('electron');
const path = require('path');
const db = require('./database');

let mainWindow;
const RELEASES_URL = 'https://github.com/mr-farshad-r/my-secretary/releases';

async function checkForUpdate() {
  const response = await net.fetch('https://api.github.com/repos/mr-farshad-r/my-secretary/releases/latest', {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`GitHub update check failed (${response.status})`);
  const release = await response.json();
  return {
    currentVersion: app.getVersion(),
    latestVersion: String(release.tag_name || '').replace(/^v/, ''),
    releaseUrl: release.html_url || `${RELEASES_URL}/latest`,
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'My Secretary',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  db.initDb();

  // ─── IPC Handlers ────────────────────────────────
  ipcMain.handle('tasks:create', (_e, task) => db.createTask(task));
  ipcMain.handle('tasks:getAll', () => db.getAllTasks());
  ipcMain.handle('tasks:get', (_e, id) => db.getTask(id));
  ipcMain.handle('tasks:update', (_e, id, updates) => db.updateTask(id, updates));
  ipcMain.handle('tasks:delete', (_e, id) => db.deleteTask(id));
  ipcMain.handle('tasks:archiveAllDone', () => db.archiveAllDone());
  ipcMain.handle('tasks:getDraft', (_e, id) => db.getDraft(id));
  ipcMain.handle('tasks:saveDraft', (_e, id, data) => db.saveDraft(id, data));
  ipcMain.handle('tasks:deleteDraft', (_e, id) => db.deleteDraft(id));
  ipcMain.handle('app:checkForUpdate', () => checkForUpdate());
  ipcMain.handle('app:openRelease', (_e, releaseUrl) => {
    const url = new URL(releaseUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.startsWith('/mr-farshad-r/my-secretary/releases')) {
      throw new Error('Invalid release URL');
    }
    return shell.openExternal(url.toString());
  });
  ipcMain.handle('app:openExternal', (_e, externalUrl) => {
    const url = new URL(externalUrl);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Only HTTP and HTTPS links can be opened');
    }
    return shell.openExternal(url.toString());
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
