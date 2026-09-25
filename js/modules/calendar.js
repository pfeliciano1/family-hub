// Calendar: the family's Google calendars combined into one schedule.
// Events are read through the calendar-feed server function (see
// supabase/functions/calendar-feed). New events are created in Google
// Calendar itself; "+ Event" opens it with the details filled in.
import { sb } from '../supabase.js';
import { state, update } from '../state.js';
import {
  esc, safeColor, parseDate, startOfToday, toISODate, fmtDate, cardHead, emptyMini,
  openModal, closeModal, toast,
} from '../utils.js';
import { run, refresh } from '../data.js';

const PALETTE = ['#1976d2', '#8e24aa', '#2e7d32', '#ef6c00', '#c62828', '#00838f', '#6d4c41', '#3949ab'];
const FRESH_MS = 15 * 60 * 1000;
const RETRY_MS = 2 * 60 * 1000;
const MAX_DAYS = 115; // the server function accepts up to 120

// ---------- Dates ----------

export function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function startOfWeek(d) {
  return addDays(d, -d.getDay()); // weeks start on Sunday
}

const sameDay = (a, b) => toISODate(a) === toISODate(b);

export function fmtTime(d) {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(':00', '');
}

function anchorDate() {
  return parseDate(state.calDate) || startOfToday();
}

// ---------- Loading ----------

// The days that need events: the next two weeks for Home, plus whatever
// the calendar page is showing.
function neededRange() {
  const today = startOfToday();
  const home = { from: addDays(today, -1), to: addDays(today, 15) };
  if (state.view !== 'calendar') return home;
  const a = anchorDate();
  const monthStart = new Date(a.getFullYear(), a.getMonth(), 1);
  const page = {
    from: addDays(startOfWeek(monthStart), -1),
    to: addDays(startOfWeek(new Date(a.getFullYear(), a.getMonth() + 1, 1)), 8),
  };
  const both = {
    from: page.from < home.from ? page.from : home.from,
    to: page.to > home.to ? page.to : home.to,
  };
  return (both.to - both.from) / 86400000 <= MAX_DAYS ? both : page;
}

function normalize(e) {
  const start = e.allDay ? parseDate(e.start) : new Date(e.start);
  const end = e.allDay ? parseDate(e.end) : new Date(e.end);
  return { ...e, start, end, key: `${e.calendar_id}|${e.uid}|${e.start}` };
}

async function describeFailure(err) {
  const status = err?.context?.status;
  if (status === 404) return 'The calendar-feed server function isn\'t set up yet. See "Setting up the calendar" in the README.';
  if (status === 401) return 'Please sign out and sign back in to load the calendar.';
  try {
    const body = await err.context.json();
    if (body?.error) return body.error;
  } catch { /* no details */ }
  if (err?.name === 'FunctionsFetchError') return 'Can\'t reach the calendar service. If this keeps happening, check that the calendar-feed function is deployed.';
  return 'The calendar is unavailable right now.';
}

let loadingKey = null;

export async function loadEvents(force = false) {
  if (!state.me) return;
  if (state.calendarsMissing || !state.calendars.length) {
    if (state.events) update({ events: null });
    return;
  }
  const { from, to } = neededRange();
  const ev = state.events;
  const age = ev ? Date.now() - ev.fetchedAt : Infinity;
  const covered = ev && !ev.error && ev.from <= from && ev.to >= to;
  if (!force && covered && age < FRESH_MS) return;
  if (!force && ev?.error && age < RETRY_MS) return;

  const key = `${+from}-${+to}`;
  if (loadingKey === key) return;
  loadingKey = key;
  try {
    const { data, error } = await sb.functions.invoke('calendar-feed', {
      body: { from: from.toISOString(), to: to.toISOString() },
    });
    if (error) throw error;
    update({
      events: {
        from, to, fetchedAt: Date.now(), ok: true,
        list: (data.events || []).map(normalize),
        errors: data.errors || [],
      },
    });
  } catch (err) {
    console.error(err);
    const message = await describeFailure(err);
    // Keep showing what we had, with a note that it couldn't refresh
    update({ events: { ...(ev || { list: [], errors: [] }), error: message, fetchedAt: Date.now() } });
  } finally {
    if (loadingKey === key) loadingKey = null;
  }
}

