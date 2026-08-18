// ─── State ──────────────────────────────────────────
let tasks = [];
let editingTaskId = null;
let isPreviewMode = false;
let editingBaseTask = null;
let draftTimer = null;
let draftDirty = false;
let newTaskStatus = 'todo';

const STATUS_COLUMNS = ['todo', 'inprogress', 'done'];

// ─── Shamsi ↔ Miladi conversion ──────────────────────
// jalaali-js loaded via script tag in index.html (exposes window.jalaali)
const jalaali = window.jalaali;

/** "1403/05/15" -> "2024-08-05" (ISO) or null */
function shamsiToMiladi(shamsiStr) {
  if (!shamsiStr) return null;
  const m = shamsiStr.trim().match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const [_, jy, jm, jd] = m;
  const g = jalaali.toGregorian(+jy, +jm, +jd);
  return `${g.gy}-${String(g.gm).padStart(2, '0')}-${String(g.gd).padStart(2, '0')}`;
}

/** "2024-08-05" (ISO) -> "1403/05/15" */
function miladiToShamsi(miladiStr) {
  if (!miladiStr) return null;
  const m = miladiStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [_, gy, gm, gd] = m;
  const j = jalaali.toJalaali(+gy, +gm, +gd);
  return `${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`;
}

/** Today's Shamsi date as "1403/05/15" */
function todayShamsi() {
  const now = new Date();
  const j = jalaali.toJalaali(now.getFullYear(), now.getMonth() + 1, now.getDate());
  return `${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`;
}

/** Today's Miladi date as "2024-08-01" */
function todayMiladi() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function remainingDaysLabel(miladiDate) {
  if (!miladiDate || !/^\d{4}-\d{2}-\d{2}$/.test(miladiDate)) return '';
  const [year, month, day] = miladiDate.split('-').map(Number);
  const deadline = Date.UTC(year, month - 1, day);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((deadline - today) / 86400000);

  if (days === 0) return 'Today';
  if (days === 1) return '1 day left';
  if (days > 1) return `${days} days left`;
  if (days === -1) return '1 day overdue';
  return `${Math.abs(days)} days overdue`;
}

function isWebLink(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

// ─── Init ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadTasks();
  renderBoard();
  setupEventListeners();
  setupDragAndDrop();
  checkForUpdates();
});

// ─── Data ───────────────────────────────────────────
async function loadTasks() {
  tasks = await window.api.tasks.getAll();
}

async function saveTask(data) {
  if (data.id) {
    return window.api.tasks.update(data.id, {
      title: data.title,
      description: data.description,
      shamsi_date: data.shamsi_date,
      miladi_date: data.miladi_date,
      custom_fields: data.custom_fields,
    });
  }
  return window.api.tasks.create({
    title: data.title,
    description: data.description,
    status: data.status || 'todo',
    shamsi_date: data.shamsi_date,
    miladi_date: data.miladi_date,
    custom_fields: data.custom_fields,
  });
}

// ─── Render ─────────────────────────────────────────
function renderBoard() {
  for (const status of STATUS_COLUMNS) {
    const list = document.querySelector(`.task-list[data-status="${status}"]`);
    const count = document.getElementById(`count-${status}`);
    list.innerHTML = '';
    const colTasks = tasks.filter(t => t.status === status);
    count.textContent = colTasks.length;

    colTasks.forEach(task => {
      list.appendChild(createTaskCard(task));
    });
  }
  const archived = tasks.filter(t => t.status === 'archived').length;
  document.getElementById('archiveCount').textContent = archived;
}

