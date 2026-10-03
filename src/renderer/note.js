// One note, saved synchronously so closing the window cannot lose pending edits.
const NOTE_KEY = 'my-secretary:note';
const NOTE_TEMPLATES_KEY = 'my-secretary:note-templates';
const NOTE_TEMPLATES = {
  meeting: '# Meeting notes\n\n**Date:** {{date}}\n\n## Agenda\n- \n\n## Discussion\n\n## Decisions\n- \n\n## Action items\n- [ ] \n',
  daily: '# Daily journal — {{date}}\n\n## Priorities\n- [ ] \n\n## Notes\n\n## Reflection\n',
  project: '# Project plan\n\n## Goal\n\n## Milestones\n\n| Milestone | Owner | Due date |\n| --- | --- | --- |\n| | | |\n\n## Tasks\n- [ ] \n\n## Risks\n',
};

function noteTable(rows, columns) {
  if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || rows > 100 || columns < 1 || columns > 20) {
    throw new Error('Use 1–100 rows and 1–20 columns.');
  }
  const line = cells => `| ${cells.join(' | ')} |`;
  return '\n\n' + [
    line(Array.from({ length: columns }, (_, i) => `Column ${i + 1}`)),
    line(Array(columns).fill('---')),
    ...Array.from({ length: rows }, () => line(Array(columns).fill(' '))),
  ].join('\n') + '\n\n';
}

