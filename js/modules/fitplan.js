// Fitness weekly plan: pick a routine, the days and a time, and Google
// Calendar opens with a repeating workout ready to save. Once saved, it
// comes back through your calendar feed like any other event, and the
// Fitness page shows your planned workouts with a Start button.
import { state } from '../state.js';
import { esc, openModal, closeModal, startOfToday, fmtDate, toISODate, toast } from '../utils.js';
import { addDays, fmtTime, googleEventUrl } from './calendar.js';
import { catIcon } from './fitcalc.js';
import { profile } from './fitness.js';
import { stepsOf } from './fitroutines.js';

export const MARK = '🏋️'; // planned workouts start with this, so they can be found again
const DAYS = [['MO', 'Mon'], ['TU', 'Tue'], ['WE', 'Wed'], ['TH', 'Thu'], ['FR', 'Fri'], ['SA', 'Sat'], ['SU', 'Sun']];
const JS_DAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

// ---------- Planned workouts from the calendar ----------

// Your calendars: the ones picked in Fitness settings, or else the ones marked as yours
function myCalendarIds() {
  const picked = profile().workout_calendar_ids;
  return new Set(picked.length ? picked : state.calendars.filter(c => c.member_id === state.me.id).map(c => c.id));
}

const routineFor = title => {
  const name = title.replace(MARK, '').replace(/️/g, '').trim().toLowerCase();
  return state.fitRoutines.find(r => r.name.toLowerCase() === name)
    || state.fitRoutines.find(r => name.includes(r.name.toLowerCase()));
};

// Workouts on your calendars from now to the end of the next 6 days
export function plannedWorkouts(now = new Date()) {
  const ids = myCalendarIds();
  const until = addDays(startOfToday(), 7);
  const seen = new Set();
  return (state.events?.list || [])
    .filter(e => !e.allDay && ids.has(e.calendar_id) && e.title?.trim().startsWith(MARK.replace(/️/g, '')))
    .filter(e => e.end > now && e.start < until)
    .filter(e => {
      const k = `${e.uid}|${+e.start}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.start - b.start)
    .map(e => ({ ...e, routine: routineFor(e.title) }));
}

function dayName(d) {
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - startOfToday()) / 86400e3);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' });
}

// ---------- The panel at the top of Fitness ----------

export function planPanel() {
  const list = plannedWorkouts();
  const today = toISODate(new Date());
  let body;
  if (!state.calendars.length) {
    body = '<p class="muted">Connect your Google calendar on the Calendar page, then plan your workouts here.</p>';
  } else if (!state.events) {
    body = '<p class="muted">Loading your calendar…</p>';
  } else if (!list.length) {
    body = '<p class="muted">No workouts planned this week. Plan the days and time you can work out, and they\'ll show here and on the Calendar.</p>';
  } else {
    body = `<div class="fit-plan-list">${list.map(e => {
      const isToday = toISODate(e.start) === today;
      return `<div class="fit-plan ${isToday ? 'today' : ''}">
        <span class="cd-icon">${e.routine ? catIcon(e.routine.category) : MARK}</span>
        <div class="cd-main"><b>${esc(e.routine?.name || e.title.replace(MARK, '').trim() || 'Workout')}</b>
          <small class="muted">${esc(dayName(e.start))} • ${esc(fmtTime(e.start))}${e.routine ? ` • ${e.routine.est_minutes} min` : ''}</small></div>
        ${isToday && e.routine ? `<button class="btn sm primary" data-action="fit-routine-start" data-id="${esc(e.routine.id)}">▶ Start</button>` : ''}
      </div>`;
    }).join('')}</div>`;
  }
  if (state.events?.error) body += `<p class="muted small">⚠️ ${esc(state.events.error)}</p>`;
  return `<section class="panel fit-planned">
      <div class="fit-planned-head"><h3>📅 My workout week</h3>
        <button class="btn sm" data-action="fit-plan-new">＋ Plan a workout</button></div>
      ${body}
    </section>`;
}

// ---------- Planning a repeating workout ----------

function planForm() {
  const routines = state.fitRoutines.filter(r => stepsOf(r.id).length)
    .sort((a, b) => (a.owner_id ? 0 : 1) - (b.owner_id ? 0 : 1) || a.name.localeCompare(b.name));
  return `<h2>📅 Plan a workout</h2>
    <form data-form="fit-plan-save" id="fit-plan-form">
      <div class="field"><label for="fp-routine">Routine</label>
        <select id="fp-routine" name="routine_id" required>${routines.map(r =>
          `<option value="${esc(r.id)}">${catIcon(r.category)} ${esc(r.name)} (${r.est_minutes} min)</option>`).join('')}</select></div>
      <div class="field"><span class="fit-label">Days</span>
        <div class="fit-days">${DAYS.map(([code, label]) => `<label class="fit-day"><input type="checkbox" name="day_${code}"><span>${label}</span></label>`).join('')}</div></div>
      <div class="field fit-narrow"><label for="fp-time">Time</label>
        <input id="fp-time" name="time" type="time" required value="08:30"></div>
      <p class="muted small">This opens Google Calendar with a weekly repeating event filled in. Tap <b>Save</b> there, and it shows up here and on the Calendar page. Google can take a little while to send new events to Family Hub.</p>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">Open Google Calendar</button>
      </div>
    </form>`;
}

// The first chosen weekday from today on (today only if the time is still ahead)
export function firstDate(codes, time, now = new Date()) {
  const [h, m] = time.split(':').map(Number);
  for (let i = 0; i < 7; i++) {
    const d = addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), i);
    if (!codes.some(c => JS_DAY[c] === d.getDay())) continue;
    if (i === 0 && new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m) <= now) continue;
    return d;
  }
  return addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), 7); // only today was picked, and it's passed
}

export function planUrl(routine, codes, time, now = new Date()) {
  const day = firstDate(codes, time, now);
  const [h, m] = time.split(':').map(Number);
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m + Number(routine.est_minutes || 30));
  const hhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const base = googleEventUrl({ title: `${MARK} ${routine.name}`, date: toISODate(day), start: time, end: hhmm(end) });
  return `${base}&recur=${encodeURIComponent(`RRULE:FREQ=WEEKLY;BYDAY=${codes.join(',')}`)}`;
}

// ---------- Buttons and forms ----------

export const actions = {
  'fit-plan-new': () => openModal(planForm()),
};

export const forms = {
  'fit-plan-save': d => {
    const routine = state.fitRoutines.find(r => r.id === d.routine_id);
    const codes = DAYS.map(([c]) => c).filter(c => d[`day_${c}`]);
    if (!routine) return;
    if (!codes.length) { toast('Pick at least one day.', 'error'); return; }
    if (!/^\d{2}:\d{2}$/.test(d.time || '')) { toast('Pick a time.', 'error'); return; }
    // Opened right away from the tap, so phones don't block it
    window.open(planUrl(routine, codes, d.time), '_blank', 'noopener');
    closeModal();
    toast('Save the event in Google Calendar to finish', 'success');
  },
};
