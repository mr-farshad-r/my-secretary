const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const db = require('./database');

let mainWindow;

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

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
