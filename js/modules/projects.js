// Home Projects: fix-ups and improvements, with a to-do list and a budget.
import { sb } from '../supabase.js';
import { state, update } from '../state.js';
import {
  esc, avatar, openModal, closeModal, toast, fmtDate, parseDate, startOfToday, toISODate, daysBetween,
  cardHead, money, parseMoney, setupNotice,
} from '../utils.js';
import { run, refresh } from '../data.js';
import { everyone, memberById, memberOptions } from './kids.js';

const STAGES = [['doing', '🚧', 'In progress'], ['planned', '📋', 'Planned'], ['idea', '💡', 'Someday'], ['done', '✅', 'Done']];
const PROJECT_ICONS = ['🔨', '🎨', '🪴', '🛠️', '🚿', '🛋️', '🧱', '🪟', '🚪', '💡', '🧹', '🚗', '🏡', '🌳', '🔌', '📦'];

const tasksOf = id => state.projectTasks.filter(t => t.project_id === id);
const expensesOf = id => state.projectExpenses.filter(e => e.project_id === id);
export const spentOn = id => expensesOf(id).reduce((n, e) => n + (Number(e.amount) || 0), 0);
const projectById = id => state.projects.find(p => p.id === id);

function budgetBar(p) {
  const s = spentOn(p.id);
  const b = Number(p.budget) || 0;
  if (!b && !s) return '';
  if (!b) return `<small class="budget">${money(s)} spent</small>`;
  const pct = Math.min(100, Math.round((s / b) * 100));
  const over = s > b;
  return `<div class="budget ${over ? 'over' : ''}"><small>${money(s)} of ${money(b, true)}${over ? ` • ${money(s - b)} over` : ` • ${money(b - s)} left`}</small>
    <span class="bar"><i style="width:${pct}%"></i></span></div>`;
}

function taskLine(p) {
  const t = tasksOf(p.id);
  if (!t.length) return '';
  const done = t.filter(x => x.is_done).length;
  return `<small>✔️ ${done}/${t.length} steps</small>`;
}

function dueLine(p) {
  if (!p.target_date || p.status === 'done') return '';
  const n = daysBetween(startOfToday(), parseDate(p.target_date));
  const when = fmtDate(parseDate(p.target_date), { month: 'short', day: 'numeric' });
  return `<small class="${n < 0 ? 'late' : ''}">🎯 ${n < 0 ? `Was due ${when}` : `By ${when}`}</small>`;
}

function projectCard(p) {
  const owner = p.owner_id && memberById(p.owner_id);
  return `<button class="project-card" data-action="project-open" data-id="${esc(p.id)}">
    <div class="pc-top"><span class="recipe-ic">${esc(p.icon)}</span><b>${esc(p.title)}</b>${owner ? avatar(owner) : ''}</div>
    <div class="pc-meta">${taskLine(p)}${dueLine(p)}</div>
    ${budgetBar(p)}
  </button>`;
}

function listView() {
  const title = `<div class="page-title"><h2>🔨 Home Projects</h2>
    <button class="btn primary" data-action="project-new">＋ New project</button></div>`;
  if (state.lifeMissing) return title + setupNotice('home projects');
  if (!state.projects.length) {
    return `${title}<div class="panel empty"><div class="empty-icon">🔨</div>
      <h3>Plan the fix-ups and improvements</h3>
      <p>Paint the deck, redo the bathroom, fix the fence. Break each one into steps, set a budget, and log what you spend.</p>
      <button class="btn primary" data-action="project-new">Add a project</button></div>`;
  }
  const yearAgo = toISODate(new Date(startOfToday().getTime() - 365 * 86400e3));
  const active = state.projects.filter(p => p.status !== 'done');
  const totalBudget = active.reduce((n, p) => n + (Number(p.budget) || 0), 0);
  const totalSpent = state.projects.filter(p => p.status !== 'done' || (p.done_at || '') >= yearAgo).reduce((n, p) => n + spentOn(p.id), 0);
  return `${title}
    <p class="muted">${active.length} open project${active.length === 1 ? '' : 's'}${totalBudget ? ` • ${money(totalBudget, true)} budgeted` : ''}${totalSpent ? ` • ${money(totalSpent)} spent in the last year` : ''}</p>
    ${STAGES.map(([st, icon, label]) => {
      let list = state.projects.filter(p => p.status === st);
      if (st === 'done') list = list.sort((a, b) => (b.done_at || '').localeCompare(a.done_at || '')).slice(0, 6);
      if (!list.length) return '';
      return `<h3 class="stage">${icon} ${label} <span>${list.length}</span></h3>
        <div class="project-grid">${list.map(projectCard).join('')}</div>`;
    }).join('')}`;
}

