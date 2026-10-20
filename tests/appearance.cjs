// Run with: node_modules/.bin/electron tests/appearance.cjs [screenshot-directory]
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'secretary-appearance-')));
const screenshotDirectory = process.argv[2];
const tasks = [
  { id: '1', title: 'Prepare the weekly planning notes', status: 'pending', column_status: 'todo', priority: 'high', category_id: 'work', shamsi_date: '1405/07/29', miladi_date: '2026-10-21', custom_fields: { Project: 'My Secretary' } },
  { id: '2', title: 'Review the calendar and upcoming deadlines', status: 'wip', column_status: 'wip', priority: 'medium', category_id: 'work', shamsi_date: '1405/07/27', miladi_date: '2026-10-19' },
  { id: '3', title: 'یادداشت جلسه و پیگیری کارها', status: 'pending', column_status: 'todo', priority: 'low' },
  { id: '4', title: 'Organize the project workspace', status: 'done', column_status: 'done', priority: 'low' },
  { id: '5', title: 'Last week’s planning', status: 'done', column_status: 'archived' },
];
const responses = {
  'tasks:getAll': tasks, 'categories:getAll': [{ id: 'work', name: 'Work' }],
  'calendar:getContributions': [], 'tasks:getDraft': null,
  'comments:getAll': [{ id: 'c1', kind: 'comment', body: '**Ready for review.**\n\nسلام، یادداشت جلسه', shamsi_created_at: '1405/07/20 10:30' }],
  'comments:getCounts': [{ task_id: '1', count: 2 }, { task_id: '2', count: 1 }],
  'settings:get': { openAtLogin: false },
  'app:checkForUpdate': { currentVersion: '1.11.2', latestVersion: '1.11.2' },
};
for (const [channel, response] of Object.entries(responses)) ipcMain.handle(channel, () => response);
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1400, height: 900, show: true, webPreferences: { preload: path.join(__dirname, '../src/preload.js'), contextIsolation: true, backgroundThrottling: false } });
  const run = script => window.webContents.executeJavaScript(script);
  const pause = () => new Promise(resolve => setTimeout(resolve, 250));
  async function capture(name) {
    await pause();
    if (screenshotDirectory) {
      fs.mkdirSync(screenshotDirectory, { recursive: true });
      fs.writeFileSync(path.join(screenshotDirectory, `${name}.png`), (await window.webContents.capturePage()).toPNG());
    }
  }
  try {
    await window.loadFile(path.join(__dirname, '../src/renderer/index.html'));
    await pause();
    await run('applyMotionSetting(false)');
    assert.equal(await run("document.querySelectorAll('.task-card').length"), 4);
    assert.equal(await run("document.querySelector('.task-card[data-id=\"1\"] .comment-count-badge').textContent.trim()"), '2');
    assert.equal(await run("document.querySelector('.task-card[data-id=\"3\"] .comment-count-badge')"), null);
    assert.equal(await run("getComputedStyle(document.body).backgroundColor"), 'rgb(246, 245, 244)');
    assert.equal(await run("getComputedStyle(document.querySelector('.task-card')).backgroundColor"), 'rgb(255, 255, 255)');
    async function checkLayout(view) {
      assert(await run(`(() => {
        const main = document.getElementById('${view}').getBoundingClientRect();
        const header = document.querySelector('header').getBoundingClientRect();
        return main.height > 100 && main.top >= header.bottom && main.bottom <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth;
      })()`), `${view} fits the window`);
    }
    await checkLayout('board');
    await capture('board');
    await run("document.getElementById('calendarViewBtn').click()");
    await checkLayout('calendar');
    await capture('calendar');
    await run("document.getElementById('noteViewBtn').click(); document.getElementById('noteEditor').value = '# Weekly plan\\n\\nA clear space for tasks, dates, and notes.\\n\\n- [ ] Review upcoming deadlines\\n- [x] Organize the workspace\\n\\n## یادداشت جلسه\\n\\nپیگیری کارهای این هفته'; document.getElementById('noteEditor').dispatchEvent(new Event('input'))");
    await checkLayout('note');
    await capture('note');
    await run("document.getElementById('manageNoteTemplatesBtn').click()");
    assert(await run("document.getElementById('noteTemplateDialog').open"));
    await capture('templates');
    await run("document.getElementById('closeNoteTemplates').click(); document.getElementById('boardViewBtn').click(); document.querySelector('.task-card').click()");
    await capture('task-editor');
    assert(await run("!document.getElementById('commentsSection').classList.contains('hidden')"));
    await run("document.getElementById('closeModal').click(); document.getElementById('settingsBtn').click()");
    await capture('settings');
    await run("document.getElementById('closeSettings').click(); document.getElementById('categoriesBtn').click()");
    await capture('categories');
    await run("document.getElementById('closeCategories').click(); document.getElementById('viewArchiveBtn').click()");
    await capture('archive');
    await run("document.getElementById('closeArchive').click(); openCalendarEvent({title: 'Weekly planning', date: '2026-10-21', time: '10:30', location: 'Office', description: 'Plan the week together.'})");
    await capture('event');
    await run("closeCalendarEvent()");
    window.setSize(900, 600);
    await pause();
    for (const view of ['board', 'calendar', 'note']) {
      await run(`document.getElementById('${view}ViewBtn').click()`);
      await checkLayout(view);
      await capture(`${view}-compact`);
    }
    await run("document.getElementById('updateBanner').classList.remove('hidden')");
    await checkLayout('note');
    await capture('note-update');
    await run("document.getElementById('boardViewBtn').click(); tasks = []; renderBoard(); document.getElementById('updateBanner').classList.add('hidden')");
    assert(await run("getComputedStyle(document.querySelector('.task-list'), '::before').content.includes('No tasks')"));
    await capture('empty-board');
    await run("document.getElementById('addTaskBtn').click()");
    await pause();
    assert.equal(await run("getComputedStyle(document.getElementById('taskTitle')).outlineStyle"), 'solid');
    await run("document.getElementById('closeModal').click(); document.getElementById('settingsBtn').click(); const theme = document.getElementById('themeMode'); theme.value = 'dark'; theme.dispatchEvent(new Event('change'))");
    assert.equal(await run("getComputedStyle(document.body).backgroundColor"), 'rgb(25, 25, 25)');
    assert.equal(await run("getComputedStyle(document.documentElement).colorScheme"), 'dark');
    await run("document.getElementById('notePreview').innerHTML = renderNoteMarkdown(String.fromCharCode(96).repeat(3) + 'javascript\\nconst value = 42;\\n' + String.fromCharCode(96).repeat(3))");
    assert.equal(await run("getComputedStyle(document.querySelector('#notePreview .hljs-keyword')).color"), 'rgb(205, 165, 238)');
    assert(await run("noteHtml(String.fromCharCode(96).repeat(3) + 'javascript\\nconst value = 42;\\n' + String.fromCharCode(96).repeat(3), 'ltr').includes('rgb(120, 59, 156)')"));
    await capture('settings-dark');
    await run("document.getElementById('closeSettings').click()");
    for (const view of ['board', 'calendar', 'note']) {
      await run(`document.getElementById('${view}ViewBtn').click()`);
      await checkLayout(view);
      await capture(`${view}-dark`);
    }
    await window.loadFile(path.join(__dirname, '../src/renderer/index.html'));
    await pause();
    assert.equal(await run("document.documentElement.dataset.theme"), 'dark');
    assert.equal(await run("document.getElementById('themeMode').value"), 'dark');
    assert.equal(await run("getComputedStyle(document.querySelector('.task-card')).backgroundColor"), 'rgb(35, 35, 35)');
    await run("document.getElementById('themeMode').value = 'light'; document.getElementById('themeMode').dispatchEvent(new Event('change'))");
    assert.equal(await run("getComputedStyle(document.body).backgroundColor"), 'rgb(246, 245, 244)');
    console.log('Theme switching and persistence passed.');
    console.log('Appearance checks passed: all views, dialogs, compact layout, update banner, empty board, and keyboard focus.');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
