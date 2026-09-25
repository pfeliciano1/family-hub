// Tasks: one-off to-dos for anyone in the family.
// Repeating chores with points live in chores.js (the Chores tab).
import { sb } from '../supabase.js';
import { state, update } from '../state.js';
import {
  esc, safeColor, parseDate, startOfToday, daysBetween, fmtDate, toISODate, openModal, closeModal,
} from '../utils.js';
import { run, refresh } from '../data.js';
import { tabView as choresTab, pendingCompletions } from './chores.js';

function dueInfo(t) {
  if (!t.due_date) return null;
  const date = parseDate(t.due_date);
  if (t.is_done) return { label: fmtDate(date), cls: '' };
  const d = daysBetween(startOfToday(), date);
  if (d < 0) return { label: d === -1 ? 'Yesterday' : `${-d} days late`, cls: 'overdue' };
  if (d === 0) return { label: 'Today', cls: 'today' };
  if (d === 1) return { label: 'Tomorrow', cls: '' };
  return { label: fmtDate(date, { weekday: 'short', month: 'short', day: 'numeric' }), cls: '' };
}

function sortOpen(list) {
  return [...list].sort((a, b) =>
    (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.created_at.localeCompare(b.created_at));
}

// Home shows what's due today, overdue, or has no date.
export function dashboardTasks() {
  const today = toISODate(startOfToday());
  return sortOpen(state.tasks.filter(t => !t.is_done && (!t.due_date || t.due_date <= today)));
}

export function taskRow(t, full = false) {
  const m = state.members.find(x => x.id === t.assigned_to);
  const due = dueInfo(t);
  return `<div class="task ${t.is_done ? 'done' : ''}">
    <label class="check"><input type="checkbox" data-toggle="task-done" data-id="${esc(t.id)}" ${t.is_done ? 'checked' : ''}>
      <span>${esc(t.title)}</span></label>
    <span class="task-meta">
      ${due ? `<span class="due ${due.cls}">${due.label}</span>` : ''}
      ${m ? `<span class="chip" style="--c:${safeColor(m.color)}">${esc(m.display_name)}</span>` : ''}
      ${full ? `<button class="icon-btn" data-action="task-edit" data-id="${esc(t.id)}" title="Edit" aria-label="Edit task">✏️</button>
        <button class="icon-btn" data-action="task-delete" data-id="${esc(t.id)}" title="Delete" aria-label="Delete task">🗑️</button>` : ''}
    </span>
  </div>`;
}

export function view() {
  const filter = state.taskFilter;
  const open = sortOpen(state.tasks.filter(t => !t.is_done));
  const done = state.tasks.filter(t => t.is_done).sort((a, b) => (b.done_at || '').localeCompare(a.done_at || ''));
  const list = filter === 'done' ? done : open;
  const waiting = pendingCompletions().length;
  const tabs = `<div class="tabs" role="tablist">
      <button class="${filter === 'open' ? 'active' : ''}" data-action="task-filter" data-filter="open">To do (${open.length})</button>
      <button class="${filter === 'done' ? 'active' : ''}" data-action="task-filter" data-filter="done">Done (${done.length})</button>
      <button class="${filter === 'chores' ? 'active' : ''}" data-action="task-filter" data-filter="chores">Chores${waiting ? ` <span class="badge">${waiting}</span>` : ''}</button>
    </div>`;
  if (filter === 'chores') {
    return `<div class="page-title"><h2>✅ Tasks & Chores</h2>
      <button class="btn primary" data-action="chore-new">＋ New chore</button></div>${tabs}${choresTab()}`;
  }
  return `<div class="page-title"><h2>✅ Tasks & Chores</h2>
      <button class="btn primary" data-action="task-new">＋ New task</button></div>
    ${tabs}
    <div class="panel">${list.length ? list.map(t => taskRow(t, true)).join('')
      : `<div class="empty"><p>${filter === 'done' ? 'Finished tasks will show up here.' : 'Nothing on the list. 🎉'}</p>
         ${filter === 'done' ? '' : '<button class="btn primary" data-action="task-new">Add a task</button>'}</div>`}</div>
    <p class="muted small">Repeating chores that earn points are on the Chores tab.</p>`;
}

function form(t = {}) {
  const isNew = !t.id;
  return `<h2>${isNew ? 'New task' : 'Edit task'}</h2>
    <form data-form="task-save">
      <input type="hidden" name="id" value="${esc(t.id || '')}">
      <div class="field"><label for="t-title">Task</label>
        <input id="t-title" name="title" required maxlength="200" value="${esc(t.title || '')}" placeholder="e.g., Call the dentist"></div>
      <div class="field-row">
        <div class="field"><label for="t-who">Who's doing it?</label>
          <select id="t-who" name="assigned_to"><option value="">Anyone</option>
            ${state.members.map(m => `<option value="${esc(m.id)}" ${m.id === t.assigned_to ? 'selected' : ''}>${esc(m.display_name)}</option>`).join('')}
          </select></div>
        <div class="field"><label for="t-due">Due date (optional)</label>
          <input id="t-due" type="date" name="due_date" value="${esc(t.due_date || '')}"></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">${isNew ? 'Add task' : 'Save changes'}</button>
      </div>
    </form>`;
}

export const actions = {
  'task-new': () => openModal(form()),
  'task-edit': el => openModal(form(state.tasks.find(t => t.id === el.dataset.id))),
  'task-delete': async el => {
    if (!confirm('Delete this task?')) return;
    if (await run(sb.from('tasks').delete().eq('id', el.dataset.id), 'Task deleted')) refresh('tasks');
  },
  'task-filter': el => update({ taskFilter: el.dataset.filter }),
};

export const forms = {
  'task-save': async d => {
    const row = { title: d.title.trim(), assigned_to: d.assigned_to || null, due_date: d.due_date || null };
    if (!row.title) return;
    const query = d.id
      ? sb.from('tasks').update(row).eq('id', d.id)
      : sb.from('tasks').insert({ ...row, family_id: state.me.family_id });
    if (await run(query, d.id ? 'Task saved' : 'Task added')) {
      closeModal();
      refresh('tasks');
    }
  },
};

export const toggles = {
  'task-done': async el => {
    const done = el.checked;
    await run(sb.from('tasks')
      .update({ is_done: done, done_at: done ? new Date().toISOString() : null })
      .eq('id', el.dataset.id));
    refresh('tasks');
  },
};