function detailView(p) {
  const tasks = tasksOf(p.id);
  const expenses = expensesOf(p.id);
  const owner = p.owner_id && memberById(p.owner_id);
  const done = tasks.filter(t => t.is_done).length;
  return `<div class="page-title"><h2><button class="link back" data-action="project-back" aria-label="All projects">‹</button> ${esc(p.icon)} ${esc(p.title)}</h2>
      <div class="row-actions">
        <button class="btn" data-action="project-edit" data-id="${esc(p.id)}">✏️ Edit</button>
        ${p.status === 'done' ? '' : `<button class="btn primary" data-action="project-done" data-id="${esc(p.id)}">✅ Mark done</button>`}
      </div></div>
    <div class="tabs stage-tabs" role="group" aria-label="Stage">
      ${STAGES.map(([st, icon, label]) => `<button class="${p.status === st ? 'active' : ''}" data-action="project-stage" data-id="${esc(p.id)}" data-stage="${st}">${icon} ${label}</button>`).join('')}
    </div>
    ${(owner || p.target_date || p.note) ? `<p class="muted">${[owner ? `${avatar(owner)} ${esc(owner.display_name)} is leading this` : '',
      p.target_date ? `🎯 Target: ${fmtDate(parseDate(p.target_date), { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}` : '',
      p.note ? esc(p.note) : ''].filter(Boolean).join(' • ')}</p>` : ''}
    <div class="settings-grid">
      <section class="panel"><h3>✔️ Steps ${tasks.length ? `<small class="muted">${done}/${tasks.length}</small>` : ''}</h3>
        ${tasks.map(t => `<div class="grocery ${t.is_done ? 'done' : ''}">
          <label class="check"><input type="checkbox" data-toggle="ptask-check" data-id="${esc(t.id)}" ${t.is_done ? 'checked' : ''}><span>${esc(t.title)}</span></label>
          <button class="icon-btn" data-action="ptask-delete" data-id="${esc(t.id)}" title="Remove" aria-label="Remove ${esc(t.title)}">✕</button></div>`).join('')
          || '<p class="muted">Break the project into steps, like "Buy stain" and "Power wash".</p>'}
        <form class="inline-add" data-form="ptask-add">
          <input type="hidden" name="project_id" value="${esc(p.id)}">
          <input id="pt-new" name="title" placeholder="Add a step…" maxlength="120" autocomplete="off" required aria-label="Add a step">
          <button class="btn primary sm" type="submit">Add</button>
        </form>
      </section>
      <section class="panel"><h3>💵 Budget</h3>
        ${budgetBar(p) || `<p class="muted">No budget set. <button class="link" data-action="project-edit" data-id="${esc(p.id)}">Set one</button></p>`}
        ${expenses.map(e => `<div class="hist">
          <div class="mr-main">${esc(e.title)}<small>${fmtDate(parseDate(e.spent_on), { month: 'short', day: 'numeric', year: 'numeric' })}</small></div>
          <strong>${money(e.amount)}</strong>
          <button class="icon-btn" data-action="pexp-delete" data-id="${esc(e.id)}" title="Remove" aria-label="Remove ${esc(e.title)}">✕</button></div>`).join('')}
        <form class="expense-add" data-form="pexp-add">
          <input type="hidden" name="project_id" value="${esc(p.id)}">
          <input id="pe-title" name="title" placeholder="What did you buy?" maxlength="100" autocomplete="off" required aria-label="Expense">
          <input id="pe-amount" name="amount" placeholder="$0.00" inputmode="decimal" maxlength="12" required aria-label="Amount">
          <input id="pe-date" name="spent_on" type="date" value="${toISODate(startOfToday())}" aria-label="Date">
          <button class="btn primary sm" type="submit">Add</button>
        </form>
      </section>
    </div>
    <p><button class="link danger-text" data-action="project-delete" data-id="${esc(p.id)}">Delete this project</button></p>`;
}