// ---------- Reading events ----------

function calendarInfo(id) {
  const cal = state.calendars.find(c => c.id === id);
  if (!cal) return { name: 'Calendar', color: '#1976d2', who: 'Family' };
  const m = state.members.find(x => x.id === cal.member_id);
  return { name: cal.name, color: safeColor(m ? m.color : cal.color), who: m ? m.display_name : 'Family' };
}

// The same event often appears on two people's calendars (an invite).
// Show it once, with both people.
function combined() {
  const list = state.events?.list || [];
  const seen = new Map();
  for (const e of list) {
    const id = `${e.uid}|${+e.start}`;
    const hit = seen.get(id);
    if (hit) {
      if (!hit.calendars.includes(e.calendar_id)) hit.calendars.push(e.calendar_id);
    } else {
      seen.set(id, { ...e, calendars: [e.calendar_id] });
    }
  }
  return [...seen.values()];
}

function byTime(a, b) {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return a.start - b.start || a.title.localeCompare(b.title);
}

export function eventsOn(day) {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const end = addDays(start, 1);
  return combined()
    .filter(e => (e.start < end && e.end > start) || (+e.start === +e.end && e.start >= start && e.start < end))
    .sort(byTime);
}

// Timed events still ahead in the next `hours` (used by weather tips).
export function upcomingTimedEvents(hours = 24) {
  const now = new Date();
  const until = new Date(now.getTime() + hours * 3600e3);
  return combined().filter(e => !e.allDay && e.end > now && e.start < until).sort(byTime);
}

function whoOf(e) {
  const infos = e.calendars.map(calendarInfo);
  return { color: infos[0].color, who: [...new Set(infos.map(i => i.who))].join(' & ') };
}

function timeLabel(e, day) {
  if (e.allDay) return 'All day';
  const startsToday = !day || sameDay(e.start, day);
  return startsToday ? fmtTime(e.start) : 'Continues';
}

// ---------- Home card ----------

let tipFor = () => null;
// weather.js registers its tip function here, so events can show a weather hint.
export function setTipProvider(fn) { tipFor = fn; }

function eventRow(e, day, showWho = true) {
  const { color, who } = whoOf(e);
  const tip = tipFor(e);
  return `<button class="ev-row" data-action="event-open" data-key="${esc(e.key)}" style="--c:${color}">
    <span class="ev-time">${timeLabel(e, day)}</span>
    <span class="ev-title">${esc(e.title)}${tip ? ` <span class="ev-tip" title="${esc(tip.text)}">${tip.icon}</span>` : ''}</span>
    ${showWho ? `<span class="chip" style="--c:${color}">${esc(who)}</span>` : ''}
  </button>`;
}

export function todayCard() {
  const head = cardHead('📅', 'Today\'s Calendar', 'calendar');
  let body;
  if (state.calendarsMissing) {
    body = '<div class="empty-mini">Run the Alpha 0.5 database update to turn on the calendar. See the README.</div>';
  } else if (!state.calendars.length) {
    body = emptyMini('Show everyone\'s Google calendars here.', 'calendar-new', 'Connect a calendar');
  } else if (!state.events) {
    body = '<p class="muted">Loading…</p>';
  } else if (!state.events.ok) {
    body = `<p class="muted small">⚠️ ${esc(state.events.error)}</p>`;
  } else {
    const today = startOfToday();
    const list = eventsOn(today);
    if (list.length) {
      body = list.slice(0, 6).map(e => eventRow(e, today)).join('') +
        (list.length > 6 ? `<a class="more" href="#/calendar">+${list.length - 6} more</a>` : '');
    } else {
      const next = combined().filter(e => e.start >= addDays(today, 1)).sort((a, b) => a.start - b.start)[0];
      body = `<p class="muted">Nothing on the calendar today.</p>
        ${next ? `<div class="ev-next">Next: <b>${esc(next.title)}</b> • ${fmtDate(next.start, { weekday: 'short', month: 'short', day: 'numeric' })}${next.allDay ? '' : `, ${fmtTime(next.start)}`}</div>` : ''}`;
    }
    if (state.events.error) body += `<p class="muted small">⚠️ ${esc(state.events.error)}</p>`;
  }
  return `<div class="card">${head}${body}</div>`;
}