function createTaskCard(task) {
  const card = document.createElement('div');
  card.className = 'task-card';
  card.draggable = true;
  card.dataset.id = task.id;

  const dateChips = [];
  if (task.shamsi_date) {
    const remaining = remainingDaysLabel(task.miladi_date || shamsiToMiladi(task.shamsi_date));
    dateChips.push(`<span class="date-chip" title="Shamsi deadline">Deadline ${escapeHtml(task.shamsi_date)}${remaining ? ` <span class="remaining-days ${remaining.includes('overdue') ? 'overdue' : ''}">· ${escapeHtml(remaining)}</span>` : ''}</span>`);
  }
  if (task.miladi_date) dateChips.push(`<span class="date-chip secondary-date" title="Gregorian deadline">${escapeHtml(task.miladi_date)}</span>`);

  const fieldBadges = [];
  if (task.custom_fields) {
    for (const [key, val] of Object.entries(task.custom_fields)) {
      if (val) fieldBadges.push(`<span class="field-badge">${escapeHtml(key)}: ${escapeHtml(String(val))}</span>`);
    }
  }

  card.innerHTML = `
    <div class="task-card-title">${escapeHtml(task.title)}</div>
    ${dateChips.length ? `<div class="task-card-date">${dateChips.join('')}</div>` : ''}
    ${fieldBadges.length ? `<div class="task-card-badges">${fieldBadges.join('')}</div>` : ''}
  `;

  card.addEventListener('click', () => openModal(task));
  return card;
}

// ─── Drag and Drop ──────────────────────────────────
function setupDragAndDrop() {
  document.querySelectorAll('.task-list').forEach(list => {
    list.addEventListener('dragover', (e) => {
      e.preventDefault();
      list.classList.add('drag-over');
    });
    list.addEventListener('dragleave', () => list.classList.remove('drag-over'));
    list.addEventListener('drop', async (e) => {
      e.preventDefault();
      list.classList.remove('drag-over');
      const taskId = e.dataTransfer.getData('text/plain');
      const newStatus = list.dataset.status;
      await window.api.tasks.update(taskId, { status: newStatus });
      await loadTasks();
      renderBoard();
    });
  });

  // Use event delegation for cards
  document.addEventListener('dragstart', (e) => {
    if (e.target.classList.contains('task-card')) {
      e.target.classList.add('dragging');
      e.dataTransfer.setData('text/plain', e.target.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
    }
  });
  document.addEventListener('dragend', (e) => {
    if (e.target.classList.contains('task-card')) {
      e.target.classList.remove('dragging');
    }
  });
}

// ─── Modal ──────────────────────────────────────────
function setupEventListeners() {
  document.getElementById('dismissUpdateBtn').addEventListener('click', () => {
    document.getElementById('updateBanner').classList.add('hidden');
  });
  document.getElementById('addTaskBtn').addEventListener('click', () => openModal());
  document.getElementById('archiveDoneBtn').addEventListener('click', archiveDoneTasks);
  document.getElementById('viewArchiveBtn').addEventListener('click', openArchive);
  document.getElementById('closeArchive').addEventListener('click', closeArchive);
  document.getElementById('archiveOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'archiveOverlay') closeArchive();
  });
  document.querySelectorAll('.add-to-column').forEach(btn => {
    btn.addEventListener('click', () => openModal(null, btn.dataset.status));
  });
  document.getElementById('closeModal').addEventListener('click', closeModal);
  document.getElementById('cancelBtn').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'modalOverlay') closeModal();
  });

  document.getElementById('taskForm').addEventListener('submit', handleSubmit);
  document.getElementById('deleteTaskBtn').addEventListener('click', handleDelete);
  document.getElementById('addFieldBtn').addEventListener('click', () => addCustomField());
  document.getElementById('saveDraftBtn').addEventListener('click', () => persistDraft(true));
  document.getElementById('revertDraftBtn').addEventListener('click', revertDraft);
  document.getElementById('taskForm').addEventListener('input', scheduleDraftSave);

  // Live Shamsi → Miladi conversion
  document.getElementById('taskShamsi').addEventListener('input', updateMiladiLabel);
  document.getElementById('taskShamsi').addEventListener('blur', formatShamsiInput);

  setupMarkdownToolbar();
}

async function checkForUpdates() {
  try {
    const update = await window.api.app.checkForUpdate();
    if (!isNewerVersion(update.latestVersion, update.currentVersion)) return;
    document.getElementById('updateMessage').textContent = `Version ${update.latestVersion} is ready (you have ${update.currentVersion}).`;
    document.getElementById('updateNowBtn').onclick = () => window.api.app.openRelease(update.releaseUrl);
    document.getElementById('updateBanner').classList.remove('hidden');
  } catch (error) {
    console.info('Update check unavailable:', error.message);
  }
}

