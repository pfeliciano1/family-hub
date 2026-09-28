// Routines: step-by-step lists like "Morning" or "Bedtime", checked off
// each day, with progress like 4/5 and optional bonus points.
import { sb } from '../supabase.js';
import { state } from '../state.js';
import { esc, avatar, openModal, closeModal } from '../utils.js';
import { run, refresh } from '../data.js';
import {
  today, everyone, memberById, stepsOf, routineProgress, progressBar, awardPoints, removePoints,
  kidsSetupNotice, ICONS, iconPicker, memberOptions, children, newId,
} from './kids.js';

export function routineCard(r, kid = false) {
  const m = memberById(r.member_id);
  const { done, total } = routineProgress(r);
  const t = today();
  const finished = total > 0 && done === total;
  return `<div class="routine ${finished ? 'finished' : ''}">
    <div class="routine-head"><b>${esc(r.icon)} ${esc(r.name)}</b>
      <span class="routine-count">${finished ? '🎉 ' : ''}${done}/${total}</span>
      ${kid ? '' : `<span class="row-actions">
        <button class="icon-btn" data-action="routine-edit" data-id="${esc(r.id)}" title="Edit" aria-label="Edit ${esc(r.name)}">✏️</button>
        <button class="icon-btn" data-action="routine-delete" data-id="${esc(r.id)}" title="Delete" aria-label="Delete ${esc(r.name)}">🗑️</button></span>`}
    </div>
    ${progressBar(done, total, m?.color)}
    ${stepsOf(r.id).map(s => {
      const on = state.checks.some(c => c.step_id === s.id && c.for_date === t);
      return `<label class="check step ${on ? 'on' : ''}"><input type="checkbox" data-toggle="step-done" data-id="${esc(s.id)}" ${on ? 'checked' : ''}>
        <span>${esc(s.title)}</span></label>`;
    }).join('')}
    ${r.bonus ? `<small class="muted">${finished ? `Finished! +${r.bonus} ⭐` : `Finish all for +${r.bonus} ⭐`}</small>` : ''}
  </div>`;
}

export function view() {
  const title = `<div class="page-title"><h2>🔄 Routines</h2>
    <button class="btn primary" data-action="routine-new">＋ New routine</button></div>`;
  if (state.kidsMissing) return title + kidsSetupNotice('routines');
  const people = everyone().filter(m => state.routines.some(r => r.member_id === m.id));
  if (!people.length) {
    return `${title}<div class="panel empty"><div class="empty-icon">🔄</div>
      <h3>Build a morning or bedtime routine</h3>
      <p>List the steps (brush teeth, get dressed, pack backpack) and check them off each day. Everyone sees progress like 4/5.</p>
      <button class="btn primary" data-action="routine-new">Add a routine</button></div>`;
  }
  return `${title}<div class="kid-grid">${people.map(m => `<div class="panel">
      <h3 class="who">${avatar(m)} ${esc(m.display_name)}</h3>
      ${state.routines.filter(r => r.member_id === m.id).map(r => routineCard(r)).join('')}
    </div>`).join('')}</div>
    <p class="muted small">Checks reset every morning.</p>`;
}

function form(r = {}) {
  const isNew = !r.id;
  const steps = r.id ? stepsOf(r.id).map(s => s.title).join('\n') : '';
  return `<h2>${isNew ? 'New routine' : 'Edit routine'}</h2>
    <form data-form="routine-save">
      <input type="hidden" name="id" value="${esc(r.id || '')}">
      <div class="field-row">
        <div class="field"><label for="rt-name">Name</label>
          <input id="rt-name" name="name" required maxlength="40" value="${esc(r.name || '')}" placeholder="e.g., Morning"></div>
        <div class="field"><label for="rt-who">Who</label>
          <select id="rt-who" name="member_id" required>${memberOptions(everyone(), r.member_id || children()[0]?.id)}</select></div>
      </div>
      <div class="field"><label>Icon</label>${iconPicker('icon', ICONS.routine, r.icon)}</div>
      <div class="field"><label for="rt-steps">Steps, one per line</label>
        <textarea id="rt-steps" name="steps" rows="6" required placeholder="Get dressed&#10;Eat breakfast&#10;Brush teeth&#10;Pack backpack">${esc(steps)}</textarea></div>
      <div class="field"><label for="rt-bonus">Bonus points for finishing (optional)</label>
        <input id="rt-bonus" type="number" name="bonus" min="0" max="1000" value="${esc(r.bonus ?? 0)}"></div>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">${isNew ? 'Add routine' : 'Save changes'}</button>
      </div>
    </form>`;
}