export function view() {
  const p = state.projectId && projectById(state.projectId);
  return p && !state.lifeMissing ? detailView(p) : listView();
}

// Home card: projects in progress, or what's planned next
export function homeCard() {
  const head = cardHead('🔨', 'Home Projects', 'projects');
  if (state.lifeMissing) return `<div class="card">${head}<div class="empty-mini">Run the Alpha 0.8 database update to turn on home projects.</div></div>`;
  const doing = state.projects.filter(p => p.status === 'doing');
  if (!doing.length) {
    const planned = state.projects.filter(p => p.status === 'planned');
    return `<div class="card">${head}${planned.length
      ? `<p class="muted">Nothing in progress. Up next:</p>${planned.slice(0, 3).map(p => `<button class="home-project" data-action="project-open" data-id="${esc(p.id)}">
          <span>${esc(p.icon)} <b>${esc(p.title)}</b> ${taskLine(p)}</span>${budgetBar(p)}</button>`).join('')}`
      : '<div class="empty-mini">No projects yet. <button class="link" data-action="project-new">Add one</button></div>'}</div>`;
  }
  return `<div class="card">${head}
    ${doing.slice(0, 3).map(p => `<button class="home-project" data-action="project-open" data-id="${esc(p.id)}">
      <span>${esc(p.icon)} <b>${esc(p.title)}</b> ${taskLine(p)}</span>${budgetBar(p)}</button>`).join('')}
    ${doing.length > 3 ? `<a class="more" href="#/projects">+${doing.length - 3} more</a>` : ''}</div>`;
}

function form(p = {}) {
  const isNew = !p.id;
  return `<h2>${isNew ? 'New project' : 'Edit project'}</h2>
    <form data-form="project-save">
      <input type="hidden" name="id" value="${esc(p.id || '')}">
      <div class="field"><label for="pj-title">Project</label>
        <input id="pj-title" name="title" required maxlength="80" value="${esc(p.title || '')}" placeholder="e.g., Paint the deck"></div>
      <div class="field"><label>Icon</label><div class="icon-pick">${PROJECT_ICONS.map(i => `<label><input type="radio" name="icon" value="${i}" ${i === (p.icon || PROJECT_ICONS[0]) ? 'checked' : ''}><span>${i}</span></label>`).join('')}</div></div>
      <div class="field-row">
        <div class="field"><label for="pj-stage">Stage</label>
          <select id="pj-stage" name="status">${STAGES.map(([v, i, l]) => `<option value="${v}" ${v === (p.status || 'planned') ? 'selected' : ''}>${i} ${l}</option>`).join('')}</select></div>
        <div class="field"><label for="pj-owner">Who's leading it</label>
          <select id="pj-owner" name="owner_id">${memberOptions(everyone(), p.owner_id, 'Nobody yet')}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="pj-budget">Budget (optional)</label>
          <input id="pj-budget" name="budget" inputmode="decimal" maxlength="12" value="${p.budget != null ? esc(p.budget) : ''}" placeholder="$0"></div>
        <div class="field"><label for="pj-date">Finish by (optional)</label>
          <input id="pj-date" type="date" name="target_date" value="${esc(p.target_date || '')}"></div>
      </div>
      ${isNew ? `<div class="field"><label for="pj-steps">Steps (optional, one per line)</label>
        <textarea id="pj-steps" name="steps" rows="4" maxlength="3000" placeholder="Buy stain&#10;Power wash&#10;Sand the rough spots&#10;Stain"></textarea></div>` : ''}
      <div class="field"><label for="pj-note">Note (optional)</label>
        <input id="pj-note" name="note" maxlength="200" value="${esc(p.note || '')}" placeholder="e.g., Color: Cedar Naturaltone"></div>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">${isNew ? 'Add project' : 'Save changes'}</button>
      </div>
    </form>`;
}