// ---------- Calendar page ----------

function periodLabel(view, a) {
  if (view === 'day') return fmtDate(a, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  if (view === 'month') return fmtDate(a, { month: 'long', year: 'numeric' });
  const s = startOfWeek(a);
  const e = addDays(s, 6);
  const sameMonth = s.getMonth() === e.getMonth();
  return `${fmtDate(s, { month: 'short', day: 'numeric' })} – ${fmtDate(e, sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' })}, ${e.getFullYear()}`;
}

function dayView(a) {
  const list = eventsOn(a);
  return `<div class="panel">${list.length
    ? list.map(e => eventRow(e, a)).join('')
    : '<div class="empty"><p>Nothing on the calendar this day.</p></div>'}</div>`;
}

function weekView(a) {
  const s = startOfWeek(a);
  const today = startOfToday();
  const days = [...Array(7)].map((_, i) => addDays(s, i));
  return `<div class="week">${days.map(d => {
    const list = eventsOn(d);
    return `<div class="week-day ${sameDay(d, today) ? 'is-today' : ''}">
      <button class="wd-head" data-action="cal-day" data-date="${toISODate(d)}">
        <span>${fmtDate(d, { weekday: 'short' })}</span><b>${d.getDate()}</b></button>
      ${list.length ? list.map(e => eventRow(e, d, false)).join('') : '<p class="wd-empty">—</p>'}
    </div>`;
  }).join('')}</div>`;
}

function monthView(a) {
  const first = new Date(a.getFullYear(), a.getMonth(), 1);
  const s = startOfWeek(first);
  const today = startOfToday();
  const weeks = Math.ceil((first.getDay() + new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate()) / 7);
  const cells = [...Array(weeks * 7)].map((_, i) => addDays(s, i));
  const names = [...Array(7)].map((_, i) => fmtDate(addDays(s, i), { weekday: 'short' }));
  return `<div class="month">
    ${names.map(n => `<div class="m-name">${n}</div>`).join('')}
    ${cells.map(d => {
      const list = eventsOn(d);
      const out = d.getMonth() !== a.getMonth();
      return `<button class="m-cell ${out ? 'out' : ''} ${sameDay(d, today) ? 'is-today' : ''}" data-action="cal-day" data-date="${toISODate(d)}"
          aria-label="${fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' })}, ${list.length} events">
        <span class="m-num">${d.getDate()}</span>
        ${list.slice(0, 3).map(e => `<span class="m-ev" style="--c:${whoOf(e).color}">${e.allDay ? '' : `${fmtTime(e.start)} `}${esc(e.title)}</span>`).join('')}
        ${list.length > 3 ? `<span class="m-more">+${list.length - 3} more</span>` : ''}
        <span class="m-dots">${list.slice(0, 4).map(e => `<i style="--c:${whoOf(e).color}"></i>`).join('')}</span>
      </button>`;
    }).join('')}
  </div>`;
}

function legend() {
  return `<div class="cal-legend">${state.calendars.map(c => {
    const i = calendarInfo(c.id);
    const label = i.who === 'Family' || i.who.toLowerCase() === c.name.toLowerCase() ? c.name : `${i.who}: ${c.name}`;
    return `<span class="chip" style="--c:${i.color}">${esc(label)}</span>`;
  }).join('')}<a href="#/settings" class="small">Manage calendars</a></div>`;
}

function problems() {
  const ev = state.events;
  if (!ev) return '';
  const lines = [];
  if (ev.error) lines.push(ev.error);
  for (const p of ev.errors || []) lines.push(`Couldn't read "${calendarInfo(p.calendar_id).name}": ${p.message}`);
  return lines.length ? `<div class="notice warn">${lines.map(l => `<div>⚠️ ${esc(l)}</div>`).join('')}
    <button class="link" data-action="cal-reload">Try again</button></div>` : '';
}

export function view() {
  const title = `<div class="page-title"><h2>📅 Calendar</h2>
    <button class="btn primary" data-action="event-new">＋ Event</button></div>`;
  if (state.calendarsMissing) {
    return `${title}<div class="panel empty"><div class="empty-icon">🛠️</div>
      <h3>One database update first</h3>
      <p>Run <code>database/setup.sql</code> again in Supabase's SQL Editor to add calendars. Your existing data stays put.</p></div>`;
  }
  if (!state.calendars.length) {
    return `${title}<div class="panel empty"><div class="empty-icon">📅</div>
      <h3>Connect your Google calendars</h3>
      <p>Add each person's calendar and Family Hub combines them into one schedule, colored by family member.</p>
      <button class="btn primary" data-action="calendar-new">Connect a calendar</button></div>`;
  }
  const v = state.calView;
  const a = anchorDate();
  let body;
  if (!state.events) body = '<div class="panel empty">Loading your calendars…</div>';
  else body = v === 'day' ? dayView(a) : v === 'month' ? monthView(a) : weekView(a);
  return `${title}
    <div class="cal-bar">
      <div class="tabs" role="tablist">
        ${['day', 'week', 'month'].map(x => `<button class="${v === x ? 'active' : ''}" data-action="cal-view" data-view="${x}">${x[0].toUpperCase() + x.slice(1)}</button>`).join('')}
      </div>
      <div class="cal-nav">
        <button class="btn sm" data-action="cal-move" data-step="-1" aria-label="Previous">‹</button>
        <button class="btn sm" data-action="cal-today">Today</button>
        <button class="btn sm" data-action="cal-move" data-step="1" aria-label="Next">›</button>
        <b>${periodLabel(v, a)}</b>
      </div>
    </div>
    ${problems()}
    ${body}
    ${legend()}`;
}

// ---------- Event details ----------

function eventDetails(e) {
  const { color, who } = whoOf(e);
  let when;
  if (e.allDay) {
    const last = addDays(e.end, -1);
    when = sameDay(e.start, last)
      ? `${fmtDate(e.start, { weekday: 'long', month: 'long', day: 'numeric' })} • All day`
      : `${fmtDate(e.start, { weekday: 'short', month: 'short', day: 'numeric' })} – ${fmtDate(last, { weekday: 'short', month: 'short', day: 'numeric' })}`;
  } else {
    when = sameDay(e.start, e.end)
      ? `${fmtDate(e.start, { weekday: 'long', month: 'long', day: 'numeric' })} • ${fmtTime(e.start)} – ${fmtTime(e.end)}`
      : `${fmtDate(e.start, { weekday: 'short', month: 'short', day: 'numeric' })} ${fmtTime(e.start)} – ${fmtDate(e.end, { weekday: 'short', month: 'short', day: 'numeric' })} ${fmtTime(e.end)}`;
  }
  const tip = tipFor(e);
  const cals = e.calendars.map(id => calendarInfo(id).name).join(', ');
  return `<h2>${esc(e.title)}</h2>
    <div class="ev-detail" style="--c:${color}">
      <p>🕒 ${when}</p>
      <p>👤 <span class="chip" style="--c:${color}">${esc(who)}</span> <span class="muted">${esc(cals)}</span></p>
      ${e.location ? `<p>📍 <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.location)}" target="_blank" rel="noopener">${esc(e.location)}</a></p>` : ''}
      ${tip ? `<p>${tip.icon} ${esc(tip.text)}</p>` : ''}
    </div>
    <p class="muted small">To change this event, open it in Google Calendar.</p>
    <div class="modal-actions"><button class="btn" data-action="close-modal">Close</button></div>`;
}

// ---------- New event (opens Google Calendar) ----------

function nextHour() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

const hhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

function eventForm() {
  const onPage = state.view === 'calendar' && state.calDate;
  const start = nextHour();
  const date = onPage ? state.calDate : toISODate(start);
  const end = new Date(start.getTime() + 3600e3);
  return `<h2>New event</h2>
    <form data-form="event-open-google">
      <div class="field"><label for="e-title">What</label>
        <input id="e-title" name="title" required maxlength="200" placeholder="e.g., Soccer practice"></div>
      <div class="field-row">
        <div class="field"><label for="e-date">Date</label>
          <input id="e-date" type="date" name="date" required value="${esc(date)}"></div>
        <div class="field"><label for="e-start">Starts</label>
          <input id="e-start" type="time" name="start" value="${hhmm(start)}"></div>
        <div class="field"><label for="e-end">Ends</label>
          <input id="e-end" type="time" name="end" value="${hhmm(end)}"></div>
      </div>
      <label class="check opt"><input type="checkbox" name="allday" value="1"> <span>All-day event</span></label>
      <div class="field"><label for="e-loc">Where (optional)</label>
        <input id="e-loc" name="location" maxlength="200" placeholder="e.g., Smith Park"></div>
      <p class="muted small">Google Calendar opens with this filled in. Choose whose calendar it goes on there and click Save.
        It shows up in Family Hub within a few minutes.</p>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">Open Google Calendar</button>
      </div>
    </form>`;
}

const compact = d => `${toISODate(d).replace(/-/g, '')}T${hhmm(d).replace(':', '')}00`;

export function googleEventUrl({ title, date, start, end, allday, location }) {
  const day = parseDate(date);
  let dates;
  if (allday || !start) {
    dates = `${toISODate(day).replace(/-/g, '')}/${toISODate(addDays(day, 1)).replace(/-/g, '')}`;
  } else {
    const [sh, sm] = start.split(':').map(Number);
    const s = new Date(day.getFullYear(), day.getMonth(), day.getDate(), sh, sm);
    let e;
    if (end) {
      const [eh, em] = end.split(':').map(Number);
      e = new Date(day.getFullYear(), day.getMonth(), day.getDate(), eh, em);
      if (e <= s) e = new Date(e.getTime() + 86400e3); // ends after midnight
    } else {
      e = new Date(s.getTime() + 3600e3);
    }
    dates = `${compact(s)}/${compact(e)}`;
  }
  const p = new URLSearchParams({ action: 'TEMPLATE', text: title, dates });
  if (location) p.set('location', location);
  try { p.set('ctz', Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { /* browser default */ }
  return `https://calendar.google.com/calendar/render?${p}`;
}