// Makes today's bonus match the routine: given when every step is done,
// taken back if a step gets unchecked, and corrected if the bonus amount
// or the steps change after it was given.
async function settleBonus(routine) {
  const { done, total } = routineProgress(routine);
  const key = `routine:${routine.id}:${today()}`;
  const want = total > 0 && done === total ? routine.bonus || 0 : 0;
  const given = state.points.find(p => p.ref_key === key);
  if (given && given.amount === want) return;
  if (given) await removePoints(key);
  if (want) await awardPoints(routine.member_id, want, `${routine.icon} ${routine.name} routine`, 'routine', key);
}

export const actions = {
  'routine-new': () => openModal(form()),
  'routine-edit': el => openModal(form(state.routines.find(r => r.id === el.dataset.id))),
  'routine-delete': async el => {
    if (!confirm('Delete this routine?')) return;
    if (await run(sb.from('routines').delete().eq('id', el.dataset.id), 'Routine deleted')) refresh('routines');
  },
};

export const toggles = {
  'step-done': async el => {
    const step = state.steps.find(s => s.id === el.dataset.id);
    if (!step) return;
    const t = today();
    const ok = el.checked
      ? await run(sb.from('routine_checks').insert({ family_id: state.me.family_id, step_id: step.id, for_date: t }))
      : await run(sb.from('routine_checks').delete().eq('step_id', step.id).eq('for_date', t));
    if (!ok) return;
    // Update locally first so the bonus check sees this change
    if (el.checked) state.checks = [...state.checks, { step_id: step.id, for_date: t }];
    else state.checks = state.checks.filter(c => !(c.step_id === step.id && c.for_date === t));
    const routine = state.routines.find(r => r.id === step.routine_id);
    if (routine) await settleBonus(routine);
    refresh('checks');
    refresh('balances');
    refresh('points');
  },
};

export const forms = {
  'routine-save': async d => {
    const titles = d.steps.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 20);
    const row = {
      name: d.name.trim(),
      member_id: d.member_id,
      icon: d.icon || ICONS.routine[0],
      bonus: Math.max(0, Math.min(1000, parseInt(d.bonus, 10) || 0)),
    };
    if (!row.name || !titles.length) return;
    let id = d.id;
    if (id) {
      if (!await run(sb.from('routines').update(row).eq('id', id))) return;
    } else {
      id = newId();
      const insert = { ...row, id, family_id: state.me.family_id, sort_order: state.routines.length };
      if (!await run(sb.from('routines').insert(insert))) return;
    }
    // Keep existing steps (and today's checks) that still match by name
    const existing = stepsOf(id);
    const keep = new Map(existing.map(s => [s.title.toLowerCase(), s]));
    const used = new Set();
    for (const [i, title] of titles.entries()) {
      const hit = keep.get(title.toLowerCase());
      if (hit && !used.has(hit.id)) {
        used.add(hit.id);
        if (hit.sort_order !== i || hit.title !== title) await run(sb.from('routine_steps').update({ sort_order: i, title }).eq('id', hit.id));
      } else {
        await run(sb.from('routine_steps').insert({ family_id: state.me.family_id, routine_id: id, title, sort_order: i }));
      }
    }
    const gone = existing.filter(s => !used.has(s.id)).map(s => s.id);
    if (gone.length) await run(sb.from('routine_steps').delete().in('id', gone));
    closeModal();
    await Promise.all([refresh('routines'), refresh('steps'), refresh('checks'), refresh('points')]);
    // Steps already checked today count right away (e.g. a bonus added
    // after the routine was finished)
    const routine = state.routines.find(r => r.id === id);
    if (routine) await settleBonus(routine);
    refresh('balances');
    refresh('points');
  },
};