function isNewerVersion(candidate, current) {
  const parse = value => String(value).split('.').map(part => Number.parseInt(part, 10) || 0);
  const latest = parse(candidate);
  const installed = parse(current);
  for (let index = 0; index < Math.max(latest.length, installed.length); index++) {
    if ((latest[index] || 0) > (installed[index] || 0)) return true;
    if ((latest[index] || 0) < (installed[index] || 0)) return false;
  }
  return false;
}

async function openModal(task = null, presetStatus = 'todo') {
  editingTaskId = task ? task.id : null;
  newTaskStatus = presetStatus;
  editingBaseTask = task ? structuredClone(task) : null;
  draftDirty = false;
  clearTimeout(draftTimer);
  document.getElementById('modalTitle').textContent = task ? 'Edit Task' : 'New Task';
  document.getElementById('taskId').value = task?.id || '';
  document.getElementById('taskTitle').value = task?.title || '';
  document.getElementById('taskDescription').value = task?.description || '';
  document.getElementById('deleteTaskBtn').classList.toggle('hidden', !task);
  document.getElementById('saveDraftBtn').classList.toggle('hidden', !task);
  document.getElementById('revertDraftBtn').classList.add('hidden');
  setDraftStatus('', true);

  // Dates: auto-fill today for new tasks; use existing for edits
  if (task?.shamsi_date) {
    document.getElementById('taskShamsi').value = task.shamsi_date;
  } else {
    document.getElementById('taskShamsi').value = todayShamsi();
  }
  updateMiladiLabel();

  // Timestamps: show for existing tasks
  const timestampsEl = document.getElementById('timestamps');
  if (task?.created_at) {
    timestampsEl.classList.remove('hidden');
    document.getElementById('createdAtLabel').textContent = `Created: ${task.created_at}`;
    document.getElementById('updatedAtLabel').textContent = `Updated: ${task.updated_at || task.created_at}`;
  } else {
    timestampsEl.classList.add('hidden');
  }

  // Custom fields
  const container = document.getElementById('customFieldsContainer');
  container.innerHTML = '';
  if (task?.custom_fields) {
    for (const [key, val] of Object.entries(task.custom_fields)) {
      addCustomField(key, val, true);
    }
  }

  // Reset preview
  isPreviewMode = false;
  document.getElementById('mdPreview').classList.add('hidden');
  document.getElementById('taskDescription').classList.remove('hidden');
  document.getElementById('previewBtn').classList.remove('active');

  document.getElementById('modalOverlay').classList.remove('hidden');
  if (task) {
    const draft = await window.api.tasks.getDraft(task.id);
    if (editingTaskId !== task.id) return;
    if (draft?.data) {
      populateForm(draft.data);
      document.getElementById('revertDraftBtn').classList.remove('hidden');
      setDraftStatus(`Draft from ${formatTimestamp(draft.updated_at)}`);
    }
  }
  setTimeout(() => document.getElementById('taskTitle').focus(), 50);
}

async function closeModal() {
  if (draftDirty && editingTaskId) await persistDraft(false);
  clearTimeout(draftTimer);
  document.getElementById('modalOverlay').classList.add('hidden');
  editingTaskId = null;
  editingBaseTask = null;
}

function populateForm(data) {
  document.getElementById('taskTitle').value = data.title || '';
  document.getElementById('taskDescription').value = data.description || '';
  document.getElementById('taskShamsi').value = data.shamsi_date || '';
  updateMiladiLabel();
  const container = document.getElementById('customFieldsContainer');
  container.innerHTML = '';
  for (const [key, val] of Object.entries(data.custom_fields || {})) addCustomField(key, val);
}

function collectFormData() {
  const customFields = {};
  document.querySelectorAll('.custom-field-row').forEach(row => {
    const key = row.querySelector('.field-label-input').value.trim();
    const val = row.querySelector('.field-value-input').value.trim();
    if (key) customFields[key] = val;
  });

  const shamsi = document.getElementById('taskShamsi').value.trim();
  const miladi = shamsiToMiladi(shamsi) || '';

  return {
    id: document.getElementById('taskId').value || null,
    title: document.getElementById('taskTitle').value.trim(),
    description: document.getElementById('taskDescription').value,
    shamsi_date: shamsi,
    miladi_date: miladi,
    custom_fields: customFields,
    status: newTaskStatus,
  };
}

