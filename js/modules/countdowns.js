// Countdowns to vacations, birthdays, holidays, and anything else.
import { sb } from '../supabase.js';
import { state } from '../state.js';
import {
  esc, fmtDate, nextOccurrence, daysBetween, startOfToday, openModal, closeModal,
} from '../utils.js';
import { run, refresh } from '../data.js';

export const CATEGORIES = {
  vacation:    ['✈️', 'Vacation or trip'],
  birthday:    ['🎂', 'Birthday'],
  anniversary: ['💍', 'Anniversary'],
  holiday:     ['🎄', 'Holiday'],
  school:      ['🏫', 'School event'],
  sports:      ['⚽', 'Sports'],
  custom:      ['⏳', 'Other'],
};

export function enrich(c) {
  const next = nextOccurrence(c.event_date, c.repeats_yearly);
  return {
    ...c,
    icon: (CATEGORIES[c.category] || CATEGORIES.custom)[0],
    next,
    days: daysBetween(startOfToday(), next),
  };
}

export function upcomingCountdowns() {
  return state.countdowns.map(enrich).filter(c => c.days >= 0).sort((a, b) => a.days - b.days);
}

function row(c) {
  const when = fmtDate(c.next, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const big = c.days === 0 ? '🎉' : c.days < 0 ? '✓' : c.days;
  const small = c.days === 0 ? 'today' : c.days < 0 ? 'past' : c.days === 1 ? 'day' : 'days';
  return `<div class="cd-row">
    <div class="cd-icon">${c.icon}</div>
    <div class="cd-main"><b>${esc(c.title)}</b>
      <small>${when}${c.repeats_yearly ? ' • every year' : ''}${c.show_on_dashboard ? '' : ' • hidden from Home'}</small></div>
    <div class="cd-days"><strong>${big}</strong><small>${small}</small></div>
    <div class="row-actions">
      <button class="icon-btn" data-action="countdown-edit" data-id="${esc(c.id)}" title="Edit" aria-label="Edit ${esc(c.title)}">✏️</button>
      <button class="icon-btn" data-action="countdown-delete" data-id="${esc(c.id)}" title="Delete" aria-label="Delete ${esc(c.title)}">🗑️</button>
    </div>
  </div>`;
}

export function view() {
  const all = state.countdowns.map(enrich);
  const upcoming = all.filter(c => c.days >= 0).sort((a, b) => a.days - b.days);
  const past = all.filter(c => c.days < 0).sort((a, b) => b.days - a.days);
  return `<div class="page-title"><h2>⏳ Countdowns</h2>
      <button class="btn primary" data-action="countdown-new">＋ New countdown</button></div>
    <div class="panel">${upcoming.length
      ? upcoming.map(row).join('')
      : `<div class="empty"><div class="empty-icon">⏳</div><p>No countdowns yet. Add a vacation, birthday, or holiday to start counting down.</p>
         <button class="btn primary" data-action="countdown-new">Add a countdown</button></div>`}</div>
    ${past.length ? `<h3 class="section-label">Already happened</h3><div class="panel faded">${past.map(row).join('')}</div>` : ''}`;
}

function form(c = {}) {
  const isNew = !c.id;
  return `<h2>${isNew ? 'New countdown' : 'Edit countdown'}</h2>
    <form data-form="countdown-save">
      <input type="hidden" name="id" value="${esc(c.id || '')}">
      <div class="field"><label for="cd-title">What are we counting down to?</label>
        <input id="cd-title" name="title" required maxlength="80" value="${esc(c.title || '')}" placeholder="e.g., Puerto Rico trip"></div>
      <div class="field-row">
        <div class="field"><label for="cd-date">Date</label>
          <input id="cd-date" type="date" name="event_date" required value="${esc(c.event_date || '')}"></div>
        <div class="field"><label for="cd-cat">Type</label>
          <select id="cd-cat" name="category">${Object.entries(CATEGORIES).map(([k, [icon, label]]) =>
            `<option value="${k}" ${(c.category || 'vacation') === k ? 'selected' : ''}>${icon} ${label}</option>`).join('')}</select></div>
      </div>
      <label class="check opt"><input type="checkbox" name="repeats_yearly" ${c.repeats_yearly ? 'checked' : ''}>
        <span>Repeats every year <small class="muted">(birthdays, anniversaries, holidays)</small></span></label>
      <label class="check opt"><input type="checkbox" name="show_on_dashboard" ${isNew || c.show_on_dashboard ? 'checked' : ''}>
        <span>Show on the Home dashboard</span></label>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">${isNew ? 'Add countdown' : 'Save changes'}</button>
      </div>
    </form>`;
}

export const actions = {
  'countdown-new': () => openModal(form()),
  'countdown-edit': el => openModal(form(state.countdowns.find(c => c.id === el.dataset.id))),
  'countdown-delete': async el => {
    const c = state.countdowns.find(x => x.id === el.dataset.id);
    if (!c || !confirm(`Delete "${c.title}"?`)) return;
    if (await run(sb.from('countdowns').delete().eq('id', c.id), 'Countdown deleted')) refresh('countdowns');
  },
};

export const forms = {
  'countdown-save': async d => {
    const row = {
      title: d.title.trim(),
      event_date: d.event_date,
      category: d.category,
      repeats_yearly: Boolean(d.repeats_yearly),
      show_on_dashboard: Boolean(d.show_on_dashboard),
    };
    const query = d.id
      ? sb.from('countdowns').update(row).eq('id', d.id)
      : sb.from('countdowns').insert({ ...row, family_id: state.me.family_id });
    if (await run(query, d.id ? 'Countdown saved' : 'Countdown added')) {
      closeModal();
      refresh('countdowns');
    }
  },
};