// ---------- Managing calendars (shown in Settings) ----------

export function settingsPanel() {
  if (state.calendarsMissing) {
    return `<section class="panel wide"><h3>📅 Calendars</h3>
      <p class="muted">Run <code>database/setup.sql</code> again in Supabase's SQL Editor to turn on calendars.</p></section>`;
  }
  const rows = state.calendars.map(c => {
    const i = calendarInfo(c.id);
    return `<div class="member-row">
      <span class="cal-dot" style="--c:${i.color}"></span>
      <div class="mr-main"><b>${esc(c.name)}</b><small>${i.who === 'Family' ? 'Whole family' : esc(i.who)}</small></div>
      <div class="row-actions">
        <button class="icon-btn" data-action="calendar-edit" data-id="${esc(c.id)}" title="Edit" aria-label="Edit ${esc(c.name)}">✏️</button>
        <button class="icon-btn" data-action="calendar-delete" data-id="${esc(c.id)}" title="Remove" aria-label="Remove ${esc(c.name)}">🗑️</button>
      </div></div>`;
  }).join('');
  return `<section class="panel wide">
    <div class="panel-head"><h3>📅 Calendars</h3>
      <button class="btn primary sm" data-action="calendar-new">＋ Connect a calendar</button></div>
    ${rows || '<p class="muted">No calendars yet. Connect each person\'s Google Calendar to see everything in one place.</p>'}
  </section>`;
}