/** Update the Miladi read-only label when Shamsi changes */
function updateMiladiLabel() {
  const shamsi = document.getElementById('taskShamsi').value.trim();
  const miladi = shamsiToMiladi(shamsi);
  document.getElementById('taskMiladiLabel').textContent = miladi || '--';
}

/** Auto-format Shamsi: "14030515" -> "1403/05/15", "1403/5/1" -> "1403/05/01" */
function formatShamsiInput() {
  const input = document.getElementById('taskShamsi');
  let val = input.value.trim().replace(/\D/g, '');
  if (val.length >= 5 && val.length <= 8) {
    if (val.length === 5) val = val.slice(0, 4) + '0' + val.slice(4); // e.g. 14031 -> 140301
    if (val.length === 6) val = val.slice(0, 6) + '0' + val.slice(6); // e.g. 140301 -> 1403010
    if (val.length === 7) val = val.slice(0, 6) + '0' + val.slice(6);
    val = val.slice(0, 4) + '/' + val.slice(4, 6) + '/' + val.slice(6, 8);
  }
  if (val !== input.value.trim().replace(/\D/g, '')) {
    input.value = val;
    updateMiladiLabel();
  }
}

async function handleSubmit(e) {
  e.preventDefault();
  const data = collectFormData();
  if (!data.title) return;
  clearTimeout(draftTimer);
  await saveTask({ ...data, id: editingTaskId });
  if (editingTaskId) await window.api.tasks.deleteDraft(editingTaskId);
  draftDirty = false;
  closeModal();
  await loadTasks();
 renderBoard();
}

function scheduleDraftSave() {
  if (!editingTaskId) return;
  draftDirty = true;
  setDraftStatus('Saving draft…');
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => persistDraft(false), 650);
}

async function persistDraft(showConfirmation = false) {
  if (!editingTaskId) return;
  clearTimeout(draftTimer);
  await window.api.tasks.saveDraft(editingTaskId, collectFormData());
  draftDirty = false;
  document.getElementById('revertDraftBtn').classList.remove('hidden');
  setDraftStatus(showConfirmation ? 'Draft saved' : 'Draft autosaved');
}

async function revertDraft() {
  if (!editingTaskId || !editingBaseTask) return;
  clearTimeout(draftTimer);
  await window.api.tasks.deleteDraft(editingTaskId);
  populateForm(editingBaseTask);
  draftDirty = false;
  document.getElementById('revertDraftBtn').classList.add('hidden');
  setDraftStatus('Draft reverted');
}

function setDraftStatus(message, hide = false) {
  const status = document.getElementById('draftStatus');
  status.textContent = message;
  status.classList.toggle('hidden', hide || !message);
}

