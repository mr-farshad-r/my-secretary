const { app } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'secretary-timeline-')));
app.whenReady().then(() => {
  try {
    const db = require('../src/database');
    db.initDb();
    const task = db.createTask({ title: 'Timeline', status: 'pending' });
    db.addComment(task.id, '**Hello** سلام');
    db.updateTask(task.id, { status: 'done', description: '# Updated', column_status: 'done' });
    assert.equal(db.getTask(task.id).status, 'done');
    assert.equal(db.getComments(task.id).filter(item => item.kind === 'event').length, 3);
    db.updateTask(task.id, { status: 'done', description: '# Updated', sort_order: 5 });
    assert.equal(db.getComments(task.id).length, 4);
    assert.equal(db.getCommentContributions()[0].count, 1);
    const event = db.getComments(task.id).find(item => item.kind === 'event');
    assert.equal(db.deleteComment(task.id, event.id), false);
    const backup = db.exportAllData();
    db.importAllData(backup);
    assert.equal(db.getComments(task.id).length, 4);
    db.initDb();
    assert.equal(db.getTask(task.id).status, 'done');
    backup.comments.forEach(item => delete item.kind);
    db.importAllData(backup);
    assert(db.getComments(task.id).every(item => item.kind === 'comment'));
    db.deleteTask(task.id);
    assert.equal(db.getComments(task.id).length, 0);
    console.log('Timeline, Done persistence, and backup compatibility passed');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
