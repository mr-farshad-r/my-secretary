// ─── State ──────────────────────────────────────────
let tasks = [];
let categories = [];
const categoryFilters = { todo: 'all', wip: 'all', done: 'all' };
let editingTaskId = null;
let isPreviewMode = false;
let editingBaseTask = null;
let draftTimer = null;
let draftDirty = false;
let newTaskColumn = 'todo';
let dragPlaceholder = null;
const MOTION_SETTING_KEY = 'my-secretary:motion-enabled';
const ICS_URL_KEY = 'my-secretary:ics-url';
let calendarMonth = null;
let icsEvents = [];
const notifiedEvents = new Set();

const STATUS_COLUMNS = ['todo', 'wip', 'done'];
const STATUS_LABELS = { pending: 'PENDING', wip: 'WIP', canceled: 'CANCELED' };

function normalizeStatus(status) {
  if (status === 'inprogress') return 'wip';
  return ['wip', 'pending', 'canceled'].includes(status) ? status : 'pending';
}

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
  applyMotionSetting(localStorage.getItem(MOTION_SETTING_KEY) !== 'false');
  await Promise.all([loadTasks(), loadCategories()]);
  renderCategoryOptions();
  renderBoard();
  showToday();
  goToCurrentMonth();
  setupEventListeners();
  setupDragAndDrop();
  checkForUpdates();
  refreshIcs();
  setInterval(refreshIcs, 5 * 60 * 1000);
  setInterval(showToday, 60 * 1000);
  setInterval(checkEventReminders, 30 * 1000);
});

// ─── Data ───────────────────────────────────────────
async function loadTasks() {
  tasks = await window.api.tasks.getAll();
}

async function loadCategories() {
  categories = await window.api.categories.getAll();
}

async function saveTask(data) {
  if (data.id) {
    return window.api.tasks.update(data.id, {
      title: data.title,
      description: data.description,
      status: data.status,
      column_status: data.column_status,
      priority: data.priority,
      category_id: data.category_id,
      shamsi_date: data.shamsi_date,
      miladi_date: data.miladi_date,
      deadline_time: data.deadline_time,
      custom_fields: data.custom_fields,
    });
  }
  return window.api.tasks.create({
    title: data.title,
    description: data.description,
    status: data.status || 'pending',
    column_status: data.column_status || 'todo',
    priority: data.priority || 'medium',
    category_id: data.category_id,
    shamsi_date: data.shamsi_date,
    miladi_date: data.miladi_date,
    deadline_time: data.deadline_time,
    custom_fields: data.custom_fields,
  });
}

// ─── Render ─────────────────────────────────────────
function renderBoard() {
  for (const status of STATUS_COLUMNS) {
    const list = document.querySelector(`.task-list[data-status="${status}"]`);
    const count = document.getElementById(`count-${status}`);
    list.innerHTML = '';
    const filter = categoryFilters[status];
    const colTasks = tasks.filter(t => (t.column_status || 'todo') === status)
      .filter(t => filter === 'all' || (filter === 'none' ? !t.category_id : t.category_id === filter));
    count.textContent = colTasks.length;

    colTasks.forEach(task => {
      list.appendChild(createTaskCard(task));
    });
  }
  const archived = tasks.filter(t => t.column_status === 'archived').length;
  document.getElementById('archiveCount').textContent = archived;
  if (calendarMonth) renderCalendar();
}

function showToday() {
  document.getElementById('currentDate').textContent = `${todayShamsi()} · ${todayMiladi()}`;
  document.getElementById('taskShamsi').placeholder = todayShamsi();
}

function goToCurrentMonth() {
  const [year, month] = todayShamsi().split('/').map(Number);
  calendarMonth = { year, month };
  renderCalendar();
}

function changeCalendarMonth(offset) {
  calendarMonth.month += offset;
  if (calendarMonth.month > 12) { calendarMonth.year++; calendarMonth.month = 1; }
  if (calendarMonth.month < 1) { calendarMonth.year--; calendarMonth.month = 12; }
  renderCalendar();
}