function calendarForm(c = {}) {
  const isNew = !c.id;
  const color = c.color || PALETTE[state.calendars.length % PALETTE.length];
  return `<h2>${isNew ? 'Connect a Google calendar' : `Edit ${esc(c.name)}`}</h2>
    <form data-form="calendar-save">
      <input type="hidden" name="id" value="${esc(c.id || '')}">
      <div class="field"><label for="c-name">Name</label>
        <input id="c-name" name="name" required maxlength="60" value="${esc(c.name || '')}" placeholder="e.g., Paul's calendar, School events"></div>
      <div class="field"><label for="c-who">Whose calendar?</label>
        <select id="c-who" name="member_id"><option value="">Whole family</option>
          ${state.members.map(m => `<option value="${esc(m.id)}" ${m.id === c.member_id ? 'selected' : ''}>${esc(m.display_name)}</option>`).join('')}
        </select><small class="muted">Events use this person's color.</small></div>
      <div class="field"><label for="c-url">Secret address in iCal format</label>
        <input id="c-url" name="ical_url" required maxlength="1000" value="${esc(c.ical_url || '')}"
          placeholder="https://calendar.google.com/calendar/ical/…/private-…/basic.ics" autocomplete="off"></div>
      <details class="howto"><summary>Where do I find this?</summary>
        <ol>
          <li>Open <b>Google Calendar on a computer</b> (calendar.google.com). The phone app doesn't show it.</li>
          <li>Click ⚙️ <b>Settings</b>, then under <b>Settings for my calendars</b> click the calendar.</li>
          <li>Scroll to <b>Integrate calendar</b> and copy <b>Secret address in iCal format</b>.</li>
        </ol>
        <p>Anyone with this address can see the calendar, so only paste it here. If it ever leaks, click <b>Reset</b> next to it in Google and paste the new one.</p>
      </details>
      <div class="field"><label>Color (used for the whole family calendar)</label>
        <div class="swatches">${PALETTE.map(x => `<label class="swatch" style="--c:${x}">
          <input type="radio" name="color" value="${x}" ${x === color ? 'checked' : ''} aria-label="Color ${x}"><span></span></label>`).join('')}</div></div>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">${isNew ? 'Connect' : 'Save changes'}</button>
      </div>
    </form>`;
}

