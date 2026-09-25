// Family Hub — starts the app and wires up clicks, forms, and timers.
import { sb, configured } from './supabase.js';
import { state, setRenderer, update } from './state.js';
import { timeNow, closeModal, modalIsOpen, toast, friendlyError } from './utils.js';
import { NAV_IDS } from './nav.js';
import { handleSession } from './session.js';
import { refreshAll } from './data.js';
import * as auth from './modules/auth.js';
import * as shell from './modules/shell.js';
import * as countdowns from './modules/countdowns.js';
import * as tasks from './modules/tasks.js';
import * as grocery from './modules/grocery.js';
import * as settings from './modules/settings.js';
import * as weather from './modules/weather.js';
import * as calendar from './modules/calendar.js';
import * as chores from './modules/chores.js';
import * as rewards from './modules/rewards.js';
import * as routines from './modules/routines.js';
import * as habits from './modules/habits.js';
import * as kidmode from './modules/kidmode.js';

// Each module contributes its own buttons (actions), forms, and checkboxes (toggles).
const modules = [auth, shell, countdowns, tasks, grocery, settings, weather, calendar,
  chores, rewards, routines, habits, kidmode];
const actions = {
  'close-modal': () => closeModal(),
  'close-modal-backdrop': () => closeModal(),
};
const forms = {};
const toggles = {};
for (const m of modules) {
  Object.assign(actions, m.actions || {});
  Object.assign(forms, m.forms || {});
  Object.assign(toggles, m.toggles || {});
}

// ---------- Rendering ----------

function setupNeededView() {
  return `<div class="auth-wrap"><div class="auth-card">
    <div class="auth-logo">🔧</div><h1>Almost there</h1>
    <p>Family Hub isn't connected to your database yet. Open <code>config.js</code>, paste in your Supabase
    Project URL and publishable key, then reload this page.</p></div></div>`;
}

function render() {
  const app = document.getElementById('app');

  // Keep whatever someone is typing when live updates redraw the page
  const active = document.activeElement;
  const keep = active && active.id && app.contains(active) && active.matches('input, textarea')
    ? { id: active.id, value: active.value, start: active.selectionStart, end: active.selectionEnd }
    : null;

  let html;
  if (!configured) html = setupNeededView();
  else if (state.loading) html = '<div class="boot">Loading Family Hub…</div>';
  else if (!state.user) html = auth.authView();
  else if (!state.me || !state.family) html = auth.onboardingView();
  else if (kidmode.active()) html = kidmode.view();
  else html = shell.shellView();
  app.innerHTML = html;

  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) {
      el.value = keep.value;
      el.focus();
      try { el.setSelectionRange(keep.start, keep.end); } catch { /* not a text field */ }
    }
  }
}

// ---------- Events ----------

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const name = el.dataset.action;
  if (name === 'close-modal-backdrop' && e.target !== el) return; // clicks inside the dialog
  const fn = actions[name];
  if (!fn) return;
  Promise.resolve(fn(el, e)).catch(err => { console.error(err); toast(friendlyError(err), 'error'); });
});

document.addEventListener('change', e => {
  const el = e.target.closest('[data-toggle]');
  if (!el) return;
  const fn = toggles[el.dataset.toggle];
  if (fn) Promise.resolve(fn(el)).catch(err => { console.error(err); toast(friendlyError(err), 'error'); });
});

document.addEventListener('submit', async e => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  const fn = forms[f.dataset.form];
  if (!fn) return;
  const data = Object.fromEntries(new FormData(f));
  const button = f.querySelector('[type=submit]');
  if (button) button.disabled = true;
  try {
    await fn(data, f);
  } catch (err) {
    console.error(err);
    toast(friendlyError(err), 'error');
  } finally {
    if (button && button.isConnected) button.disabled = false;
  }
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (modalIsOpen()) closeModal();
  else if (state.tv && !kidmode.active()) actions['tv-toggle']();
});

// ---------- Navigation (#/tasks, #/grocery, …) ----------

function viewFromHash() {
  const v = location.hash.replace(/^#\/?/, '').split(/[?&=]/)[0];
  return NAV_IDS.has(v) ? v : 'home';
}

window.addEventListener('hashchange', () => {
  update({ view: viewFromHash() });
  window.scrollTo(0, 0);
  calendar.loadEvents();
});

// ---------- Timers ----------

let renderedDay = new Date().toDateString();
setInterval(() => {
  const today = new Date().toDateString();
  if (today !== renderedDay) {
    // New day: countdowns, greetings, and tasks all change
    renderedDay = today;
    update();
    weather.loadWeather(true);
    calendar.loadEvents(true);
    return;
  }
  const clock = document.getElementById('clock-time');
  if (clock) clock.textContent = timeNow();
}, 15000);

setInterval(() => weather.loadWeather(), 10 * 60 * 1000);   // weather caches for 30 min
setInterval(() => refreshAll(), 5 * 60 * 1000);              // safety net if live sync drops
setInterval(() => calendar.loadEvents(), 5 * 60 * 1000);     // events cache for 15 min

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !state.me) return;
  // Phones pause pages in the background, so catch up when reopened
  refreshAll();
  weather.loadWeather();
  calendar.loadEvents();
  shell.requestWakeLock();
});

// ---------- Start ----------

async function boot() {
  setRenderer(render);
  state.view = viewFromHash();
  try { state.tv = localStorage.getItem('familyHub.tv') === '1'; } catch { /* private mode */ }
  kidmode.restore();

  if (!configured) {
    update({ loading: false });
    return;
  }

  sb.auth.onAuthStateChange((event, session) => {
    // Supabase recommends not awaiting inside this callback, hence setTimeout
    if (event === 'PASSWORD_RECOVERY') setTimeout(() => auth.openNewPasswordModal(), 0);
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') setTimeout(() => handleSession(session), 0);
  });

  const { data: { session } } = await sb.auth.getSession();
  await handleSession(session);
  shell.requestWakeLock();
}

boot();
