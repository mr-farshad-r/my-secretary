const { app, BrowserWindow, dialog, ipcMain, shell, net, Notification } = require('electron');
const fs = require('fs/promises');
const path = require('path');
const db = require('./database');

let mainWindow;
const RELEASES_URL = 'https://github.com/mr-farshad-r/my-secretary/releases';
let deadlineTimer;

function localIsoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function checkTomorrowDeadlines() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dueTasks = db.getTasksDueOn(localIsoDate(tomorrow));
  if (!dueTasks.length || !Notification.isSupported()) return;
  const names = dueTasks.slice(0, 4).map(task => task.title).join(', ');
  const extra = dueTasks.length > 4 ? ` and ${dueTasks.length - 4} more` : '';
  new Notification({
    title: `${dueTasks.length} ${dueTasks.length === 1 ? 'task is' : 'tasks are'} due tomorrow`,
    body: `${names}${extra}`,
  }).show();
}

function scheduleDeadlineCheck() {
  clearTimeout(deadlineTimer);
  const now = new Date();
  const next = new Date(now);
  next.setHours(11, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  deadlineTimer = setTimeout(() => {
    checkTomorrowDeadlines();
    scheduleDeadlineCheck();
  }, next.getTime() - now.getTime());
}

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
  ipcMain.handle('comments:getAll', (_e, taskId) => db.getComments(taskId));
  ipcMain.handle('comments:add', (_e, taskId, body) => db.addComment(taskId, body));
  ipcMain.handle('comments:delete', (_e, taskId, commentId) => db.deleteComment(taskId, commentId));
  ipcMain.handle('categories:getAll', () => db.getAllCategories());
  ipcMain.handle('categories:create', (_e, name) => db.createCategory(name));
  ipcMain.handle('categories:update', (_e, id, name) => db.updateCategory(id, name));
  ipcMain.handle('categories:delete', (_e, id) => db.deleteCategory(id));
  ipcMain.handle('settings:get', () => ({
    openAtLogin: app.getLoginItemSettings().openAtLogin,
  }));
  ipcMain.handle('settings:setOpenAtLogin', (_e, enabled) => {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
    return { openAtLogin: app.getLoginItemSettings().openAtLogin };
  });
  ipcMain.handle('settings:exportAll', async () => {
    const date = localIsoDate(new Date());
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export all My Secretary data',
      defaultPath: `my-secretary-backup-${date}.json`,
      filters: [{ name: 'JSON backup', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };

    const backup = {
      format: 'my-secretary-backup',
      version: 1,
      appVersion: app.getVersion(),
      exportedAt: new Date().toISOString(),
      data: db.exportAllData(),
    };
    await fs.writeFile(result.filePath, JSON.stringify(backup, null, 2), 'utf8');
    return { canceled: false, filePath: result.filePath };
  });
  ipcMain.handle('settings:importAll', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import My Secretary backup',
      properties: ['openFile'],
      filters: [{ name: 'JSON backup', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };

    const filePath = result.filePaths[0];
    const stats = await fs.stat(filePath);
    if (stats.size > 50 * 1024 * 1024) throw new Error('Backup file is larger than 50 MB');

    const backup = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (backup?.format !== 'my-secretary-backup' || backup?.version !== 1) {
      throw new Error('This is not a supported My Secretary backup');
    }

    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Replace current data?',
      message: 'Importing this backup will replace all current data.',
      detail: 'Tasks, categories, comments, and drafts currently in the app will be removed.',
      buttons: ['Cancel', 'Replace and import'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (confirmation.response !== 1) return { canceled: true };

    return { canceled: false, counts: db.importAllData(backup.data) };
  });
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
  scheduleDeadlineCheck();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
