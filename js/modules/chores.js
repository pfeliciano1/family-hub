// Chores: repeating jobs that earn points, with parent approval.
// Shown as the "Chores" tab of Tasks & Chores, and in Kid mode.
import { sb } from '../supabase.js';
import { state, update } from '../state.js';
import { esc, avatar, openModal, closeModal, parseDate, fmtDate } from '../utils.js';
import { run, refresh } from '../data.js';
import {
  today, children, everyone, memberById, awardPoints, removePoints, newId, choresForToday, choreDate,
  completionFor, kidsSetupNotice, ICONS, iconPicker, memberOptions,
} from './kids.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function scheduleLabel(c) {
  if (c.frequency === 'daily') return 'Every day';
  if (c.frequency === 'weekly') {
    const d = [...(c.days || [])].sort();
    if (d.join() === '1,2,3,4,5') return 'Weekdays';
    if (d.join() === '0,6') return 'Weekends';
    return d.map(x => DAY_NAMES[x]).join(', ') || 'No days picked';
  }
  return c.due_date ? `Once, ${fmtDate(parseDate(c.due_date), { weekday: 'short', month: 'short', day: 'numeric' })}` : 'Once';
}

// One chore with its checkbox. kid = true hides parent-only controls.
export function choreRow(c, kid = false) {
  const date = choreDate(c);
  const done = completionFor(c, date);
  let status = '';
  if (done?.status === 'pending') status = '<span class="due today">Waiting for OK</span>';
  else if (done?.status === 'approved') status = `<span class="due done-pts">+${done.points} ⭐</span>`;
  else if (done?.status === 'rejected') status = '<span class="due overdue">Try again</span>';
  else if (date !== today()) status = '<span class="due overdue">Late</span>';
  else status = `<span class="due">${c.points} ⭐</span>`;
  const locked = kid && done?.status === 'approved';
  const checked = done && done.status !== 'rejected';
  return `<div class="task chore ${checked ? 'done' : ''}">
    <label class="check"><input type="checkbox" data-toggle="chore-done" data-id="${esc(c.id)}" data-date="${date}"
      ${checked ? 'checked' : ''} ${locked ? 'disabled' : ''}>
      <span>${esc(c.icon)} ${esc(c.title)}</span></label>
    <span class="task-meta">${status}</span>
  </div>`;
}

export function pendingCompletions() {
  return state.completions.filter(c => c.status === 'pending');
}

export function approvalRows() {
  const rows = [];
  for (const x of pendingCompletions()) {
    const chore = state.chores.find(c => c.id === x.chore_id);
    const m = memberById(x.member_id);
    if (!chore || !m) continue;
    rows.push(`<div class="approval">${avatar(m)}
      <div class="mr-main"><b>${esc(m.display_name)}</b> did <b>${esc(chore.icon)} ${esc(chore.title)}</b>
        <small>${fmtDate(parseDate(x.for_date), { weekday: 'short', month: 'short', day: 'numeric' })} • ${x.points} ⭐</small></div>
      <div class="row-actions">
        <button class="btn sm primary" data-action="chore-approve" data-id="${esc(x.id)}">Approve</button>
        <button class="btn sm" data-action="chore-reject" data-id="${esc(x.id)}">Not yet</button>
      </div></div>`);
  }
  return rows;
}

// The Chores tab on the Tasks & Chores page.
export function tabView() {
  if (state.kidsMissing) return kidsSetupNotice('chores, rewards, routines, and habits');
  const approvals = approvalRows();
  const people = everyone().filter(m => state.chores.some(c => c.assigned_to === m.id && c.is_active));
  const todayBlocks = people.map(m => {
    const list = choresForToday(m.id);
    return `<div class="kid-block"><h4>${avatar(m)} ${esc(m.display_name)}</h4>
      ${list.length ? list.map(c => choreRow(c)).join('') : '<p class="muted">No chores today. 🎉</p>'}</div>`;
  }).join('');
  return `
    ${approvals.length ? `<div class="panel"><h3>👀 Waiting for your OK (${approvals.length})</h3>${approvals.join('')}</div>` : ''}
    <div class="panel">
      <div class="panel-head"><h3>Today's chores</h3>
        <div class="row-actions">
          <button class="btn sm" data-action="chore-manage">${state.choreEdit ? 'Done editing' : 'Edit chores'}</button>
          <button class="btn primary sm" data-action="chore-new">＋ New chore</button>
        </div></div>
      ${state.choreEdit ? manageList() : (todayBlocks || `<div class="empty"><p>No chores yet. Add jobs like "Make your bed" or "Feed the dog" and choose how many points each one earns.</p>
        <button class="btn primary" data-action="chore-new">Add a chore</button></div>`)}
    </div>`;
}

