// Fitness routines: the library (built-in and your own), a routine's
// details, and making or changing your own routines.
import { sb } from '../supabase.js';
import { state, update } from '../state.js';
import { esc, openModal, closeModal, toast } from '../utils.js';
import { run, refresh } from '../data.js';
import { CATEGORIES, CATEGORY_IDS, catLabel, catIcon, stepDose, fmtSeconds } from './fitcalc.js';
import { openLog } from './fitness.js';

export const routineById = id => state.fitRoutines.find(r => r.id === id);
export const stepsOf = id => state.fitSteps.filter(s => s.routine_id === id).sort((a, b) => a.position - b.position);
const exById = id => state.fitExercises.find(e => e.id === id);
const isMine = r => r && r.owner_id === state.user.id;

export const stepName = st => st.label || exById(st.exercise_id)?.name || 'Step';

// A step's picture, or an icon for moves that don't have one
export function stepThumb(st, routine, cls = 'fit-thumb') {
  const ex = st.exercise_id && exById(st.exercise_id);
  if (ex?.image_urls?.length) return `<img class="${cls}" src="${esc(ex.image_urls[0])}" alt="" loading="lazy">`;
  return `<span class="${cls} icon" aria-hidden="true">${routine?.category === 'run' ? '🏃' : '🤸'}</span>`;
}

// ---------- Library ----------