function renderCalendar() {
  const { year, month } = calendarMonth;
  const days = jalaali.jalaaliMonthLength(year, month);
  const firstMiladi = shamsiToMiladi(`${year}/${month}/1`);
  const lastMiladi = shamsiToMiladi(`${year}/${month}/${days}`);
  const first = new Date(`${firstMiladi}T00:00:00`);
  const leadingDays = (first.getDay() + 1) % 7;
  const cells = Math.ceil((leadingDays + days) / 7) * 7;
  const start = new Date(first);
  start.setDate(start.getDate() - leadingDays);

  document.getElementById('calendarMonth').textContent = `${year}/${String(month).padStart(2, '0')}`;
  document.getElementById('calendarMiladiRange').textContent = `${firstMiladi} — ${lastMiladi}`;
  const grid = document.getElementById('calendarGrid');
  grid.innerHTML = '';

  for (let index = 0; index < cells; index++) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const miladi = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const shamsi = miladiToShamsi(miladi);
    const [jy, jm, jd] = shamsi.split('/').map(Number);
    const day = document.createElement('section');
    day.className = `calendar-day${jm !== month || jy !== year ? ' outside' : ''}${miladi === todayMiladi() ? ' today' : ''}`;
    day.innerHTML = `<div class="calendar-date"><strong>${jd}</strong><small>${miladi}</small></div>`;
    tasks.filter(task => task.miladi_date === miladi && task.column_status !== 'archived').forEach(task => {
      const item = document.createElement('button');
      item.className = 'calendar-event';
      item.textContent = `${task.deadline_time ? `${task.deadline_time} ` : ''}${task.title}`;
      item.title = task.title;
      item.addEventListener('click', () => openModal(task));
      day.appendChild(item);
    });
    icsEvents.filter(event => event.date === miladi).forEach(event => {
      const item = document.createElement('button');
      item.className = 'calendar-event ics';
      item.textContent = `${event.time ? `${event.time} ` : ''}${event.title}`;
      item.title = event.title;
      item.addEventListener('click', () => openCalendarEvent(event));
      day.appendChild(item);
    });
    grid.appendChild(day);
  }
}

async function refreshIcs() {
  const url = localStorage.getItem(ICS_URL_KEY);
  if (!url) { icsEvents = []; renderCalendar(); return; }
  try {
    icsEvents = await window.api.calendar.fetchIcs(url);
    renderCalendar();
    checkEventReminders();
  } catch (error) {
    console.info('Calendar feed unavailable:', error.message);
  }
}

function checkEventReminders() {
  const now = Date.now();
  const upcoming = icsEvents.filter(event => event.startAt).map(event => ({
    id: event.id || `${event.date}:${event.time}:${event.title}`,
    title: event.title,
    time: event.time,
    startAt: new Date(event.startAt).getTime(),
  }));
  tasks.filter(task => task.miladi_date && task.deadline_time && task.column_status !== 'archived').forEach(task => {
    upcoming.push({
      id: `task:${task.id}:${task.miladi_date}:${task.deadline_time}`,
      title: task.title,
      time: task.deadline_time,
      startAt: new Date(`${task.miladi_date}T${task.deadline_time}:00`).getTime(),
    });
  });
  upcoming.forEach(event => {
    const remaining = event.startAt - now;
    if (remaining > 0 && remaining <= 5 * 60 * 1000 && !notifiedEvents.has(event.id)) {
      notifiedEvents.add(event.id);
      window.api.calendar.notify(event.title, event.time);
    }
  });
}

function setView(view) {
  const calendar = view === 'calendar';
  document.getElementById('board').classList.toggle('hidden', calendar);
  document.getElementById('calendar').classList.toggle('hidden', !calendar);
  document.getElementById('boardViewBtn').classList.toggle('active', !calendar);
  document.getElementById('calendarViewBtn').classList.toggle('active', calendar);
  if (calendar) renderCalendar();
}

