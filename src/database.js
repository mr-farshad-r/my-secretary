const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');
const fs = require('fs');
const jalaali = require('jalaali-js');

let db;

/** Derive ISO miladi date from a "YYYY/MM/DD" shamsi string, or null */
function shamsiToMiladi(shamsiStr) {
  if (!shamsiStr) return null;
  const m = String(shamsiStr).trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const g = jalaali.toGregorian(+m[1], +m[2], +m[3]);
  return `${g.gy}-${String(g.gm).padStart(2, '0')}-${String(g.gd).padStart(2, '0')}`;
}

function getDbPath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'secretary.db');
}

function initDb() {
  const dbPath = getDbPath();
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'todo',
      shamsi_date TEXT,
      miladi_date TEXT,
      custom_fields TEXT DEFAULT '{}',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS task_drafts (
      task_id TEXT PRIMARY KEY,
      data TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TRIGGER IF NOT EXISTS tasks_updated_at
    AFTER UPDATE ON tasks
    FOR EACH ROW
    BEGIN
      UPDATE tasks SET updated_at = datetime('now') WHERE id = OLD.id;
    END;
  `);

  return db;
}

function getDb() {
  if (!db) initDb();
  return db;
}

// ─── CRUD ────────────────────────────────────────────

function createTask(task) {
  const id = require('crypto').randomUUID();
  const shamsiDate = task.shamsi_date || null;
  const miladiDate = task.miladi_date || shamsiToMiladi(shamsiDate);
  const stmt = getDb().prepare(`
    INSERT INTO tasks (id, title, description, status, shamsi_date, miladi_date, custom_fields, sort_order)
    VALUES (@id, @title, @description, @status, @shamsi_date, @miladi_date, @custom_fields, @sort_order)
  `);
  stmt.run({
    id,
    title: task.title,
    description: task.description || '',
    status: task.status || 'todo',
    shamsi_date: shamsiDate,
    miladi_date: miladiDate,
    custom_fields: JSON.stringify(task.custom_fields || {}),
    sort_order: task.sort_order || Date.now(),
  });
  return getTask(id);
}

function getTask(id) {
  const row = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (row) row.custom_fields = JSON.parse(row.custom_fields || '{}');
  return row;
}

function getAllTasks() {
  const rows = getDb().prepare('SELECT * FROM tasks ORDER BY sort_order ASC').all();
  rows.forEach(r => r.custom_fields = JSON.parse(r.custom_fields || '{}'));
  return rows;
}

function updateTask(id, updates) {
  const fields = [];
  const values = { id };
  const allowed = ['title', 'description', 'status', 'shamsi_date', 'miladi_date', 'custom_fields', 'sort_order'];

  // If shamsi_date is being updated, recompute miladi_date automatically
  if (updates.shamsi_date !== undefined && updates.miladi_date === undefined) {
    updates.miladi_date = shamsiToMiladi(updates.shamsi_date);
  }

  for (const key of allowed) {
    if (updates[key] !== undefined) {
      fields.push(`${key} = @${key}`);
      values[key] = key === 'custom_fields' ? JSON.stringify(updates[key]) : updates[key];
    }
  }
  if (fields.length === 0) return getTask(id);
  getDb().prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = @id`).run(values);
  return getTask(id);
}

function deleteTask(id) {
  const database = getDb();
  database.prepare('DELETE FROM task_drafts WHERE task_id = ?').run(id);
  database.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

function saveDraft(taskId, data) {
  getDb().prepare(`
    INSERT INTO task_drafts (task_id, data, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(task_id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')
  `).run(taskId, JSON.stringify(data || {}));
  return getDraft(taskId);
}

function getDraft(taskId) {
  const row = getDb().prepare('SELECT * FROM task_drafts WHERE task_id = ?').get(taskId);
  if (!row) return null;
  return { ...row, data: JSON.parse(row.data || '{}') };
}

function deleteDraft(taskId) {
  getDb().prepare('DELETE FROM task_drafts WHERE task_id = ?').run(taskId);
}

function archiveAllDone() {
  const result = getDb().prepare("UPDATE tasks SET status = 'archived' WHERE status = 'done'").run();
  return result.changes;
}

module.exports = {
  initDb,
  createTask,
  getTask,
  getAllTasks,
  updateTask,
  deleteTask,
  saveDraft,
  getDraft,
  deleteDraft,
  archiveAllDone,
};
