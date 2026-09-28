// Habits: small daily wins (read 20 minutes, drink water) with streaks.
import { sb } from '../supabase.js';
import { state } from '../state.js';
import { esc, avatar, openModal, closeModal, startOfToday, toISODate, fmtDate, cardHead, toast } from '../utils.js';
import { run, refresh } from '../data.js';
import {
  today, everyone, memberById, habitDone, streak, routineProgress, kidsSetupNotice, ICONS, iconPicker,
  memberOptions, children, progressBar,
} from './kids.js';

function lastWeek() {
  const d = startOfToday();
  return [...Array(7)].map((_, i) => {
    const x = new Date(d);
    x.setDate(d.getDate() - (6 - i));
    return x;
  });
}

export function habitRow(h, kid = false) {
  const t = today();
  const on = habitDone(h.id, t);
  const s = streak(h.id);
  return `<div class="habit ${on ? 'on' : ''}">
    <label class="check"><input type="checkbox" data-toggle="habit-done" data-id="${esc(h.id)}" ${on ? 'checked' : ''}>
      <span>${esc(h.icon)} ${esc(h.title)}</span></label>
    <span class="week-dots" aria-label="Last 7 days">${lastWeek().map(d => `<i class="${habitDone(h.id, toISODate(d)) ? 'on' : ''}" title="${fmtDate(d, { weekday: 'short' })}"></i>`).join('')}</span>
    <span class="streak ${s ? '' : 'none'}" title="Days in a row">${s ? `🔥 ${s}` : '—'}</span>
    ${kid ? '' : `<span class="row-actions">
      <button class="icon-btn" data-action="habit-edit" data-id="${esc(h.id)}" title="Edit" aria-label="Edit ${esc(h.title)}">✏️</button>
      <button class="icon-btn" data-action="habit-delete" data-id="${esc(h.id)}" title="Delete" aria-label="Delete ${esc(h.title)}">🗑️</button></span>`}
  </div>`;
}

export function view() {
  const title = `<div class="page-title"><h2>❤️ Habits</h2>
    <button class="btn primary" data-action="habit-new">＋ New habit</button></div>`;
  if (state.kidsMissing) return title + kidsSetupNotice('habits');
  const people = everyone().filter(m => state.habits.some(h => h.member_id === m.id));
  if (!people.length) {
    return `${title}<div class="panel empty"><div class="empty-icon">❤️</div>
      <h3>Track healthy habits</h3>
      <p>Reading, drinking water, practicing piano, anything done once a day. Check it off and watch the streak grow. 🔥</p>
      <button class="btn primary" data-action="habit-new">Add a habit</button></div>`;
  }
  return `${title}<div class="kid-grid">${people.map(m => `<div class="panel">
      <h3 class="who">${avatar(m)} ${esc(m.display_name)}</h3>
      ${state.habits.filter(h => h.member_id === m.id).map(h => habitRow(h)).join('')}
    </div>`).join('')}</div>`;
}

// Home card: each person's routines for today, with progress.
export function routinesHomeCard() {
  const head = cardHead('🔄', 'Routines', 'routines');
  if (state.kidsMissing) return `<div class="card">${head}<div class="empty-mini">Run the Alpha 0.6 database update to turn on routines.</div></div>`;
  const people = everyone().filter(m => state.routines.some(r => r.member_id === m.id));
  if (!people.length) {
    return `<div class="card">${head}<div class="empty-mini">Morning and bedtime checklists. <button class="link" data-action="routine-new">Add a routine</button></div></div>`;
  }
  return `<div class="card">${head}${people.map(m => `<div class="rh-row">${avatar(m)}<div class="home-routines">
    ${state.routines.filter(r => r.member_id === m.id).map(r => {
      const { done, total } = routineProgress(r);
      const finished = total > 0 && done === total;
      return `<a class="home-routine ${finished ? 'ok' : ''}" href="#/routines">
        <span>${esc(r.icon)} ${esc(r.name)}</span><b>${finished ? '🎉 ' : ''}${done}/${total}</b>
        ${progressBar(done, total, m.color)}</a>`;
    }).join('')}</div></div>`).join('')}</div>`;
}

