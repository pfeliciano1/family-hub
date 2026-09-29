// Notifications: turn push notifications on or off for this device and
// choose which ones it gets. The notify server function does the sending.
import { sb } from '../supabase.js';
import { state, update } from '../state.js';
import { esc, toast } from '../utils.js';
import { run, refresh } from '../data.js';

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS reports as a Mac
const installed = () => navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;

// What this device can do: 'ok', 'blocked', 'ios-install', or 'unsupported'
function support() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIOS() && !installed() ? 'ios-install' : 'unsupported';
  }
  return window.Notification.permission === 'denied' ? 'blocked' : 'ok';
}

function deviceName() {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  if (/Windows/.test(ua)) return 'Windows computer';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/CrOS/.test(ua)) return 'Chromebook';
  return 'Computer';
}

function unb64u(s) {
  const bin = window.atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

const sameKey = (a, b) => a && b && a.byteLength === b.byteLength && new Uint8Array(a).every((x, i) => x === b[i]);

// ---------- Start-up ----------

let worker = null;

// The service worker shows notifications even when the app is closed.
export async function registerWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    worker = await navigator.serviceWorker.register('sw.js');
    // Tapping a notification while the app is open moves it to the right page
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.go) location.hash = e.data.go;
    });
    await checkDevice();
  } catch (e) {
    console.error('service worker', e);
  }
}

// Which subscription (if any) belongs to this browser
export async function checkDevice() {
  if (!worker || !('PushManager' in window)) return;
  try {
    const sub = await worker.pushManager.getSubscription();
    const endpoint = sub?.endpoint || null;
    if (endpoint !== state.pushEndpoint) update({ pushEndpoint: endpoint });
  } catch (e) {
    console.error(e);
  }
}

async function functionError(err) {
  if (err?.context?.status === 404) return 'The notify server function isn\'t set up yet. See "Setting up notifications" in the README.';
  try {
    const body = await err.context.json();
    if (body?.error) return body.error;
  } catch { /* no details */ }
  return 'Couldn\'t reach the notify server function. Check that it\'s deployed (see the README).';
}

// ---------- Settings panel ----------

function prefRows(s) {
  const box = (col, label, hint) => `<label class="check push-pref">
      <input type="checkbox" data-toggle="push-pref" data-id="${esc(s.id)}" data-col="${col}" ${s[col] ? 'checked' : ''}>
      <span>${label}${hint ? `<small class="muted">${hint}</small>` : ''}</span></label>`;
  return `<div class="push-prefs">
    <div class="push-morning">
      ${box('morning', '☀️ Morning summary', 'Today\'s events, tasks, and dinner')}
      <input type="time" class="push-time" data-toggle="push-time" data-id="${esc(s.id)}" value="${esc(String(s.morning_time || '07:00').slice(0, 5))}" aria-label="Morning summary time" step="300">
    </div>
    ${box('reminders', '🎂 The day before birthdays and countdowns', 'Arrives at the morning time')}
    ${box('lists', '🛒 New grocery and list items', 'Only what someone else added')}
  </div>`;
}

export function settingsPanel() {
  const head = '<h3>🔔 Notifications</h3>';
  if (state.pushMissing) {
    return `<section class="panel">${head}<p class="muted">Run database/setup.sql again in Supabase's SQL Editor to turn on notifications (Alpha 0.9).</p></section>`;
  }
  const mine = state.pushSubs.filter(s => s.member_id === state.me.id);
  const here = mine.find(s => s.endpoint === state.pushEndpoint);
  const others = mine.filter(s => s !== here);
  const can = support();
  let body;
  if (here) {
    body = `<div class="push-status on"><b>✅ On for this ${esc(here.device || 'device')}</b>
        <span><button class="btn sm" data-action="push-test">Send a test</button>
        <button class="btn sm" data-action="push-off">Turn off</button></span></div>
      ${prefRows(here)}`;
  } else if (can === 'ios-install') {
    body = `<p class="muted">On iPhone and iPad, notifications work once Family Hub is on your Home Screen (iOS 16.4 or newer).
      In Safari, tap Share <span aria-hidden="true">(□↑)</span>, then <b>Add to Home Screen</b>. Open Family Hub from the new icon and come back here.</p>`;
  } else if (can === 'unsupported') {
    body = '<p class="muted">This browser can\'t get notifications. Try Chrome, Edge, Firefox, or Safari.</p>';
  } else if (can === 'blocked') {
    body = `<p class="muted">Notifications are blocked for Family Hub in this browser. Allow them in the browser's site settings
      (the icon next to the address, or Settings → Notifications on a phone), then reload.</p>`;
  } else {
    body = `<p class="muted">Get a morning summary, a heads-up the day before birthdays and countdowns, and a note when someone adds to the grocery or a shared list. You choose which ones on each device.</p>
      <button class="btn primary" data-action="push-on">Turn on for this device</button>`;
  }
  const otherRows = others.length ? `<div class="push-others"><small class="muted">Your other devices</small>
    ${others.map(s => `<div class="push-other"><span>📱 ${esc(s.device || 'Device')}</span>
      <button class="link" data-action="push-remove" data-id="${esc(s.id)}">Remove</button></div>`).join('')}</div>` : '';
  return `<section class="panel">${head}${body}${otherRows}</section>`;
}