function renderNoteMarkdown(source) {
  // Allow only Markdown's passive HTML elements and explicit safe attributes.
  const template = document.createElement('template');
  template.innerHTML = marked.parse(source, { gfm: true, breaks: true });
  const allowed = new Set('P BR HR H1 H2 H3 H4 H5 H6 STRONG EM DEL S BLOCKQUOTE UL OL LI PRE CODE A IMG TABLE THEAD TBODY TR TH TD INPUT'.split(' '));
  for (const element of template.content.querySelectorAll('*')) {
    if (!allowed.has(element.tagName)) { element.remove(); continue; }
    const attrs = Object.fromEntries([...element.attributes].map(attr => [attr.name, attr.value]));
    for (const attr of [...element.attributes]) element.removeAttribute(attr.name);
    if (element.tagName === 'A' && /^(https?:|mailto:|#)/i.test(attrs.href || '')) {
      element.setAttribute('href', attrs.href);
      element.setAttribute('rel', 'noopener noreferrer');
    }
    if (element.tagName === 'IMG' && /^https?:\/\//i.test(attrs.src || '')) {
      element.setAttribute('src', attrs.src);
      element.setAttribute('alt', attrs.alt || '');
    }
    if (element.tagName === 'INPUT') {
      element.setAttribute('type', 'checkbox');
      element.setAttribute('disabled', '');
      if ('checked' in attrs) element.setAttribute('checked', '');
    }
    if (['TH', 'TD'].includes(element.tagName) && /^(left|center|right)$/.test(attrs.align || '')) element.setAttribute('align', attrs.align);
  }
  return template.innerHTML;
}

function noteHtml(source, direction) {
  return `<!DOCTYPE html>\n<html lang="en" dir="${direction === 'rtl' ? 'rtl' : 'ltr'}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Note</title><style>body{max-width:960px;margin:40px auto;padding:24px;font:16px/1.7 system-ui;text-align:start}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:8px}pre{direction:ltr;text-align:left;background:#f4f4f4;padding:16px;overflow:auto}img{max-width:100%}blockquote{border-inline-start:3px solid #888;padding-inline-start:16px}</style></head><body>${renderNoteMarkdown(source)}</body></html>`;
}

document.addEventListener('DOMContentLoaded', () => {
  const editor = document.getElementById('noteEditor');
  const preview = document.getElementById('notePreview');
  const direction = document.getElementById('noteDirection');
  const status = document.getElementById('noteStatus');
  try {
    const saved = JSON.parse(localStorage.getItem(NOTE_KEY) || '{}');
    editor.value = typeof saved.content === 'string' ? saved.content : '';
    direction.value = saved.direction === 'rtl' ? 'rtl' : 'ltr';
  } catch { status.textContent = 'Could not load saved note. Export before editing.'; }

  const templatePicker = document.getElementById('noteTemplate');
  const managerPicker = document.getElementById('manageNoteTemplate');
  const templateName = document.getElementById('noteTemplateName');
  const templateContent = document.getElementById('noteTemplateContent');
  const templateStatus = document.getElementById('noteTemplateStatus');
  const deleteTemplate = document.getElementById('deleteNoteTemplate');
  let templates = Object.entries(NOTE_TEMPLATES).map(([id, content]) => ({
    id, content, name: { meeting: 'Meeting notes', daily: 'Daily journal', project: 'Project plan' }[id],
  }));
  let editingTemplateId = null;
  let templatesLoadFailed = false;
  try {
    const stored = localStorage.getItem(NOTE_TEMPLATES_KEY);
    if (stored !== null) {
      const saved = JSON.parse(stored);
      if (!Array.isArray(saved) || saved.some(item => !item || typeof item.id !== 'string' ||
        typeof item.name !== 'string' || !item.name.trim() || typeof item.content !== 'string') ||
        new Set(saved.map(item => item.id)).size !== saved.length) throw new Error('Invalid templates');
      templates = saved;
    }
  } catch {
    templatesLoadFailed = true;
    templateStatus.textContent = 'Could not load templates. Template changes are disabled to protect saved data.';
    document.getElementById('noteTemplateForm').querySelectorAll('input, textarea, select, button').forEach(control => { control.disabled = true; });
  }
  function editTemplate(id) {
    const template = templates.find(item => item.id === id);
    editingTemplateId = template?.id || null;
    managerPicker.value = editingTemplateId || '';
    templateName.value = template?.name || '';
    templateContent.value = template?.content || '';
    deleteTemplate.disabled = templatesLoadFailed || !template;
  }
  function renderTemplates(selectedId) {
    for (const picker of [templatePicker, managerPicker]) {
      picker.replaceChildren(...templates.map(template => new Option(template.name, template.id)));
      if (!templates.length) picker.add(new Option('No templates', ''));
      if (templates.some(item => item.id === selectedId)) picker.value = selectedId;
    }
    document.getElementById('insertNoteTemplate').disabled = !templates.length;
    editTemplate(managerPicker.value);
  }
  function storeTemplates(next, selectedId) {
    if (templatesLoadFailed) return false;
    try {
      localStorage.setItem(NOTE_TEMPLATES_KEY, JSON.stringify(next));
      templates = next;
      renderTemplates(selectedId);
      return true;
    } catch {
      templateStatus.textContent = 'Could not save templates. Your changes are still in the form.';
      return false;
    }
  }
  managerPicker.addEventListener('change', () => { editTemplate(managerPicker.value); templateStatus.textContent = ''; });
  document.getElementById('newNoteTemplate').addEventListener('click', () => {
    editTemplate(null);
    templateStatus.textContent = 'New template';
    templateName.focus();
  });
  document.getElementById('noteTemplateForm').addEventListener('submit', event => {
    event.preventDefault();
    const name = templateName.value.trim();
    if (!name || !templateContent.value.trim()) {
      templateStatus.textContent = 'Enter a name and Markdown content.';
      return;
    }
    const updated = { id: editingTemplateId || crypto.randomUUID(), name, content: templateContent.value };
    const next = editingTemplateId ? templates.map(item => item.id === editingTemplateId ? updated : item) : [...templates, updated];
    if (storeTemplates(next, updated.id)) templateStatus.textContent = 'Template saved locally.';
  });
  deleteTemplate.addEventListener('click', () => {
    if (!editingTemplateId) return;
    if (storeTemplates(templates.filter(item => item.id !== editingTemplateId))) templateStatus.textContent = 'Template deleted.';
  });
  renderTemplates(templatePicker.value);

  function refresh() {
    editor.dir = preview.dir = direction.value;
    preview.innerHTML = renderNoteMarkdown(editor.value);
  }
  function save() {
    try {
      localStorage.setItem(NOTE_KEY, JSON.stringify({ content: editor.value, direction: direction.value }));
      status.textContent = 'Saved locally';
    } catch { status.textContent = 'Could not save. Export your note to keep a copy.'; }
    refresh();
  }
  function insert(text) {
    editor.setRangeText(text, editor.selectionStart, editor.selectionEnd, 'end');
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.focus();
  }
  editor.addEventListener('input', save);
  direction.addEventListener('change', save);
  document.getElementById('noteViewBtn').addEventListener('click', () => setView('note'));
  document.getElementById('noteLayout').addEventListener('change', event => {
    document.getElementById('noteWorkspace').dataset.layout = event.target.value;
  });
  document.getElementById('noteFormatting').addEventListener('click', event => {
    const button = event.target.closest('button');
    if (button?.dataset.format) applyMarkdown(button.dataset.format, editor);
    if (button?.dataset.insert) insert('\n' + button.dataset.insert + '\n');
  });
  document.getElementById('insertNoteTemplate').addEventListener('click', () => {
    const template = templates.find(item => item.id === templatePicker.value);
    if (template) insert('\n\n' + template.content.replaceAll('{{date}}', new Date().toLocaleDateString()) + '\n');
  });
  document.getElementById('noteTableForm').addEventListener('submit', event => {
    event.preventDefault();
    insert(noteTable(Number(document.getElementById('noteRows').value), Number(document.getElementById('noteColumns').value)));
    document.querySelector('.note-table-generator').open = false;
  });
  preview.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (!link) return;
    event.preventDefault();
    if (/^https?:/i.test(link.getAttribute('href'))) window.api.app.openExternal(link.href).catch(() => { status.textContent = 'Could not open link.'; });
  });
  function download(html) {
    const content = html ? noteHtml(editor.value, direction.value) : editor.value;
    const url = URL.createObjectURL(new Blob([content], { type: html ? 'text/html;charset=utf-8' : 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = html ? 'note.html' : 'note.md';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  document.getElementById('exportNoteMarkdown').addEventListener('click', () => download(false));
  document.getElementById('exportNoteHtml').addEventListener('click', () => download(true));
  refresh();
});