function routineCard(r) {
  const steps = stepsOf(r.id);
  // One picture per different exercise, up to 4
  const seen = new Set();
  const thumbs = steps.filter(st => {
    const key = st.exercise_id || 'icon'; // moves without a picture share one icon
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 4);
  return `<button class="fit-routine" data-action="fit-routine-open" data-id="${esc(r.id)}">
    <div class="fr-top"><b>${esc(r.name)}</b>${isMine(r) ? '<small class="pill">Mine</small>' : ''}</div>
    <small class="muted">${catIcon(r.category)} ${esc(catLabel(r.category))} • ${r.est_minutes} min${r.rounds > 1 ? ` • ${r.rounds} rounds` : ''}</small>
    <div class="fr-thumbs">${thumbs.map(st => stepThumb(st, r)).join('')}</div>
  </button>`;
}

export function libraryView() {
  const cat = state.fitCat;
  const list = state.fitRoutines.filter(r => !cat || r.category === cat);
  const mine = list.filter(isMine);
  const builtIn = list.filter(r => !r.owner_id);
  return `<div class="fchips fit-cats">
      <button class="fchip ${!cat ? 'on' : ''}" data-action="fit-cat" data-cat="">All</button>
      ${CATEGORY_IDS.map(c => `<button class="fchip ${cat === c ? 'on' : ''}" data-action="fit-cat" data-cat="${c}">${catIcon(c)} ${catLabel(c)}</button>`).join('')}
      <button class="btn sm fit-new" data-action="fit-routine-new">＋ My own routine</button>
    </div>
    ${mine.length ? `<h3 class="section-label">My routines</h3><div class="fit-grid">${mine.map(routineCard).join('')}</div>` : ''}
    <h3 class="section-label">Built-in routines</h3>
    ${builtIn.length ? `<div class="fit-grid">${builtIn.map(routineCard).join('')}</div>`
      : '<div class="panel empty"><p>No routines in this category yet.</p></div>'}
    <p class="muted fit-credit">Exercise pictures: <a href="https://github.com/yuhonas/free-exercise-db" target="_blank" rel="noopener noreferrer">Free Exercise DB</a> (public domain).</p>`;
}

// ---------- One routine ----------

function detail(r) {
  const steps = stepsOf(r.id);
  return `<div class="fit-detail">
      <h2>${catIcon(r.category)} ${esc(r.name)}</h2>
      <p class="muted">${esc(catLabel(r.category))} • about ${r.est_minutes} min${r.rounds > 1 ? ` • ${r.rounds} rounds of the list below` : ''}${isMine(r) ? ' • your routine' : ' • built-in'}</p>
      ${r.description ? `<p>${esc(r.description)}</p>` : ''}
      <ol class="fit-steps">${steps.map(st => `<li>
        ${stepThumb(st, r)}
        <span><b>${esc(stepName(st))}</b><small class="muted">${esc(stepDose(st))}${st.rest_sec ? ` • rest ${fmtSeconds(st.rest_sec)}` : ''}</small></span>
      </li>`).join('')}</ol>
    </div>
    <div class="modal-actions fit-detail-actions">
      ${isMine(r) ? `<button class="btn danger-text" data-action="fit-routine-delete" data-id="${esc(r.id)}">Delete</button>
        <button class="btn" data-action="fit-routine-edit" data-id="${esc(r.id)}">Edit</button>`
        : `<button class="btn" data-action="fit-routine-copy" data-id="${esc(r.id)}" title="Make your own copy to change">Duplicate to change</button>`}
      ${isMine(r) ? `<button class="btn" data-action="fit-routine-copy" data-id="${esc(r.id)}">Duplicate</button>` : ''}
      <button class="btn" data-action="fit-log-routine" data-id="${esc(r.id)}">✅ I did this</button>
      <button class="btn primary" data-action="fit-routine-start" data-id="${esc(r.id)}">▶ Start</button>
    </div>`;
}

// ---------- Making and changing your own routines ----------

let draft = null; // the routine being edited, kept while steps are added or moved

const blankStep = () => ({ exercise_id: '', label: '', sets: '', mode: 'reps', amount: '', rest_sec: '' });

function draftFrom(r, copy) {
  return {
    id: copy ? null : r.id,
    name: copy ? `${r.name} (my copy)`.slice(0, 80) : r.name,
    category: r.category,
    est_minutes: r.est_minutes,
    rounds: r.rounds || 1,
    description: r.description || '',
    steps: stepsOf(r.id).map(st => ({
      exercise_id: st.exercise_id || '', label: st.label || '', sets: st.sets || '',
      mode: st.reps ? 'reps' : 'time', amount: st.reps || st.duration_sec || '', rest_sec: st.rest_sec ?? '',
    })),
  };
}

// Copy what's typed in the form into the draft before redrawing it
function syncDraft() {
  const f = document.getElementById('fit-editor');
  if (!f || !draft) return;
  const v = name => f.elements[name]?.value ?? '';
  Object.assign(draft, { name: v('name'), category: v('category'), est_minutes: v('est_minutes'), rounds: v('rounds'), description: v('description') });
  draft.steps = draft.steps.map((_, i) => ({
    exercise_id: v(`s${i}_ex`), label: v(`s${i}_label`), sets: v(`s${i}_sets`),
    mode: v(`s${i}_mode`), amount: v(`s${i}_amount`), rest_sec: v(`s${i}_rest`),
  }));
}

function stepRow(st, i, n) {
  const opts = state.fitExercises.map(e => `<option value="${esc(e.id)}" ${e.id === st.exercise_id ? 'selected' : ''}>${esc(e.name)}</option>`).join('');
  return `<div class="fit-step-edit">
    <div class="fse-head"><b>Step ${i + 1}</b>
      <span class="row-actions">
        <button type="button" class="icon-btn" data-action="fit-step-move" data-i="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move step ${i + 1} up">↑</button>
        <button type="button" class="icon-btn" data-action="fit-step-move" data-i="${i}" data-dir="1" ${i === n - 1 ? 'disabled' : ''} aria-label="Move step ${i + 1} down">↓</button>
        <button type="button" class="icon-btn" data-action="fit-step-remove" data-i="${i}" aria-label="Remove step ${i + 1}">🗑️</button>
      </span></div>
    <div class="field-row">
      <div class="field"><label for="s${i}-ex">Exercise</label>
        <select id="s${i}-ex" name="s${i}_ex"><option value="">No picture (just a name)</option>${opts}</select></div>
      <div class="field"><label for="s${i}-label">Name to show</label>
        <input id="s${i}-label" name="s${i}_label" maxlength="80" value="${esc(st.label)}" placeholder="Optional, e.g. Easy jog"></div>
    </div>
    <div class="field-row fse-dose">
      <div class="field"><label for="s${i}-sets">Sets</label>
        <input id="s${i}-sets" name="s${i}_sets" type="number" min="1" max="20" inputmode="numeric" value="${esc(st.sets)}" placeholder="1"></div>
      <div class="field"><label for="s${i}-mode">By</label>
        <select id="s${i}-mode" name="s${i}_mode"><option value="reps" ${st.mode === 'reps' ? 'selected' : ''}>Reps</option><option value="time" ${st.mode === 'time' ? 'selected' : ''}>Seconds</option></select></div>
      <div class="field"><label for="s${i}-amount">How many</label>
        <input id="s${i}-amount" name="s${i}_amount" type="number" min="1" max="7200" inputmode="numeric" value="${esc(st.amount)}" required></div>
      <div class="field"><label for="s${i}-rest">Rest (s)</label>
        <input id="s${i}-rest" name="s${i}_rest" type="number" min="0" max="600" inputmode="numeric" value="${esc(st.rest_sec)}" placeholder="0"></div>
    </div>
  </div>`;
}

function editor() {
  const d = draft;
  return `<h2>${d.id ? 'Edit routine' : 'New routine'}</h2>
    <form data-form="fit-routine-save" id="fit-editor">
      <div class="field"><label for="fr-name">Name</label>
        <input id="fr-name" name="name" required maxlength="80" value="${esc(d.name)}" placeholder="e.g., Saturday legs"></div>
      <div class="field-row">
        <div class="field"><label for="fr-cat">Type</label>
          <select id="fr-cat" name="category">${CATEGORY_IDS.map(c => `<option value="${c}" ${c === d.category ? 'selected' : ''}>${catIcon(c)} ${catLabel(c)}</option>`).join('')}</select></div>
        <div class="field"><label for="fr-min">About how long (min)</label>
          <input id="fr-min" name="est_minutes" type="number" min="10" max="45" required inputmode="numeric" value="${esc(d.est_minutes)}"></div>
        <div class="field"><label for="fr-rounds">Rounds</label>
          <input id="fr-rounds" name="rounds" type="number" min="1" max="10" required inputmode="numeric" value="${esc(d.rounds)}"></div>
      </div>
      <div class="field"><label for="fr-desc">Note (optional)</label>
        <input id="fr-desc" name="description" maxlength="300" value="${esc(d.description)}" placeholder="e.g., 40 seconds on, 20 seconds rest"></div>
      <h3 class="section-label">Steps</h3>
      ${d.steps.map((st, i) => stepRow(st, i, d.steps.length)).join('') || '<p class="muted">No steps yet.</p>'}
      <button type="button" class="btn sm" data-action="fit-step-add">＋ Add a step</button>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">${d.id ? 'Save changes' : 'Save routine'}</button>
      </div>
    </form>`;
}

function redrawEditor() {
  const scroll = document.querySelector('#modal-root .modal')?.scrollTop || 0;
  openModal(editor());
  const m = document.querySelector('#modal-root .modal');
  if (m) m.scrollTop = scroll;
}

const num = (v, lo, hi) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};