async function setStage(id, status) {
  const row = { status, done_at: status === 'done' ? new Date().toISOString() : null };
  if (await run(sb.from('projects').update(row).eq('id', id), status === 'done' ? 'Project done! 🎉' : '')) refresh('projects');
}

export const actions = {
  'project-new': () => {
    if (state.lifeMissing) { toast('Run the Alpha 0.8 database update first. See the README.', 'error'); return; }
    openModal(form());
  },
  'project-open': el => {
    if (location.hash !== '#/projects') location.hash = '#/projects';
    update({ projectId: el.dataset.id });
    window.scrollTo(0, 0);
  },
  'project-back': () => update({ projectId: null }),
  'project-edit': el => openModal(form(projectById(el.dataset.id))),
  'project-stage': el => setStage(el.dataset.id, el.dataset.stage),
  'project-done': el => setStage(el.dataset.id, 'done'),
  'project-delete': async el => {
    const p = projectById(el.dataset.id);
    if (!p || !confirm(`Delete "${p.title}" with its steps and expenses?`)) return;
    if (await run(sb.from('projects').delete().eq('id', p.id), 'Project deleted')) {
      update({ projectId: null });
      refresh('projects');
      refresh('projectTasks');
      refresh('projectExpenses');
    }
  },
  'ptask-delete': async el => {
    if (await run(sb.from('project_tasks').delete().eq('id', el.dataset.id))) refresh('projectTasks');
  },
  'pexp-delete': async el => {
    if (!confirm('Remove this expense?')) return;
    if (await run(sb.from('project_expenses').delete().eq('id', el.dataset.id))) refresh('projectExpenses');
  },
};

export const toggles = {
  'ptask-check': async el => {
    await run(sb.from('project_tasks').update({ is_done: el.checked }).eq('id', el.dataset.id));
    refresh('projectTasks');
  },
};

export const forms = {
  'project-save': async d => {
    const title = d.title.trim();
    if (!title) return;
    const row = {
      title,
      icon: d.icon || PROJECT_ICONS[0],
      status: d.status || 'planned',
      owner_id: d.owner_id || null,
      budget: parseMoney(d.budget),
      target_date: d.target_date || null,
      note: (d.note || '').trim() || null,
    };
    const old = d.id && projectById(d.id);
    if (!old || (old.status === 'done') !== (row.status === 'done')) row.done_at = row.status === 'done' ? new Date().toISOString() : null;
    if (d.id) {
      if (await run(sb.from('projects').update(row).eq('id', d.id), 'Project saved')) {
        closeModal();
        refresh('projects');
      }
      return;
    }
    const { data, error } = await sb.from('projects').insert({ ...row, family_id: state.me.family_id }).select().single();
    if (error) { await run(Promise.resolve({ error })); return; }
    const steps = (d.steps || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 100);
    if (steps.length) {
      await run(sb.from('project_tasks').insert(steps.map((t, i) => ({ family_id: state.me.family_id, project_id: data.id, title: t.slice(0, 120), sort_order: i }))));
    }
    toast('Project added', 'success');
    closeModal();
    refresh('projects');
    refresh('projectTasks');
  },
  'ptask-add': async (d, f) => {
    const title = (d.title || '').trim();
    if (!title) return;
    const last = tasksOf(d.project_id).reduce((n, t) => Math.max(n, t.sort_order), -1);
    if (await run(sb.from('project_tasks').insert({ family_id: state.me.family_id, project_id: d.project_id, title, sort_order: last + 1 }))) {
      f.reset();
      refresh('projectTasks');
    }
  },
  'pexp-add': async (d, f) => {
    const amount = parseMoney(d.amount);
    if (amount == null) { toast('Type the amount, like 24.99', 'error'); return; }
    const row = { family_id: state.me.family_id, project_id: d.project_id, title: d.title.trim(), amount, spent_on: d.spent_on || toISODate(startOfToday()) };
    if (!row.title) return;
    if (await run(sb.from('project_expenses').insert(row))) {
      f.reset();
      f.querySelector('[name=spent_on]').value = toISODate(startOfToday());
      refresh('projectExpenses');
    }
  },
};
