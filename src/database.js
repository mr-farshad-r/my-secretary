const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');
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
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      column_status TEXT NOT NULL DEFAULT 'todo',
      priority TEXT NOT NULL DEFAULT 'medium',
      shamsi_date TEXT,
      miladi_date TEXT,
      deadline_time TEXT,
      category_id TEXT,
      custom_fields TEXT DEFAULT '{}',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS task_drafts (
      task_id TEXT PRIMARY KEY,
      data TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_comments (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      body TEXT NOT NULL,
      shamsi_created_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS task_comments_task_id
    ON task_comments(task_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS tasks_deadline
    ON tasks(miladi_date, column_status);

    CREATE TRIGGER IF NOT EXISTS tasks_updated_at
    AFTER UPDATE ON tasks
    FOR EACH ROW
    BEGIN
      UPDATE tasks SET updated_at = datetime('now') WHERE id = OLD.id;
    END;
  `);

  const taskColumns = db.prepare('PRAGMA table_info(tasks)').all().map(column => column.name);
  if (!taskColumns.includes('column_status')) {
    db.exec("ALTER TABLE tasks ADD COLUMN column_status TEXT NOT NULL DEFAULT 'todo'");
    db.exec("UPDATE tasks SET column_status = CASE status WHEN 'wip' THEN 'wip' WHEN 'done' THEN 'done' WHEN 'archived' THEN 'archived' ELSE 'todo' END");
  }
  if (!taskColumns.includes('priority')) {
    db.exec("ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium'");
  }
  if (!taskColumns.includes('category_id')) {
    db.exec('ALTER TABLE tasks ADD COLUMN category_id TEXT REFERENCES categories(id) ON DELETE SET NULL');
  }
  if (!taskColumns.includes('deadline_time')) {
    db.exec('ALTER TABLE tasks ADD COLUMN deadline_time TEXT');
  }

  // Keep the task badge independent from its Kanban column.
  db.prepare("UPDATE tasks SET status = 'pending' WHERE status = 'todo'").run();
  db.prepare("UPDATE tasks SET status = 'wip' WHERE status = 'inprogress'").run();
  db.prepare("UPDATE tasks SET status = 'pending' WHERE status NOT IN ('wip', 'pending', 'canceled')").run();

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
    INSERT INTO tasks (id, title, description, status, column_status, priority, shamsi_date, miladi_date, deadline_time, category_id, custom_fields, sort_order)
    VALUES (@id, @title, @description, @status, @column_status, @priority, @shamsi_date, @miladi_date, @deadline_time, @category_id, @custom_fields, @sort_order)
  `);
  stmt.run({
    id,
    title: task.title,
    description: task.description || '',
    status: task.status || 'pending',
    column_status: task.column_status || 'todo',
    priority: task.priority || 'medium',
    shamsi_date: shamsiDate,
    miladi_date: miladiDate,
    deadline_time: task.deadline_time || null,
    category_id: task.category_id || null,
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
  const allowed = ['title', 'description', 'status', 'column_status', 'priority', 'shamsi_date', 'miladi_date', 'deadline_time', 'category_id', 'custom_fields', 'sort_order'];

  // If shamsi_date is being updated, recompute miladi_date automatically
  if (updates.shamsi_date !== undefined && updates.miladi_date === undefined) {
    updates.miladi_date = shamsiToMiladi(updates.shamsi_date);
  }

  for (const key of allowed) {
    if (updates[key] !== undefined) {
      fields.push(`${key} = @${key}`);
      values[key] = key === 'custom_fields'
        ? JSON.stringify(updates[key])
        : (['shamsi_date', 'miladi_date', 'deadline_time', 'category_id'].includes(key) && !updates[key] ? null : updates[key]);
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
  const result = getDb().prepare("UPDATE tasks SET column_status = 'archived' WHERE column_status = 'done'").run();
  return result.changes;
}

function shamsiTimestamp(date = new Date()) {
  const j = jalaali.toJalaali(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const datePart = `${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`;
  const timePart = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${datePart} ${timePart}`;
}

function getComments(taskId) {
  return getDb().prepare(`
    SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at DESC, rowid DESC
  `).all(taskId);
}

function addComment(taskId, body) {
  const trimmedBody = String(body || '').trim();
  if (!trimmedBody) throw new Error('Comment cannot be empty');
  if (!getTask(taskId)) throw new Error('Task not found');
  const id = require('crypto').randomUUID();
  getDb().prepare(`
    INSERT INTO task_comments (id, task_id, body, shamsi_created_at)
    VALUES (?, ?, ?, ?)
  `).run(id, taskId, trimmedBody, shamsiTimestamp());
  return getDb().prepare('SELECT * FROM task_comments WHERE id = ?').get(id);
}

function deleteComment(taskId, commentId) {
  const result = getDb().prepare(`
    DELETE FROM task_comments WHERE id = ? AND task_id = ?
  `).run(commentId, taskId);
  return result.changes > 0;
}

function getAllCategories() {
  return getDb().prepare('SELECT * FROM categories ORDER BY name COLLATE NOCASE ASC').all();
}

function createCategory(name) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('Category name cannot be empty');
  const id = require('crypto').randomUUID();
  getDb().prepare('INSERT INTO categories (id, name) VALUES (?, ?)').run(id, trimmedName);
  return getDb().prepare('SELECT * FROM categories WHERE id = ?').get(id);
}

function updateCategory(id, name) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) throw new Error('Category name cannot be empty');
  getDb().prepare('UPDATE categories SET name = ? WHERE id = ?').run(trimmedName, id);
  return getDb().prepare('SELECT * FROM categories WHERE id = ?').get(id);
}

function deleteCategory(id) {
  return getDb().prepare('DELETE FROM categories WHERE id = ?').run(id).changes > 0;
}

function getTasksDueOn(miladiDate) {
  return getDb().prepare(`
    SELECT tasks.*, categories.name AS category_name
    FROM tasks LEFT JOIN categories ON categories.id = tasks.category_id
    WHERE tasks.miladi_date = ?
      AND tasks.column_status NOT IN ('done', 'archived')
      AND tasks.status != 'canceled'
    ORDER BY tasks.title COLLATE NOCASE
  `).all(miladiDate);
}

function exportAllData() {
  const database = getDb();
  return database.transaction(() => ({
    tasks: getAllTasks(),
    categories: database.prepare('SELECT * FROM categories ORDER BY created_at ASC').all(),
    comments: database.prepare('SELECT * FROM task_comments ORDER BY created_at ASC, rowid ASC').all(),
    drafts: database.prepare('SELECT * FROM task_drafts ORDER BY updated_at ASC').all().map(draft => ({
      ...draft,
      data: JSON.parse(draft.data || '{}'),
    })),
  }))();
}

function importAllData(data) {
  const entities = ['tasks', 'categories', 'comments', 'drafts'];
  if (!data || entities.some(entity => !Array.isArray(data[entity]))) {
    throw new Error('Backup data is incomplete');
  }

  const database = getDb();
  return database.transaction(() => {
    database.prepare('DELETE FROM task_comments').run();
    database.prepare('DELETE FROM task_drafts').run();
    database.prepare('DELETE FROM tasks').run();
    database.prepare('DELETE FROM categories').run();

    const insertCategory = database.prepare(`
      INSERT INTO categories (id, name, created_at) VALUES (@id, @name, @created_at)
    `);
    const insertTask = database.prepare(`
      INSERT INTO tasks (id, title, description, status, column_status, priority, shamsi_date, miladi_date, deadline_time, category_id, custom_fields, sort_order, created_at, updated_at)
      VALUES (@id, @title, @description, @status, @column_status, @priority, @shamsi_date, @miladi_date, @deadline_time, @category_id, @custom_fields, @sort_order, @created_at, @updated_at)
    `);
    const insertComment = database.prepare(`
      INSERT INTO task_comments (id, task_id, body, shamsi_created_at, created_at)
      VALUES (@id, @task_id, @body, @shamsi_created_at, @created_at)
    `);
    const insertDraft = database.prepare(`
      INSERT INTO task_drafts (task_id, data, updated_at) VALUES (@task_id, @data, @updated_at)
    `);

    data.categories.forEach(category => insertCategory.run(category));
    data.tasks.forEach(task => insertTask.run({
      ...task,
      deadline_time: task.deadline_time || null,
      custom_fields: JSON.stringify(task.custom_fields || {}),
    }));
    data.comments.forEach(comment => insertComment.run(comment));
    data.drafts.forEach(draft => insertDraft.run({
      ...draft,
      data: JSON.stringify(draft.data || {}),
    }));

    return Object.fromEntries(entities.map(entity => [entity, data[entity].length]));
  })();
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
  getComments,
  addComment,
  deleteComment,
  getAllCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getTasksDueOn,
  exportAllData,
  importAllData,
};