// ---------- Buttons and forms ----------

export const actions = {
  'fit-cat': el => update({ fitCat: el.dataset.cat }),
  'fit-routine-open': el => {
    const r = routineById(el.dataset.id);
    if (r) openModal(detail(r));
  },
  'fit-routine-new': () => {
    draft = { id: null, name: '', category: state.fitCat || 'strength', est_minutes: 20, rounds: 1, description: '', steps: [blankStep()] };
    openModal(editor());
  },
  'fit-routine-edit': el => {
    const r = routineById(el.dataset.id);
    if (!isMine(r)) return;
    draft = draftFrom(r, false);
    openModal(editor());
  },
  'fit-routine-copy': el => {
    const r = routineById(el.dataset.id);
    if (!r) return;
    draft = draftFrom(r, true);
    openModal(editor());
  },
  'fit-routine-delete': async el => {
    const r = routineById(el.dataset.id);
    if (!isMine(r) || !confirm(`Delete "${r.name}"? Workouts you logged with it stay in your history.`)) return;
    if (await run(sb.from('fitness_routines').delete().eq('id', r.id), 'Routine deleted')) {
      closeModal();
      await refresh('fitRoutines');
      refresh('fitSteps');
    }
  },
  'fit-log-routine': el => openLog({ routine: routineById(el.dataset.id) }),
  'fit-step-add': () => {
    syncDraft();
    draft.steps.push(blankStep());
    redrawEditor();
  },
  'fit-step-remove': el => {
    syncDraft();
    draft.steps.splice(Number(el.dataset.i), 1);
    redrawEditor();
  },
  'fit-step-move': el => {
    syncDraft();
    const i = Number(el.dataset.i), j = i + Number(el.dataset.dir);
    if (j < 0 || j >= draft.steps.length) return;
    [draft.steps[i], draft.steps[j]] = [draft.steps[j], draft.steps[i]];
    redrawEditor();
  },
};