function openCalendarEvent(event) {
  document.getElementById('calendarEventTitle').textContent = event.title;
  document.getElementById('calendarEventShamsi').textContent = miladiToShamsi(event.date);
  document.getElementById('calendarEventMiladi').textContent = event.date;
  document.getElementById('calendarEventTime').textContent = event.time ? `${event.time}${event.endTime ? `–${event.endTime}` : ''}` : 'All day';
  document.getElementById('calendarEventLocation').textContent = event.location || '';
  document.getElementById('calendarEventLocationRow').classList.toggle('hidden', !event.location);
  const description = document.getElementById('calendarEventDescription');
  description.textContent = event.description || 'No description.';
  document.getElementById('calendarEventOverlay').classList.remove('hidden');
}

function closeCalendarEvent() {
  document.getElementById('calendarEventOverlay').classList.add('hidden');
}

function createTaskCard(task) {
  const card = document.createElement('div');
  card.className = 'task-card';
  card.draggable = true;
  card.dataset.id = task.id;

  const dateChips = [];
  if (task.shamsi_date) {
    const remaining = remainingDaysLabel(task.miladi_date || shamsiToMiladi(task.shamsi_date));
    dateChips.push(`<span class="date-chip" title="Shamsi deadline">Deadline ${escapeHtml(task.shamsi_date)}${task.deadline_time ? ` ${escapeHtml(task.deadline_time)}` : ''}${remaining ? ` <span class="remaining-days ${remaining.includes('overdue') ? 'overdue' : ''}">· ${escapeHtml(remaining)}</span>` : ''}</span>`);
  }
  if (task.miladi_date) dateChips.push(`<span class="date-chip secondary-date" title="Gregorian deadline">${escapeHtml(task.miladi_date)}</span>`);

  const customFieldCount = task.custom_fields
    ? Object.values(task.custom_fields).filter(value => value !== null && value !== undefined && String(value).trim() !== '').length
    : 0;
  const category = categories.find(item => item.id === task.category_id);

  card.innerHTML = `
    <div class="task-card-heading"><div class="task-card-title">${escapeHtml(task.title)}</div><div class="task-card-chips"><span class="priority-chip priority-${escapeHtml(task.priority || 'medium')}">${escapeHtml((task.priority || 'medium').toUpperCase())}</span><span class="status-chip status-${escapeHtml(task.status)}">${escapeHtml(STATUS_LABELS[task.status] || task.status)}</span></div></div>
    ${(dateChips.length || category) ? `<div class="task-card-meta">${category ? `<span class="category-chip">${escapeHtml(category.name)}</span>` : ''}${dateChips.join('')}</div>` : ''}
    ${customFieldCount ? `<div class="task-card-footer"><span class="field-count-badge" title="${customFieldCount} custom ${customFieldCount === 1 ? 'field' : 'fields'}">${customFieldCount} custom ${customFieldCount === 1 ? 'field' : 'fields'}</span></div>` : ''}
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
      if (!dragPlaceholder) {
        dragPlaceholder = document.createElement('div');
        dragPlaceholder.className = 'task-card-placeholder';
        dragPlaceholder.setAttribute('aria-hidden', 'true');
      }
      const beforeCard = getDragAfterElement(list, e.clientY);
      if (beforeCard) list.insertBefore(dragPlaceholder, beforeCard);
      else list.appendChild(dragPlaceholder);
    });
    list.addEventListener('dragleave', (e) => {
      if (list.contains(e.relatedTarget)) return;
      list.classList.remove('drag-over');
      if (dragPlaceholder?.parentElement === list) dragPlaceholder.remove();
    });
    list.addEventListener('drop', async (e) => {
      e.preventDefault();
      list.classList.remove('drag-over');
      const taskId = e.dataTransfer.getData('text/plain');
      const newColumn = list.dataset.status;
      let beforeCard = dragPlaceholder?.nextElementSibling || null;
      while (beforeCard?.classList.contains('dragging')) beforeCard = beforeCard.nextElementSibling;
      if (!beforeCard?.classList.contains('task-card')) beforeCard = null;
      dragPlaceholder?.remove();
      const columnTasks = tasks.filter(task => (task.column_status || 'todo') === newColumn && String(task.id) !== String(taskId));
      const beforeId = beforeCard?.dataset.id;
      const beforeIndex = beforeId ? columnTasks.findIndex(task => String(task.id) === String(beforeId)) : columnTasks.length;
      const previousOrder = beforeIndex > 0 ? Number(columnTasks[beforeIndex - 1].sort_order) : 0;
      const nextOrder = beforeIndex < columnTasks.length ? Number(columnTasks[beforeIndex].sort_order) : previousOrder + 2000;
      const sortOrder = previousOrder + ((nextOrder - previousOrder) / 2);
      await window.api.tasks.update(taskId, { column_status: newColumn, sort_order: sortOrder });
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
      dragPlaceholder?.remove();
      document.querySelectorAll('.task-list.drag-over').forEach(list => list.classList.remove('drag-over'));
    }
  });
}

function getDragAfterElement(list, y) {
  return [...list.querySelectorAll('.task-card:not(.dragging)')].reduce((closest, card) => {
    const box = card.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    return offset < 0 && offset > closest.offset ? { offset, element: card } : closest;
  }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
}

// ─── Modal ──────────────────────────────────────────
function setupEventListeners() {
  document.getElementById('boardViewBtn').addEventListener('click', () => setView('board'));
  document.getElementById('calendarViewBtn').addEventListener('click', () => setView('calendar'));
  document.getElementById('previousMonthBtn').addEventListener('click', () => changeCalendarMonth(-1));
  document.getElementById('nextMonthBtn').addEventListener('click', () => changeCalendarMonth(1));
  document.getElementById('todayBtn').addEventListener('click', goToCurrentMonth);
  document.getElementById('refreshCalendarBtn').addEventListener('click', refreshIcs);
  document.getElementById('closeCalendarEvent').addEventListener('click', closeCalendarEvent);
  document.getElementById('calendarEventOverlay').addEventListener('click', event => {
    if (event.target.id === 'calendarEventOverlay') closeCalendarEvent();
  });
  document.getElementById('dismissUpdateBtn').addEventListener('click', () => {
    document.getElementById('updateBanner').classList.add('hidden');
  });
  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  document.getElementById('categoriesBtn').addEventListener('click', openCategories);
  document.getElementById('closeCategories').addEventListener('click', closeCategories);
  document.getElementById('categoriesOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'categoriesOverlay') closeCategories();
  });
  document.getElementById('categoryForm').addEventListener('submit', addCategory);
  document.querySelectorAll('.category-filter').forEach(select => {
    select.addEventListener('change', () => {
      categoryFilters[select.dataset.status] = select.value;
      renderBoard();
    });
  });
  document.getElementById('closeSettings').addEventListener('click', closeSettings);
  document.getElementById('settingsOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'settingsOverlay') closeSettings();
  });
  document.getElementById('openAtStartup').addEventListener('change', saveStartupSetting);
  document.getElementById('motionEnabled').addEventListener('change', saveMotionSetting);
  document.getElementById('exportAllBtn').addEventListener('click', exportAllData);
  document.getElementById('importAllBtn').addEventListener('click', importAllData);
  document.getElementById('saveIcsBtn').addEventListener('click', saveIcsUrl);
  document.getElementById('checkUpdatesBtn').addEventListener('click', () => checkForUpdates(true));
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
  document.getElementById('addCommentBtn').addEventListener('click', addComment);
  document.getElementById('taskForm').addEventListener('input', scheduleDraftSave);
  document.addEventListener('keydown', handleKeyboardShortcut);

  // Live Shamsi → Miladi conversion
  document.getElementById('taskShamsi').addEventListener('input', updateMiladiLabel);
  document.getElementById('taskShamsi').addEventListener('blur', formatShamsiInput);

  setupMarkdownToolbar();
}

async function checkForUpdates(manual = false) {
  const button = document.getElementById('checkUpdatesBtn');
  const status = document.getElementById('settingsStatus');
  if (manual) {
    button.disabled = true;
    button.textContent = 'Checking…';
    status.textContent = 'Checking for updates…';
  }
  try {
    const update = await window.api.app.checkForUpdate();
    if (!isNewerVersion(update.latestVersion, update.currentVersion)) {
      if (manual) status.textContent = `You are up to date (version ${update.currentVersion}).`;
      return;
    }
    document.getElementById('updateMessage').textContent = `Version ${update.latestVersion} is ready (you have ${update.currentVersion}).`;
    document.getElementById('updateNowBtn').onclick = () => window.api.app.openRelease(update.releaseUrl);
    document.getElementById('updateBanner').classList.remove('hidden');
    if (manual) status.textContent = `Version ${update.latestVersion} is available.`;
  } catch (error) {
    console.info('Update check unavailable:', error.message);
    if (manual) status.textContent = `Update check failed: ${error.message}`;
  } finally {
    if (manual) {
      button.disabled = false;
      button.textContent = 'Check';
    }
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

async function openModal(task = null, presetColumn = 'todo') {
  editingTaskId = task ? task.id : null;
  newTaskColumn = presetColumn;
  editingBaseTask = task ? structuredClone(task) : null;
  draftDirty = false;
  clearTimeout(draftTimer);
  document.getElementById('modalTitle').textContent = task ? 'Edit Task' : 'New Task';
  document.getElementById('taskId').value = task?.id || '';
  document.getElementById('taskTitle').value = task?.title || '';
  document.getElementById('taskDescription').value = task?.description || '';
  document.getElementById('taskStatus').value = normalizeStatus(task?.status);
  document.getElementById('taskPriority').value = task?.priority || 'medium';
  document.getElementById('taskCategory').value = task?.category_id || '';
  document.getElementById('deleteTaskBtn').classList.toggle('hidden', !task);
  document.getElementById('saveDraftBtn').classList.toggle('hidden', !task);
  document.getElementById('revertDraftBtn').classList.add('hidden');
  setDraftStatus('', true);

  document.getElementById('taskShamsi').value = task?.shamsi_date || '';
  document.getElementById('taskDeadlineTime').value = task?.deadline_time || '';
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

  setPreviewMode(false);

  document.getElementById('modalOverlay').classList.remove('hidden');
  const commentsSection = document.getElementById('commentsSection');
  commentsSection.classList.toggle('hidden', !task);
  document.getElementById('commentBody').value = '';
  if (task) await loadComments(task.id);
  if (task) {
    const draft = await window.api.tasks.getDraft(task.id);
    if (editingTaskId !== task.id) return;
    if (draft?.data) {
      populateForm(draft.data);
      document.getElementById('revertDraftBtn').classList.remove('hidden');
      setDraftStatus(`Draft from ${formatTimestamp(draft.updated_at)}`);
    }
  }
  setPreviewMode(Boolean(document.getElementById('taskDescription').value.trim()));
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
  document.getElementById('taskStatus').value = normalizeStatus(data.status);
  document.getElementById('taskPriority').value = data.priority || 'medium';
  document.getElementById('taskCategory').value = data.category_id || '';
  document.getElementById('taskShamsi').value = data.shamsi_date || '';
  document.getElementById('taskDeadlineTime').value = data.deadline_time || '';
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
  const miladi = shamsiToMiladi(shamsi);

  return {
    id: document.getElementById('taskId').value || null,
    title: document.getElementById('taskTitle').value.trim(),
    description: document.getElementById('taskDescription').value,
    shamsi_date: shamsi || null,
    miladi_date: miladi,
    deadline_time: document.getElementById('taskDeadlineTime').value || null,
    category_id: document.getElementById('taskCategory').value || null,
    custom_fields: customFields,
    status: document.getElementById('taskStatus').value || 'pending',
    column_status: editingBaseTask?.column_status || newTaskColumn,
    priority: document.getElementById('taskPriority').value || 'medium',
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

function scheduleDraftSave(event) {
  if (event?.target?.id === 'commentBody') return;
  if (!editingTaskId) return;
  draftDirty = true;
  setDraftStatus('Saving draft…');
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => persistDraft(false), 650);
}

async function loadComments(taskId) {
  const comments = await window.api.comments.getAll(taskId);
  const list = document.getElementById('commentsList');
  if (!comments.length) {
    list.innerHTML = '<p class="comments-empty">No comments yet.</p>';
    return;
  }
  list.innerHTML = comments.map(comment => `
    <article class="comment-item">
      <div class="comment-header">
        <time class="comment-time">${escapeHtml(comment.shamsi_created_at)}</time>
        <button type="button" class="delete-comment" data-comment-id="${escapeHtml(comment.id)}" aria-label="Delete comment" title="Delete comment">Delete</button>
      </div>
      <div class="comment-body">${escapeHtml(comment.body)}</div>
    </article>
  `).join('');
  list.querySelectorAll('.delete-comment').forEach(button => {
    button.addEventListener('click', () => deleteComment(button.dataset.commentId));
  });
}

async function addComment() {
  if (!editingTaskId) return;
  const input = document.getElementById('commentBody');
  const body = input.value.trim();
  if (!body) return;
  const button = document.getElementById('addCommentBtn');
  button.disabled = true;
  try {
    await window.api.comments.add(editingTaskId, body);
    input.value = '';
    await loadComments(editingTaskId);
  } finally {
    button.disabled = false;
  }
}

async function deleteComment(commentId) {
  if (!editingTaskId || !commentId) return;
  if (!confirm('Delete this comment?')) return;
  await window.api.comments.delete(editingTaskId, commentId);
  await loadComments(editingTaskId);
}

async function openSettings() {
  const status = document.getElementById('settingsStatus');
  status.textContent = '';
  document.getElementById('settingsOverlay').classList.remove('hidden');
  document.getElementById('icsUrl').value = localStorage.getItem(ICS_URL_KEY) || '';
  try {
    const settings = await window.api.settings.get();
    document.getElementById('openAtStartup').checked = Boolean(settings.openAtLogin);
    document.getElementById('motionEnabled').checked = !document.body.classList.contains('reduce-motion');
  } catch (error) {
    status.textContent = `Could not load setting: ${error.message}`;
  }
}

async function saveIcsUrl() {
  const input = document.getElementById('icsUrl');
  const url = input.value.trim();
  const status = document.getElementById('settingsStatus');
  if (url && !isWebLink(url)) { status.textContent = 'Enter a valid HTTP or HTTPS calendar URL.'; return; }
  localStorage.setItem(ICS_URL_KEY, url);
  status.textContent = url ? 'Calendar link saved.' : 'Calendar link removed.';
  await refreshIcs();
}

function applyMotionSetting(enabled) {
  document.body.classList.toggle('reduce-motion', !enabled);
}

function saveMotionSetting(event) {
  const enabled = event.target.checked;
  localStorage.setItem(MOTION_SETTING_KEY, String(enabled));
  applyMotionSetting(enabled);
}

async function exportAllData() {
  const button = document.getElementById('exportAllBtn');
  const status = document.getElementById('settingsStatus');
  button.disabled = true;
  button.textContent = 'Exporting…';
  status.textContent = '';
  try {
    const result = await window.api.settings.exportAll();
    status.textContent = result.canceled ? '' : 'Backup exported successfully.';
  } catch (error) {
    status.textContent = `Export failed: ${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = 'Export';
  }
}