function manageList() {
  if (!state.chores.length) return '<p class="muted">No chores yet.</p>';
  return everyone().map(m => {
    const list = state.chores.filter(c => c.assigned_to === m.id);
    if (!list.length) return '';
    return `<div class="kid-block"><h4>${avatar(m)} ${esc(m.display_name)}</h4>${list.map(c => `<div class="member-row ${c.is_active ? '' : 'faded'}">
      <span class="big-ic">${esc(c.icon)}</span>
      <div class="mr-main"><b>${esc(c.title)}</b><small>${scheduleLabel(c)} • ${c.points} ⭐${c.needs_approval ? ' • needs OK' : ''}${c.is_active ? '' : ' • paused'}</small></div>
      <div class="row-actions">
        <button class="icon-btn" data-action="chore-edit" data-id="${esc(c.id)}" title="Edit" aria-label="Edit ${esc(c.title)}">✏️</button>
        <button class="icon-btn" data-action="chore-delete" data-id="${esc(c.id)}" title="Delete" aria-label="Delete ${esc(c.title)}">🗑️</button>
      </div></div>`).join('')}</div>`;
  }).join('');
}

function form(c = {}) {
  const isNew = !c.id;
  const freq = c.frequency || 'daily';
  const days = c.days || [1, 2, 3, 4, 5];
  const who = c.assigned_to || children()[0]?.id;
  return `<h2>${isNew ? 'New chore' : 'Edit chore'}</h2>
    <form data-form="chore-save">
      <input type="hidden" name="id" value="${esc(c.id || '')}">
      <div class="field"><label for="ch-title">Chore</label>
        <input id="ch-title" name="title" required maxlength="80" value="${esc(c.title || '')}" placeholder="e.g., Make your bed"></div>
      <div class="field"><label>Icon</label>${iconPicker('icon', ICONS.chore, c.icon)}</div>
      <div class="field-row">
        <div class="field"><label for="ch-who">Who</label>
          <select id="ch-who" name="assigned_to" required>${memberOptions(everyone(), who)}</select></div>
        <div class="field"><label for="ch-pts">Points</label>
          <input id="ch-pts" type="number" name="points" min="0" max="1000" required value="${esc(c.points ?? 2)}"></div>
      </div>
      <div class="field"><label for="ch-freq">How often</label>
        <select id="ch-freq" name="frequency" data-toggle="chore-freq">
          <option value="daily" ${freq === 'daily' ? 'selected' : ''}>Every day</option>
          <option value="weekly" ${freq === 'weekly' ? 'selected' : ''}>Certain days of the week</option>
          <option value="once" ${freq === 'once' ? 'selected' : ''}>Just once</option>
        </select></div>
      <div class="field freq-weekly" ${freq === 'weekly' ? '' : 'hidden'}><label>Days</label>
        <div class="day-pick">${DAY_NAMES.map((n, i) => `<label><input type="checkbox" name="day${i}" value="1" ${days.includes(i) ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div></div>
      <div class="field freq-once" ${freq === 'once' ? '' : 'hidden'}><label for="ch-date">Day</label>
        <input id="ch-date" type="date" name="due_date" value="${esc(c.due_date || today())}"></div>
      <label class="check opt"><input type="checkbox" name="needs_approval" value="1" ${c.needs_approval === false ? '' : 'checked'}>
        <span>A parent approves it before points are given</span></label>
      ${isNew ? '' : `<label class="check opt"><input type="checkbox" name="paused" value="1" ${c.is_active === false ? 'checked' : ''}>
        <span>Pause this chore</span></label>`}
      <div class="modal-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">${isNew ? 'Add chore' : 'Save changes'}</button>
      </div>
    </form>`;
}

async function approve(x) {
  const chore = state.chores.find(c => c.id === x.chore_id);
  const ok = await run(sb.from('chore_completions')
    .update({ status: 'approved', decided_at: new Date().toISOString() }).eq('id', x.id));
  if (ok) await awardPoints(x.member_id, x.points, chore ? chore.title : 'Chore', 'chore', `chore:${x.id}`);
  return ok;
}

export const actions = {
  'chore-new': () => openModal(form()),
  'chore-edit': el => openModal(form(state.chores.find(c => c.id === el.dataset.id))),
  'chore-manage': () => update({ choreEdit: !state.choreEdit }),
  'chore-delete': async el => {
    if (!confirm('Delete this chore? Points already earned are kept.')) return;
    if (await run(sb.from('chores').delete().eq('id', el.dataset.id), 'Chore deleted')) refresh('chores');
  },
  'chore-approve': async el => {
    const x = state.completions.find(c => c.id === el.dataset.id);
    if (x && await approve(x)) { refresh('completions'); refresh('balances'); refresh('points'); }
  },
  'chore-reject': async el => {
    const ok = await run(sb.from('chore_completions')
      .update({ status: 'rejected', decided_at: new Date().toISOString() }).eq('id', el.dataset.id), 'Sent back to try again');
    if (ok) refresh('completions');
  },
};

export const toggles = {
  'chore-freq': el => {
    const f = el.closest('form');
    f.querySelector('.freq-weekly').hidden = el.value !== 'weekly';
    f.querySelector('.freq-once').hidden = el.value !== 'once';
  },
  'chore-done': async el => {
    const chore = state.chores.find(c => c.id === el.dataset.id);
    if (!chore) return;
    const date = el.dataset.date;
    const existing = completionFor(chore, date);
    const kid = Boolean(state.kidId);
    if (el.checked) {
      // Parents checking it off count as approval; kids wait for OK if the chore needs it.
      const status = chore.needs_approval && kid ? 'pending' : 'approved';
      let id = existing?.id;
      if (existing) {
        await run(sb.from('chore_completions').update({ status, points: chore.points, decided_at: status === 'approved' ? new Date().toISOString() : null }).eq('id', id));
      } else {
        id = newId();
        await run(sb.from('chore_completions').insert({
          id, family_id: state.me.family_id, chore_id: chore.id, member_id: chore.assigned_to,
          for_date: date, status, points: chore.points, decided_at: status === 'approved' ? new Date().toISOString() : null,
        }));
      }
      if (status === 'approved') await awardPoints(chore.assigned_to, chore.points, chore.title, 'chore', `chore:${id}`);
    } else if (existing) {
      await run(sb.from('chore_completions').delete().eq('id', existing.id));
      if (existing.status === 'approved') await removePoints(`chore:${existing.id}`);
    }
    refresh('completions');
    refresh('balances');
    refresh('points');
  },
};

export const forms = {
  'chore-save': async d => {
    const days = [0, 1, 2, 3, 4, 5, 6].filter(i => d[`day${i}`]);
    const row = {
      title: d.title.trim(),
      icon: d.icon || ICONS.chore[0],
      assigned_to: d.assigned_to,
      points: Math.max(0, Math.min(1000, parseInt(d.points, 10) || 0)),
      frequency: d.frequency,
      days: d.frequency === 'weekly' ? days : [],
      due_date: d.frequency === 'once' ? (d.due_date || today()) : null,
      needs_approval: Boolean(d.needs_approval),
      is_active: !d.paused,
    };
    if (!row.title || !row.assigned_to) return;
    if (row.frequency === 'weekly' && !days.length) {
      alert('Pick at least one day of the week.');
      return;
    }
    const query = d.id
      ? sb.from('chores').update(row).eq('id', d.id)
      : sb.from('chores').insert({ ...row, family_id: state.me.family_id });
    if (await run(query, d.id ? 'Chore saved' : 'Chore added')) {
      closeModal();
      refresh('chores');
    }
  },
};