export const forms = {
  'fit-routine-save': async () => {
    syncDraft();
    const d = draft;
    const name = d.name.trim();
    const est = num(d.est_minutes, 10, 45);
    const rounds = num(d.rounds, 1, 10);
    if (!name || !CATEGORIES[d.category]) return;
    if (est === null) { toast('About how long should be 10 to 45 minutes.', 'error'); return; }
    if (rounds === null) { toast('Rounds should be 1 to 10.', 'error'); return; }
    if (!d.steps.length) { toast('Add at least one step.', 'error'); return; }
    const steps = [];
    for (const [i, st] of d.steps.entries()) {
      const label = st.label.trim();
      if (!st.exercise_id && !label) { toast(`Step ${i + 1}: pick an exercise or type a name.`, 'error'); return; }
      const amount = st.mode === 'time' ? num(st.amount, 5, 7200) : num(st.amount, 1, 500);
      if (amount === null) { toast(`Step ${i + 1}: enter ${st.mode === 'time' ? 'seconds (5 or more)' : 'how many reps'}.`, 'error'); return; }
      steps.push({
        position: i + 1,
        exercise_id: st.exercise_id || null,
        label: label || null,
        sets: num(st.sets, 1, 20),
        reps: st.mode === 'reps' ? amount : null,
        duration_sec: st.mode === 'time' ? amount : null,
        rest_sec: st.rest_sec === '' ? null : num(st.rest_sec, 0, 600),
      });
    }
    const row = { name, category: d.category, est_minutes: est, rounds, met_value: CATEGORIES[d.category][2], description: d.description.trim() || null };
    let id = d.id;
    if (id) {
      // Keep a custom intensity if the type didn't change
      const old = routineById(id);
      if (old && old.category === d.category) row.met_value = old.met_value;
      if (!await run(sb.from('fitness_routines').update(row).eq('id', id))) return;
      if (!await run(sb.from('fitness_routine_steps').delete().eq('routine_id', id))) return;
    } else {
      const { data, error } = await sb.from('fitness_routines').insert({ ...row, owner_id: state.user.id }).select('id').single();
      if (error) { await run(Promise.resolve({ error })); return; }
      id = data.id;
    }
    if (!await run(sb.from('fitness_routine_steps').insert(steps.map(s => ({ ...s, routine_id: id }))), d.id ? 'Routine saved' : 'Routine added')) return;
    draft = null;
    closeModal();
    await refresh('fitRoutines');
    await refresh('fitSteps');
  },
};