function formatTimestamp(value) {
  if (!value) return 'earlier';
  const parsed = new Date(value.replace(' ', 'T') + 'Z');
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

async function archiveDoneTasks() {
  const doneCount = tasks.filter(t => t.status === 'done').length;
  if (!doneCount) return;
  await window.api.tasks.archiveAllDone();
  await loadTasks();
  renderBoard();
}

function openArchive() {
  renderArchive();
  document.getElementById('archiveOverlay').classList.remove('hidden');
}

function closeArchive() {
  document.getElementById('archiveOverlay').classList.add('hidden');
}

function renderArchive() {
  const list = document.getElementById('archiveList');
  const archived = tasks.filter(t => t.status === 'archived');
  if (!archived.length) {
    list.innerHTML = '<div class="empty-state"><span>✓</span><strong>Archive is empty</strong><p>Completed tasks you archive will appear here.</p></div>';
    return;
  }
  list.innerHTML = '';
  archived.forEach(task => {
    const item = document.createElement('article');
    item.className = 'archive-item';
    item.innerHTML = `<div><strong>${escapeHtml(task.title)}</strong>${task.shamsi_date ? `<span>Deadline ${escapeHtml(task.shamsi_date)}</span>` : ''}</div><button class="btn btn-secondary btn-sm">Restore to Done</button>`;
    item.querySelector('button').addEventListener('click', async () => {
      await window.api.tasks.update(task.id, { status: 'done' });
      await loadTasks();
      renderBoard();
      renderArchive();
    });
    list.appendChild(item);
  });
}

async function handleDelete() {
  if (!editingTaskId) return;
  if (!confirm('Delete this task?')) return;
  await window.api.tasks.delete(editingTaskId);
  closeModal();
  await loadTasks();
  renderBoard();
}

// ─── Custom Fields ──────────────────────────────────
function addCustomField(key = '', val = '', saved = false) {
  const container = document.getElementById('customFieldsContainer');
  const row = document.createElement('div');
  row.className = 'custom-field-row';
  row.innerHTML = `
    <input type="text" class="field-label-input" placeholder="Field name" value="${escapeHtml(key)}">
    <input type="text" class="field-value-input" placeholder="Value" value="${escapeHtml(val)}">
    <div class="field-link-actions hidden">
      <button type="button" class="btn btn-secondary btn-sm preview-link">Preview</button>
      <button type="button" class="btn btn-ghost btn-sm edit-link">Edit</button>
    </div>
    <button type="button" class="btn-icon remove-field">✕</button>
  `;
  const valueInput = row.querySelector('.field-value-input');
  const linkActions = row.querySelector('.field-link-actions');
  if (saved && isWebLink(val)) {
    valueInput.classList.add('saved-link-value');
    valueInput.readOnly = true;
    linkActions.classList.remove('hidden');
  }
  row.querySelector('.preview-link').addEventListener('click', async () => {
    if (isWebLink(valueInput.value.trim())) {
      await window.api.app.openExternal(valueInput.value.trim());
    }
  });
  row.querySelector('.edit-link').addEventListener('click', () => {
    valueInput.readOnly = false;
    valueInput.classList.remove('saved-link-value');
    linkActions.classList.add('hidden');
    valueInput.focus();
    valueInput.select();
  });
  row.querySelector('.remove-field').addEventListener('click', () => {
    row.remove();
    scheduleDraftSave();
  });
  container.appendChild(row);
  if (!key && editingTaskId) scheduleDraftSave();
}

// ─── Markdown Toolbar ───────────────────────────────
function setupMarkdownToolbar() {
  document.querySelectorAll('.md-toolbar button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const action = btn.dataset.md;
      if (action === 'preview') {
        togglePreview();
        return;
      }
      const textarea = document.getElementById('taskDescription');
      applyMarkdown(action, textarea);
    });
  });
}

function togglePreview() {
  isPreviewMode = !isPreviewMode;
  const ta = document.getElementById('taskDescription');
  const preview = document.getElementById('mdPreview');
  const btn = document.getElementById('previewBtn');

  if (isPreviewMode) {
    preview.innerHTML = marked.parse(ta.value || '*Nothing to preview*');
    preview.classList.remove('hidden');
    ta.classList.add('hidden');
    btn.classList.add('active');
  } else {
    preview.classList.add('hidden');
    ta.classList.remove('hidden');
    btn.classList.remove('active');
  }
}

function applyMarkdown(action, textarea) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  const selected = text.substring(start, end);
  let insert = '', cursorOffset = 0;

  switch (action) {
    case 'bold': insert = `**${selected || 'bold text'}**`; break;
    case 'italic': insert = `*${selected || 'italic text'}*`; break;
    case 'h1': insert = `# ${selected || 'Heading 1'}`; break;
    case 'h2': insert = `## ${selected || 'Heading 2'}`; break;
    case 'list': insert = `- ${selected || 'item'}`; break;
    case 'code':
      insert = selected.includes('\n')
        ? '```\n' + (selected || 'code') + '\n```'
        : '`' + (selected || 'code') + '`';
      break;
    case 'link': insert = `[${selected || 'link text'}](https://)`; break;
  }

  textarea.value = text.substring(0, start) + insert + text.substring(end);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  const newPos = start + insert.length;
  textarea.focus();
  textarea.setSelectionRange(newPos, newPos);
}

// ─── Helpers ────────────────────────────────────────
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