async function importAllData() {
  const button = document.getElementById('importAllBtn');
  const status = document.getElementById('settingsStatus');
  button.disabled = true;
  button.textContent = 'Importing…';
  status.textContent = '';
  try {
    const result = await window.api.settings.importAll();
    if (result.canceled) return;
    await Promise.all([loadTasks(), loadCategories()]);
    renderCategoryOptions();
    renderBoard();
    const { tasks: taskCount, categories: categoryCount } = result.counts;
    status.textContent = `Imported ${taskCount} tasks and ${categoryCount} categories.`;
  } catch (error) {
    status.textContent = `Import failed: ${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = 'Import';
  }
}

function closeSettings() {
  document.getElementById('settingsOverlay').classList.add('hidden');
}

async function saveStartupSetting(event) {
  const checkbox = event.target;
  const status = document.getElementById('settingsStatus');
  checkbox.disabled = true;
  status.textContent = 'Saving…';
  try {
    const saved = await window.api.settings.setOpenAtLogin(checkbox.checked);
    checkbox.checked = Boolean(saved.openAtLogin);
    status.textContent = 'Setting saved.';
  } catch (error) {
    checkbox.checked = !checkbox.checked;
    status.textContent = `Could not save setting: ${error.message}`;
  } finally {
    checkbox.disabled = false;
  }
}

function renderCategoryOptions() {
  const taskSelect = document.getElementById('taskCategory');
  const currentTaskCategory = taskSelect?.value || '';
  if (taskSelect) {
    taskSelect.innerHTML = '<option value="">No category</option>' + categories.map(category =>
      `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`
    ).join('');
    taskSelect.value = categories.some(category => category.id === currentTaskCategory) ? currentTaskCategory : '';
  }
  document.querySelectorAll('.category-filter').forEach(select => {
    const status = select.dataset.status;
    const current = categoryFilters[status];
    select.innerHTML = '<option value="all">All categories</option><option value="none">No category</option>' + categories.map(category =>
      `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`
    ).join('');
    categoryFilters[status] = [...select.options].some(option => option.value === current) ? current : 'all';
    select.value = categoryFilters[status];
  });
}

function openCategories() {
  document.getElementById('categoriesStatus').textContent = '';
  renderCategoriesList();
  document.getElementById('categoriesOverlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('newCategoryName').focus(), 50);
}

function closeCategories() {
  document.getElementById('categoriesOverlay').classList.add('hidden');
}

function renderCategoriesList() {
  const list = document.getElementById('categoriesList');
  if (!categories.length) {
    list.innerHTML = '<p class="comments-empty">No categories yet.</p>';
    return;
  }
  list.innerHTML = '';
  categories.forEach(category => {
    const row = document.createElement('div');
    row.className = 'category-row';
    row.innerHTML = `<input type="text" value="${escapeHtml(category.name)}" maxlength="80" aria-label="Category name"><button class="btn btn-secondary btn-sm save-category">Save</button><button class="btn btn-danger btn-sm delete-category">Delete</button>`;
    row.querySelector('.save-category').addEventListener('click', () => renameCategory(category.id, row.querySelector('input').value));
    row.querySelector('.delete-category').addEventListener('click', () => removeCategory(category));
    list.appendChild(row);
  });
}

async function addCategory(event) {
  event.preventDefault();
  const input = document.getElementById('newCategoryName');
  await mutateCategories(() => window.api.categories.create(input.value));
  input.value = '';
  input.focus();
}

async function renameCategory(id, name) {
  await mutateCategories(() => window.api.categories.update(id, name));
}

async function removeCategory(category) {
  if (!confirm(`Delete category “${category.name}”? Tasks in it will become uncategorized.`)) return;
  await mutateCategories(() => window.api.categories.delete(category.id));
}

async function mutateCategories(action) {
  const status = document.getElementById('categoriesStatus');
  try {
    await action();
    await Promise.all([loadCategories(), loadTasks()]);
    renderCategoryOptions();
    renderCategoriesList();
    renderBoard();
    status.textContent = '';
  } catch (error) {
    status.textContent = error.message.includes('UNIQUE') ? 'A category with that name already exists.' : error.message;
  }
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
  const doneCount = tasks.filter(t => t.column_status === 'done').length;
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
  const archived = tasks.filter(t => t.column_status === 'archived');
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
      await window.api.tasks.update(task.id, { column_status: 'done' });
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
  setPreviewMode(!isPreviewMode);
}

function setPreviewMode(enabled) {
  isPreviewMode = enabled;
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

function handleKeyboardShortcut(event) {
  const modifier = event.metaKey || event.ctrlKey;
  if (modifier && event.key.toLowerCase() === 'n') {
    event.preventDefault();
    openModal();
  } else if (modifier && event.key === 'Enter' && !document.getElementById('modalOverlay').classList.contains('hidden')) {
    event.preventDefault();
    document.getElementById('taskForm').requestSubmit();
  } else if (event.key === 'Escape') {
    if (!document.getElementById('modalOverlay').classList.contains('hidden')) closeModal();
    else if (!document.getElementById('calendarEventOverlay').classList.contains('hidden')) closeCalendarEvent();
    else if (!document.getElementById('archiveOverlay').classList.contains('hidden')) closeArchive();
    else if (!document.getElementById('settingsOverlay').classList.contains('hidden')) closeSettings();
    else if (!document.getElementById('categoriesOverlay').classList.contains('hidden')) closeCategories();
  }
}
