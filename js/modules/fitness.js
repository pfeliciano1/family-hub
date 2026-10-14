// Fitness: each adult's own workouts. Routines, logging with calorie
// estimates, history, and settings. Private to the signed-in login, so
// it's hidden on the TV display and in Kid mode.
import { sb } from '../supabase.js';
import { state, update } from '../state.js';
import { esc, openModal, closeModal, toast, fmtDate, startOfToday, toISODate, safeColor } from '../utils.js';
import { run, refresh } from '../data.js';
import { CATEGORIES, CATEGORY_IDS, catLabel, catIcon, metFor, calories, fmtMinutes } from './fitcalc.js';
import { libraryView, routineById } from './fitroutines.js';

const TABS = [['routines', '📋', 'Routines'], ['log', '📝', 'Log & history'], ['settings', '⚙️', 'Settings']];

// Settings with their defaults until the person saves their own
function profile() {
  const p = state.fitProfile || {};
  return {
    weight_lbs: p.weight_lbs ?? null,
    // Until chosen, the calendars marked as yours count as busy
    workout_calendar_ids: p.user_id ? (p.workout_calendar_ids || [])
      : state.calendars.filter(c => c.member_id === state.me.id).map(c => c.id),
    slot_window_start: String(p.slot_window_start || '06:00').slice(0, 5),
    slot_window_end: String(p.slot_window_end || '21:00').slice(0, 5),
    slot_buffer_min: p.slot_buffer_min ?? 5,
    show_on_family_display: !!p.show_on_family_display,
  };
}

const hasWeight = () => Number(state.fitProfile?.weight_lbs) > 0;

// ---------- Page ----------

export function view() {
  const title = '<div class="page-title"><h2>🏋️ Fitness</h2></div>';
  if (state.tv) {
    return `${title}<div class="panel empty"><div class="empty-icon">🏋️</div>
      <p>Fitness is private to each person, so it's not shown on the TV display.</p></div>`;
  }
  if (state.fitnessMissing) {
    return `${title}<div class="panel empty"><div class="empty-icon">🛠️</div>
      <h3>One database update first</h3>
      <p>Run <code>database/fitness.sql</code> in Supabase's SQL Editor to turn on Fitness. See "Setting up Fitness" in the README.</p></div>`;
  }
  const tab = TABS.some(t => t[0] === state.fitTab) ? state.fitTab : 'routines';
  const body = tab === 'log' ? historyView() : tab === 'settings' ? settingsView() : libraryView();
  return `<div class="page-title"><h2>🏋️ Fitness</h2>
      <button class="btn primary" data-action="fit-log-new">＋ Log a workout</button></div>
    <p class="muted fit-private">🔒 Only you can see your workouts${state.fitProfile?.show_on_family_display ? '. Your streak shows on the family display.' : '.'}</p>
    <div class="tabs fit-tabs" role="tablist">${TABS.map(([id, icon, label]) =>
      `<button role="tab" aria-selected="${tab === id}" class="${tab === id ? 'active' : ''}" data-action="fit-tab" data-tab="${id}">${icon} ${label}</button>`).join('')}</div>
    ${body}`;
}

// ---------- History ----------

function logName(l) {
  const r = l.routine_id && routineById(l.routine_id);
  return r ? r.name : `${catLabel(l.category)}${l.source === 'manual' ? ' (logged by hand)' : ''}`;
}

