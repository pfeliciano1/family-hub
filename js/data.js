// Loading, saving, and live sync with Supabase.
import { sb } from './supabase.js';
import { state, update } from './state.js';
import { toast, friendlyError } from './utils.js';
import { loadWeather } from './modules/weather.js';

// state key → [table, how to sort]
const SOURCES = {
  members:    ['family_members', q => q.order('sort_order').order('created_at')],
  countdowns: ['countdowns',     q => q.order('event_date')],
  tasks:      ['tasks',          q => q.order('created_at')],
  grocery:    ['grocery_items',  q => q.order('created_at')],
};
const TABLE_TO_KEY = {
  families: 'family', family_members: 'members', countdowns: 'countdowns',
  tasks: 'tasks', grocery_items: 'grocery',
};

export async function loadMembership(userId) {
  const { data, error } = await sb.from('family_members').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchKey(key) {
  const fid = state.me.family_id;
  if (key === 'family') {
    const { data, error } = await sb.from('families').select('*').eq('id', fid).single();
    if (error) throw error;
    return data;
  }
  const [table, sort] = SOURCES[key];
  const { data, error } = await sort(sb.from(table).select('*').eq('family_id', fid));
  if (error) throw error;
  return data;
}

export async function loadAll() {
  const keys = ['family', 'members', 'countdowns', 'tasks', 'grocery'];
  const results = await Promise.all(keys.map(fetchKey));
  const patch = {};
  keys.forEach((k, i) => { patch[k] = results[i]; });
  const me = patch.members.find(m => m.user_id === state.user.id);
  if (me) patch.me = me;
  update(patch);
}

export async function refresh(key) {
  if (!state.me) return;
  try {
    const data = await fetchKey(key);
    if (key === 'members') {
      const me = data.find(m => m.user_id === state.user.id);
      if (!me) { location.reload(); return; } // removed from the family
      update({ members: data, me });
      return;
    }
    update({ [key]: data });
    if (key === 'family') loadWeather();
  } catch (e) {
    console.error(e);
  }
}

export async function refreshAll() {
  if (!state.me) return;
  try { await loadAll(); } catch (e) { console.error(e); }
}

// Run a save/delete. Shows the error if it fails. Returns true on success.
export async function run(query, successMessage) {
  const { error } = await query;
  if (error) {
    console.error(error);
    toast(friendlyError(error), 'error');
    return false;
  }
  if (successMessage) toast(successMessage, 'success');
  return true;
}

// ---------- Live sync ----------

let channel = null;
const timers = {};

function scheduleRefresh(key) {
  clearTimeout(timers[key]);
  timers[key] = setTimeout(() => refresh(key), 250);
}

export function subscribe() {
  unsubscribe();
  channel = sb.channel(`family-hub-${state.me.family_id}`);
  // The database security rules decide which changes this device receives.
  for (const table of Object.keys(TABLE_TO_KEY)) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table },
      () => scheduleRefresh(TABLE_TO_KEY[table]));
  }
  channel.subscribe(status => {
    const live = status === 'SUBSCRIBED';
    if (live !== state.live) update({ live });
  });
}

export function unsubscribe() {
  if (channel) {
    sb.removeChannel(channel);
    channel = null;
  }
}