// ---------- Buttons ----------

export const actions = {
  'push-on': async el => {
    el.disabled = true;
    try {
      // Ask first, straight from the tap (iPhones require that)
      const permission = await window.Notification.requestPermission();
      if (permission !== 'granted') {
        toast(permission === 'denied' ? 'Notifications were blocked. You can allow them in the browser settings.' : 'Notifications weren\'t turned on.', 'error');
        update();
        return;
      }
      const { data, error } = await sb.functions.invoke('notify', { body: { action: 'key' } });
      if (error || !data?.publicKey) { toast(await functionError(error), 'error'); return; }
      const key = unb64u(data.publicKey);
      const reg = worker || await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (sub && !sameKey(sub.options?.applicationServerKey, key)) {
        await sub.unsubscribe(); // made with an older key
        sub = null;
      }
      sub = sub || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const j = sub.toJSON();
      const ok = await run(sb.rpc('save_push_subscription', {
        p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth,
        p_tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '', p_device: deviceName(),
      }), 'Notifications are on for this device');
      if (!ok) return;
      state.pushEndpoint = j.endpoint;
      await refresh('pushSubs');
    } catch (e) {
      console.error(e);
      toast('Couldn\'t turn on notifications on this device. Try again, or try another browser.', 'error');
    } finally {
      if (el.isConnected) el.disabled = false;
    }
  },
  'push-off': async () => {
    const endpoint = state.pushEndpoint;
    try {
      const sub = await worker?.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
    } catch (e) { console.error(e); }
    if (endpoint) await run(sb.rpc('remove_push_subscription', { p_endpoint: endpoint }), 'Notifications are off for this device');
    update({ pushEndpoint: null });
    refresh('pushSubs');
  },
  'push-remove': async el => {
    const s = state.pushSubs.find(x => x.id === el.dataset.id);
    if (!s || !confirm(`Stop notifications on "${s.device || 'that device'}"?`)) return;
    if (await run(sb.from('push_subscriptions').delete().eq('id', s.id), 'Device removed')) refresh('pushSubs');
  },
  'push-test': async el => {
    el.disabled = true;
    const { data, error } = await sb.functions.invoke('notify', { body: { action: 'test', endpoint: state.pushEndpoint } });
    if (el.isConnected) el.disabled = false;
    if (error) { toast(await functionError(error), 'error'); return; }
    if (data?.sent) toast('Test sent. It should pop up in a few seconds.', 'success');
    else {
      toast('The test didn\'t go through. Turn notifications off and on again for this device.', 'error');
      refresh('pushSubs');
    }
  },
};

export const toggles = {
  'push-pref': async el => {
    const ok = await run(sb.from('push_subscriptions').update({ [el.dataset.col]: el.checked, updated_at: new Date().toISOString() }).eq('id', el.dataset.id));
    if (!ok) el.checked = !el.checked;
    refresh('pushSubs');
  },
  'push-time': async el => {
    if (!/^\d{2}:\d{2}$/.test(el.value)) return;
    if (await run(sb.from('push_subscriptions').update({ morning_time: el.value, updated_at: new Date().toISOString() }).eq('id', el.dataset.id), `Morning summary at ${el.value}`)) {
      refresh('pushSubs');
    }
  },
};