// Home card: today's habits, checkable right here, with streaks.
export function habitsHomeCard() {
  const head = cardHead('❤️', 'Habits', 'habits');
  if (state.kidsMissing) return `<div class="card">${head}<div class="empty-mini">Run the Alpha 0.6 database update to turn on habits.</div></div>`;
  const people = everyone().filter(m => state.habits.some(h => h.member_id === m.id));
  if (!people.length) {
    return `<div class="card">${head}<div class="empty-mini">Reading, water, practice. <button class="link" data-action="habit-new">Add a habit</button></div></div>`;
  }
  const t = today();
  return `<div class="card">${head}${people.map(m => `<div class="rh-row">${avatar(m)}<div class="home-habits">
    ${state.habits.filter(h => h.member_id === m.id).map(h => {
      const on = habitDone(h.id, t);
      const s = streak(h.id);
      return `<label class="check home-habit ${on ? 'on' : ''}"><input type="checkbox" data-toggle="habit-done" data-id="${esc(h.id)}" ${on ? 'checked' : ''}>
        <span>${esc(h.icon)} ${esc(h.title)}</span><small>${s ? `🔥 ${s}` : ''}</small></label>`;
    }).join('')}</div></div>`).join('')}</div>`;
}

function form(h = {}) {
  const isNew = !h.id;
  return `<h2>${isNew ? 'New habit' : 'Edit habit'}</h2>
    <form data-form="habit-save">
      <input type="hidden" name="id" value="${esc(h.id || '')}">
      <div class="field-row">
        <div class="field"><label for="hb-title">Habit</label>
          <input id="hb-title" name="title" required maxlength="60" value="${esc(h.title || '')}" placeholder="e.g., Read 20 minutes"></div>
        <div class="field"><label for="hb-who">Who</label>
          <select id="hb-who" name="member_id" required>${memberOptions(everyone(), h.member_id || children()[0]?.id)}</select></div>
      </div>
      <div class="field"><label>Icon</label>${iconPicker('icon', ICONS.habit, h.icon)}</div>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">${isNew ? 'Add habit' : 'Save changes'}</button>
      </div>
    </form>`;
}

export const actions = {
  'habit-new': () => openModal(form()),
  'habit-edit': el => openModal(form(state.habits.find(h => h.id === el.dataset.id))),
  'habit-delete': async el => {
    const h = state.habits.find(x => x.id === el.dataset.id);
    if (!h || !confirm(`Delete "${h.title}" and its streak?`)) return;
    if (await run(sb.from('habits').delete().eq('id', h.id), 'Habit deleted')) refresh('habits');
  },
};

export const toggles = {
  'habit-done': async el => {
    const t = today();
    const id = el.dataset.id;
    const ok = el.checked
      ? await run(sb.from('habit_logs').insert({ family_id: state.me.family_id, habit_id: id, for_date: t }))
      : await run(sb.from('habit_logs').delete().eq('habit_id', id).eq('for_date', t));
    if (ok && el.checked) {
      const s = streak(id) + 1;
      const h = state.habits.find(x => x.id === id);
      const who = h ? memberById(h.member_id)?.display_name : '';
      if ([3, 7, 14, 30, 50, 100].includes(s)) {
        toast(`🔥 ${who ? `${who}: ` : ''}${s} days in a row!`, 'success');
      }
    }
    refresh('habitLogs');
  },
};

export const forms = {
  'habit-save': async d => {
    const row = { title: d.title.trim(), member_id: d.member_id, icon: d.icon || ICONS.habit[0] };
    if (!row.title) return;
    const query = d.id
      ? sb.from('habits').update(row).eq('id', d.id)
      : sb.from('habits').insert({ ...row, family_id: state.me.family_id });
    if (await run(query, d.id ? 'Habit saved' : 'Habit added')) {
      closeModal();
      refresh('habits');
    }
  },
};
