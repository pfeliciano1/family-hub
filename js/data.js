// Loading, saving, and live sync with Supabase.
import { sb } from './supabase.js';
import { state, update } from './state.js';
import { toast, friendlyError, toISODate, startOfToday } from './utils.js';
import { loadWeather } from './modules/weather.js';
import { loadEvents } from './modules/calendar.js';

// state key → [table, how to sort]
const SOURCES = {
  members:    ['family_members', q => q.order('sort_order').order('created_at')],
  countdowns: ['countdowns',     q => q.order('event_date')],
  tasks:      ['tasks',          q => q.order('created_at')],
  grocery:    ['grocery_items',  q => q.order('created_at')],
  calendars:  ['calendars',      q => q.order('created_at')],
  // Kids (0.6)
  rewards:     ['rewards',           q => q.order('cost')],
  chores:      ['chores',            q => q.order('created_at')],
  completions: ['chore_completions', q => q.gte('for_date', daysAgo(45)).order('for_date')],
  claims:      ['reward_claims',     q => q.or(`status.eq.pending,created_at.gte.${daysAgo(90)}`).order('created_at', { ascending: false })],
  points:      ['point_entries',     q => q.order('created_at', { ascending: false }).limit(200)],
  routines:    ['routines',          q => q.order('sort_order').order('created_at')],
  steps:       ['routine_steps',     q => q.order('sort_order').order('created_at')],
  checks:      ['routine_checks',    q => q.gte('for_date', daysAgo(7))],
  habits:      ['habits',            q => q.order('created_at')],
  habitLogs:   ['habit_logs',        q => q.gte('for_date', daysAgo(200)).order('for_date', { ascending: false })],
  // Food (0.7)
  recipes:     ['recipes',           q => q.order('title')],
  meals:       ['meal_plan',         q => q.gte('plan_date', daysAgo(180)).order('plan_date')],
  lists:       ['lists',             q => q.order('created_at')],
  listItems:   ['list_items',        q => q.order('sort_order').order('created_at')],
};
const FOOD_KEYS = new Set(['recipes', 'meals', 'lists', 'listItems']);
const KIDS_KEYS = new Set(['rewards', 'chores', 'completions', 'claims', 'points', 'balances',
  'routines', 'steps', 'checks', 'habits', 'habitLogs']);

function daysAgo(n) {
  const d = startOfToday();
  d.setDate(d.getDate() - n);
  return toISODate(d);
}
const TABLE_TO_KEY = {
  families: 'family', family_members: 'members', countdowns: 'countdowns',
  tasks: 'tasks', grocery_items: 'grocery', calendars: 'calendars',
  rewards: 'rewards', chores: 'chores', chore_completions: 'completions', reward_claims: 'claims',
  point_entries: ['points', 'balances'], routines: 'routines', routine_steps: 'steps',
  routine_checks: 'checks', habits: 'habits', habit_logs: 'habitLogs',
  recipes: 'recipes', meal_plan: 'meals', lists: 'lists', list_items: 'listItems',
};
const FOOD_TABLES = new Set(['recipes', 'meal_plan', 'lists', 'list_items']);
const KIDS_TABLES = new Set(['rewards', 'chores', 'chore_completions', 'reward_claims', 'point_entries',
  'routines', 'routine_steps', 'routine_checks', 'habits', 'habit_logs']);

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
  if (key === 'balances') {
    const { data, error } = await sb.rpc('points_balances');
    if (error) return kidsMissing();
    const out = {};
    for (const r of data || []) out[r.member_id] = { balance: Number(r.balance), earned: Number(r.earned) };
    return out;
  }
  const [table, sort] = SOURCES[key];
  const { data, error } = await sort(sb.from(table).select('*').eq('family_id', fid));
  if (error) {
    // Calendars arrived in 0.5. Until the 0.5 database script is run,
    // keep everything else working and let the calendar explain what to do.
    if (key === 'calendars') {
      state.calendarsMissing = true;
      return [];
    }
    if (KIDS_KEYS.has(key)) return kidsMissing(); // same for the 0.6 kids tables
    if (FOOD_KEYS.has(key)) { state.foodMissing = true; return []; } // and the 0.7 food tables
    throw error;
  }
  if (FOOD_KEYS.has(key)) state.foodMissing = false;
  if (key === 'calendars') state.calendarsMissing = false;
  if (KIDS_KEYS.has(key)) state.kidsMissing = false;
  return data;
}

function kidsMissing() {
  state.kidsMissing = true;
  return [];
}

export async function loadAll() {
  const keys = ['family', 'members', 'countdowns', 'tasks', 'grocery', 'calendars',
    ...[...KIDS_KEYS], ...[...FOOD_KEYS]];
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
    if (key === 'calendars') loadEvents(true);
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

function scheduleRefresh(keys) {
  for (const key of [].concat(keys)) {
    clearTimeout(timers[key]);
    timers[key] = setTimeout(() => refresh(key), 250);
  }
}

export function subscribe() {
  unsubscribe();
  channel = sb.channel(`family-hub-${state.me.family_id}`);
  // The database security rules decide which changes this device receives.
  for (const table of Object.keys(TABLE_TO_KEY)) {
    if (table === 'calendars' && state.calendarsMissing) continue; // 0.5 script not run yet
    if (KIDS_TABLES.has(table) && state.kidsMissing) continue;    // 0.6 script not run yet
    if (FOOD_TABLES.has(table) && state.foodMissing) continue;    // 0.7 script not run yet
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