function dayLabel(d) {
  const t = startOfToday();
  const diff = Math.round((t - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400e3);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return fmtDate(d, { weekday: 'long', month: 'short', day: 'numeric', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
}

function logRow(l) {
  const when = new Date(l.performed_at);
  const bits = [fmtMinutes(l.duration_min)];
  if (l.distance_mi) bits.push(`${Number(l.distance_mi).toFixed(2).replace(/\.?0+$/, '')} mi`);
  if (l.calories_est) bits.push(`≈ ${Math.round(l.calories_est)} cal est.`);
  if (l.effort_rpe) bits.push(`effort ${l.effort_rpe}/10`);
  return `<div class="fit-log">
    <span class="cd-icon">${catIcon(l.category)}</span>
    <div class="cd-main"><b>${esc(logName(l))}</b>
      <small>${when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} • ${esc(bits.join(' • '))}</small>
      ${l.notes ? `<small class="fit-note">${esc(l.notes)}</small>` : ''}</div>
    <div class="row-actions">
      <button class="icon-btn" data-action="fit-log-edit" data-id="${esc(l.id)}" title="Edit" aria-label="Edit this workout">✏️</button>
      <button class="icon-btn" data-action="fit-log-delete" data-id="${esc(l.id)}" title="Delete" aria-label="Delete this workout">🗑️</button>
    </div>
  </div>`;
}

function historyView() {
  const logs = state.fitLogs;
  if (!logs.length) {
    return `<div class="panel empty"><div class="empty-icon">📝</div>
      <h3>No workouts yet</h3>
      <p>Pick a routine and tap "I did this", or log a run, walk or class by hand.</p>
      <button class="btn primary" data-action="fit-log-new">Log a workout</button></div>`;
  }
  // This week, Monday to today
  const t = startOfToday();
  const monday = new Date(t);
  monday.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  const week = logs.filter(l => new Date(l.performed_at) >= monday);
  const weekMin = week.reduce((n, l) => n + Number(l.duration_min || 0), 0);
  const shown = state.fitShowAll ? logs : logs.slice(0, 40);
  const groups = [];
  for (const l of shown) {
    const label = dayLabel(new Date(l.performed_at));
    if (groups.at(-1)?.label !== label) groups.push({ label, items: [] });
    groups.at(-1).items.push(l);
  }
  return `<p class="fit-week"><b>This week:</b> ${week.length} workout${week.length === 1 ? '' : 's'} • ${fmtMinutes(weekMin)}</p>
    ${groups.map(g => `<h3 class="section-label">${esc(g.label)}</h3><div class="panel">${g.items.map(logRow).join('')}</div>`).join('')}
    ${logs.length > shown.length ? `<button class="btn" data-action="fit-show-all">Show all ${logs.length} workouts</button>` : ''}`;
}

// ---------- Logging ----------

// Opens the log form. { routine } for "I did this", { routine, minutes, when }
// from the workout player, { log } to edit, nothing for a workout entered by hand.
export function openLog(opts = {}) {
  if (!hasWeight()) {
    pending = opts;
    openModal(weightForm(true));
    return;
  }
  openModal(logForm(opts));
}
let pending = null; // what to log once the weight is saved

function weightForm(first) {
  return `<h2>⚖️ Your weight</h2>
    <form data-form="fit-weight">
      <p class="muted">${first ? 'Calorie estimates need your weight. ' : ''}It's only used for your own estimates and never shown to anyone else.</p>
      <div class="field"><label for="fw-lbs">Weight (lbs)</label>
        <input id="fw-lbs" name="weight_lbs" type="number" min="50" max="700" step="0.1" inputmode="decimal" required></div>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">Save and continue</button>
      </div>
    </form>`;
}

const pad = n => String(n).padStart(2, '0');
const localTime = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// { minutes, when } come from the workout player: how long it really took
function logForm({ routine, log, minutes: played, when: startedAt } = {}) {
  const r = routine || (log?.routine_id && routineById(log.routine_id)) || null;
  const when = log ? new Date(log.performed_at) : startedAt || new Date();
  const cat = log?.category || r?.category || 'cardio';
  const minutes = log?.duration_min ?? played ?? r?.est_minutes ?? '';
  return `<h2>${log ? 'Edit workout' : r ? `✅ ${esc(r.name)}` : 'Log a workout'}</h2>
    <form data-form="fit-log-save">
      <input type="hidden" name="id" value="${esc(log?.id || '')}">
      <input type="hidden" name="routine_id" value="${esc(r?.id || '')}">
      ${r ? `<input type="hidden" name="category" value="${esc(cat)}">` : `<div class="field"><label for="fl-cat">Type</label>
        <select id="fl-cat" name="category" data-toggle="fit-log-cat">${CATEGORY_IDS.map(c => `<option value="${c}" ${c === cat ? 'selected' : ''}>${catIcon(c)} ${catLabel(c)}</option>`).join('')}</select></div>`}
      <div class="field-row">
        <div class="field"><label for="fl-date">Day</label>
          <input id="fl-date" name="date" type="date" required max="${toISODate(new Date())}" value="${toISODate(when)}"></div>
        <div class="field"><label for="fl-time">Time</label>
          <input id="fl-time" name="time" type="time" required value="${localTime(when)}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="fl-min">Minutes</label>
          <input id="fl-min" name="duration_min" type="number" min="1" max="600" step="any" inputmode="decimal" required value="${esc(minutes)}"></div>
        <div class="field fit-distance" ${cat === 'run' ? '' : 'hidden'}><label for="fl-mi">Miles (optional)</label>
          <input id="fl-mi" name="distance_mi" type="number" min="0.01" max="200" step="0.01" inputmode="decimal" value="${esc(log?.distance_mi ?? '')}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="fl-rpe">How hard (optional)</label>
          <select id="fl-rpe" name="effort_rpe"><option value="">—</option>${Array.from({ length: 10 }, (_, i) => i + 1).map(n =>
            `<option value="${n}" ${Number(log?.effort_rpe) === n ? 'selected' : ''}>${n}${n === 1 ? ' (very easy)' : n === 5 ? ' (moderate)' : n === 10 ? ' (all out)' : ''}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label for="fl-notes">Notes (optional)</label>
        <input id="fl-notes" name="notes" maxlength="300" value="${esc(log?.notes || '')}" placeholder="e.g., Felt strong, hills on the second mile"></div>
      <p class="muted fit-cal-note">Calories are an estimate from your weight, the type of workout and how long it took.</p>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">${log ? 'Save changes' : 'Log it'}</button>
      </div>
    </form>`;
}

// ---------- Settings ----------

function settingsView() {
  const p = profile();
  const cals = state.calendars;
  const whose = c => state.members.find(m => m.id === c.member_id)?.display_name || 'Family';
  return `<form class="panel fit-settings" data-form="fit-settings">
      <h3>⚖️ Weight</h3>
      <div class="field fit-narrow"><label for="fs-lbs">Weight (lbs)</label>
        <input id="fs-lbs" name="weight_lbs" type="number" min="50" max="700" step="0.1" inputmode="decimal" value="${esc(p.weight_lbs ?? '')}">
        <small class="muted">Used for your calorie estimates only. Workouts you already logged keep the weight they were logged with.</small></div>

      <h3>📅 Open workout times</h3>
      <p class="muted">These settings are for finding free 15–30 minute slots in your day (coming in the next steps of Fitness).</p>
      <div class="fit-cals"><b class="fit-label">Calendars that count as busy</b>
        ${cals.length ? cals.map(c => `<label class="check opt"><input type="checkbox" name="cal" value="${esc(c.id)}" ${p.workout_calendar_ids.includes(c.id) ? 'checked' : ''}>
          <span><i class="dot" style="background:${safeColor(c.color)}"></i> ${esc(c.name)} <small class="muted">(${esc(whose(c))})</small></span></label>`).join('')
          : '<small class="muted">No calendars connected yet. Add one on the Calendar page.</small>'}
      </div>
      <div class="field-row fit-narrow">
        <div class="field"><label for="fs-start">Earliest</label><input id="fs-start" name="slot_window_start" type="time" required value="${esc(p.slot_window_start)}"></div>
        <div class="field"><label for="fs-end">Latest</label><input id="fs-end" name="slot_window_end" type="time" required value="${esc(p.slot_window_end)}"></div>
        <div class="field"><label for="fs-buf">Gap around events (min)</label><input id="fs-buf" name="slot_buffer_min" type="number" min="0" max="60" required inputmode="numeric" value="${esc(p.slot_buffer_min)}"></div>
      </div>

      <h3>📺 Family display</h3>
      <label class="check opt"><input type="checkbox" name="show_on_family_display" ${p.show_on_family_display ? 'checked' : ''}>
        <span>Show my streak and workouts this week on the family display
        <small class="muted">Only your first name, streak and number of workouts. Never your weight, calories or details.</small></span></label>

      <div class="modal-actions"><button type="submit" class="btn primary">Save settings</button></div>
    </form>
    <p class="muted fit-credit">Exercise pictures: <a href="https://github.com/yuhonas/free-exercise-db" target="_blank" rel="noopener noreferrer">Free Exercise DB</a> by yuhonas, public domain. Calories are estimates (MET formula), not medical advice.</p>`;
}

async function saveProfile(patch) {
  const row = { user_id: state.user.id, updated_at: new Date().toISOString(), ...patch };
  const ok = await run(sb.from('fitness_profiles').upsert(row, { onConflict: 'user_id' }));
  if (ok) await refresh('fitProfile');
  return ok;
}

const numOrNull = (v, lo, hi) => {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};

// ---------- Buttons and forms ----------

export const actions = {
  'fit-tab': el => {
    update({ fitTab: el.dataset.tab });
    window.scrollTo(0, 0);
  },
  'fit-log-new': () => openLog(),
  'fit-log-edit': el => {
    const log = state.fitLogs.find(l => l.id === el.dataset.id);
    if (log) openModal(logForm({ log }));
  },
  'fit-log-delete': async el => {
    const log = state.fitLogs.find(l => l.id === el.dataset.id);
    if (!log || !confirm(`Delete "${logName(log)}" from ${dayLabel(new Date(log.performed_at)).toLowerCase()}?`)) return;
    if (await run(sb.from('fitness_logs').delete().eq('id', log.id), 'Workout deleted')) refresh('fitLogs');
  },
  'fit-show-all': () => update({ fitShowAll: true }),
};

export const toggles = {
  // Miles only make sense for runs
  'fit-log-cat': el => {
    const box = el.form?.querySelector('.fit-distance');
    if (box) box.hidden = el.value !== 'run';
  },
};

export const forms = {
  'fit-weight': async d => {
    const w = numOrNull(d.weight_lbs, 50, 700);
    if (w === null) { toast('Enter a weight between 50 and 700 lbs.', 'error'); return; }
    if (!await saveProfile({ ...profileRow(), weight_lbs: w, weight_updated_at: new Date().toISOString() })) return;
    const next = pending;
    pending = null;
    if (next) openModal(logForm(next));
    else closeModal();
  },
  'fit-settings': async (d, f) => {
    const p = profile();
    const w = d.weight_lbs === '' ? null : numOrNull(d.weight_lbs, 50, 700);
    if (d.weight_lbs !== '' && w === null) { toast('Enter a weight between 50 and 700 lbs.', 'error'); return; }
    if (d.slot_window_end <= d.slot_window_start) { toast('Latest has to be after earliest.', 'error'); return; }
    const buf = numOrNull(d.slot_buffer_min, 0, 60);
    const row = {
      weight_lbs: w,
      workout_calendar_ids: [...f.querySelectorAll('input[name=cal]:checked')].map(i => i.value),
      slot_window_start: d.slot_window_start,
      slot_window_end: d.slot_window_end,
      slot_buffer_min: buf === null ? 5 : Math.round(buf),
      show_on_family_display: !!d.show_on_family_display,
    };
    if (w !== p.weight_lbs) row.weight_updated_at = new Date().toISOString();
    if (await saveProfile(row)) toast('Fitness settings saved', 'success');
  },
  'fit-log-save': async d => {
    const minutes = numOrNull(d.duration_min, 0.01, 600);
    if (minutes === null) { toast('Enter how many minutes (1 to 600).', 'error'); return; }
    const category = CATEGORIES[d.category] ? d.category : 'cardio';
    const miles = category === 'run' && d.distance_mi !== '' ? numOrNull(d.distance_mi, 0.01, 200) : null;
    if (category === 'run' && d.distance_mi !== '' && miles === null) { toast('Miles should be between 0.01 and 200.', 'error'); return; }
    const when = new Date(`${d.date}T${d.time}`);
    if (Number.isNaN(+when)) { toast('Check the day and time.', 'error'); return; }
    if (when > new Date(Date.now() + 5 * 60e3)) { toast('That time is in the future.', 'error'); return; }
    const old = d.id ? state.fitLogs.find(l => l.id === d.id) : null;
    const routine = d.routine_id ? routineById(d.routine_id) : null;
    // Keep the weight a workout was first logged with, so editing it later
    // doesn't change its calories when your weight has changed since
    const weight = old?.weight_lbs_snapshot ?? state.fitProfile?.weight_lbs ?? null;
    const met = metFor({ category, routineMet: routine?.met_value, miles, minutes });
    const row = {
      category,
      routine_id: d.routine_id || null,
      performed_at: when.toISOString(),
      duration_min: Math.round(minutes * 10) / 10,
      distance_mi: miles,
      effort_rpe: d.effort_rpe ? Number(d.effort_rpe) : null,
      notes: (d.notes || '').trim() || null,
      weight_lbs_snapshot: weight,
      met_value: met,
      calories_est: weight ? calories(met, weight, minutes) : null,
    };
    const ok = old
      ? await run(sb.from('fitness_logs').update(row).eq('id', old.id), 'Workout saved')
      : await run(sb.from('fitness_logs').insert({ ...row, user_id: state.user.id, source: d.routine_id ? 'routine' : 'manual' }),
        row.calories_est ? `Logged! About ${row.calories_est} calories (est.) 💪` : 'Logged! 💪');
    if (!ok) return;
    closeModal();
    await refresh('fitLogs');
    if (!old && state.fitTab !== 'log') update({ fitTab: 'log' });
  },
};

// The saved settings as a row, so saving one setting keeps the others
function profileRow() {
  const p = profile();
  return {
    workout_calendar_ids: p.workout_calendar_ids,
    slot_window_start: p.slot_window_start,
    slot_window_end: p.slot_window_end,
    slot_buffer_min: p.slot_buffer_min,
    show_on_family_display: p.show_on_family_display,
  };
}