function checkAddress(url) {
  if (!/^(https|webcal):\/\//i.test(url)) return 'The address should start with https://';
  if (/calendar\.google\.com\/calendar\/(embed|u\/|r\b|render)/i.test(url)) {
    return 'That\'s the web link. Use "Secret address in iCal format" (it ends in .ics).';
  }
  if (/calendar\.google\.com/i.test(url) && /\/public\/basic\.ics/i.test(url)) {
    return 'That\'s the public address, which only works for public calendars. Use "Secret address in iCal format".';
  }
  return null;
}

// ---------- Buttons and forms ----------

function move(step) {
  const a = anchorDate();
  const v = state.calView;
  const d = v === 'day' ? addDays(a, step)
    : v === 'week' ? addDays(a, 7 * step)
    : new Date(a.getFullYear(), a.getMonth() + step, 1);
  update({ calDate: toISODate(d) });
  loadEvents();
}

export const actions = {
  'cal-view': el => { update({ calView: el.dataset.view }); loadEvents(); },
  'cal-move': el => move(Number(el.dataset.step)),
  'cal-today': () => { update({ calDate: toISODate(startOfToday()) }); loadEvents(); },
  'cal-day': el => { update({ calView: 'day', calDate: el.dataset.date }); loadEvents(); },
  'cal-reload': () => loadEvents(true),
  'event-open': el => {
    const e = combined().find(x => x.key === el.dataset.key);
    if (e) openModal(eventDetails(e));
  },
  'event-new': () => openModal(eventForm()),
  'calendar-new': () => openModal(calendarForm()),
  'calendar-edit': el => openModal(calendarForm(state.calendars.find(c => c.id === el.dataset.id))),
  'calendar-delete': async el => {
    const c = state.calendars.find(x => x.id === el.dataset.id);
    if (!c || !confirm(`Remove "${c.name}" from Family Hub? Nothing changes in Google Calendar.`)) return;
    if (await run(sb.from('calendars').delete().eq('id', c.id), 'Calendar removed')) refresh('calendars');
  },
};

export const forms = {
  'calendar-save': async d => {
    const url = d.ical_url.trim();
    const problem = checkAddress(url);
    if (problem) { toast(problem, 'error'); return; }
    const row = { name: d.name.trim(), ical_url: url, member_id: d.member_id || null, color: d.color || PALETTE[0] };
    const query = d.id
      ? sb.from('calendars').update(row).eq('id', d.id)
      : sb.from('calendars').insert({ ...row, family_id: state.me.family_id });
    if (await run(query, d.id ? 'Calendar saved' : 'Calendar connected')) {
      closeModal();
      refresh('calendars');
    }
  },
  'event-open-google': d => {
    const title = d.title.trim();
    if (!title) return;
    window.open(googleEventUrl({ ...d, title }), '_blank', 'noopener');
    closeModal();
    toast('Finish saving it in Google Calendar.', 'success');
    setTimeout(() => loadEvents(true), 90 * 1000);
  },
};
