// Shared pieces for the kids features: points, chores due today, PINs.
import { sb } from '../supabase.js';
import { state } from '../state.js';
import { esc, parseDate, startOfToday, toISODate, safeColor } from '../utils.js';
import { run } from '../data.js';

export const today = () => toISODate(startOfToday());

export const children = () => state.members.filter(m => m.role === 'child');

// People who can have chores, routines, and habits: kids first, then parents.
export const everyone = () => [...children(), ...state.members.filter(m => m.role !== 'child')];

export const memberById = id => state.members.find(m => m.id === id);

export const balanceOf = id => state.balances?.[id]?.balance || 0;

// Points already promised to reward requests that haven't been decided.
export function pendingSpend(id) {
  return state.claims.filter(c => c.member_id === id && c.status === 'pending').reduce((a, c) => a + c.cost, 0);
}

export const newId = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  }));

// Adds points once. The ref_key makes a repeat (or two parents approving
// at the same moment) harmless.
export async function awardPoints(memberId, amount, reason, kind, refKey = null) {
  if (!amount) return true;
  const { error } = await sb.from('point_entries').insert({
    family_id: state.me.family_id, member_id: memberId, amount, reason, kind, ref_key: refKey,
  });
  if (error && error.code !== '23505') { // 23505 = already recorded
    return run(Promise.resolve({ error }));
  }
  return true;
}

export async function removePoints(refKey) {
  return run(sb.from('point_entries').delete().eq('ref_key', refKey));
}

export function starLine(n) {
  return `<span class="stars">⭐ ${Number(n).toLocaleString()}</span>`;
}

export function progressBar(value, max, color) {
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
  return `<div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"
    style="--c:${safeColor(color)}"><span style="width:${pct}%"></span></div>`;
}

export function goalOf(member) {
  return state.rewards.find(r => r.id === member.goal_reward_id && r.is_active) || null;
}

export function kidsSetupNotice(what = 'this section') {
  return `<div class="panel empty"><div class="empty-icon">🛠️</div>
    <h3>One database update first</h3>
    <p>Run <code>database/setup.sql</code> again in Supabase's SQL Editor to turn on ${esc(what)}. Your existing data stays put.</p></div>`;
}

// ---------- Chores ----------

export function isDue(chore, dateStr) {
  if (!chore.is_active) return false;
  if (chore.created_at && dateStr < chore.created_at.slice(0, 10) && chore.frequency !== 'once') return false;
  if (chore.frequency === 'daily') return true;
  if (chore.frequency === 'weekly') return (chore.days || []).includes(parseDate(dateStr).getDay());
  return chore.due_date === dateStr;
}

export function completionFor(chore, dateStr) {
  return state.completions.find(c => c.chore_id === chore.id && c.member_id === chore.assigned_to && c.for_date === dateStr);
}

export function choresDue(memberId, dateStr = today()) {
  return state.chores.filter(c => c.assigned_to === memberId && isDue(c, dateStr));
}

// Chores still worth showing today: due today, plus one-time chores that
// were missed and never done.
export function choresForToday(memberId) {
  const t = today();
  const due = choresDue(memberId, t);
  const overdueOnce = state.chores.filter(c => c.assigned_to === memberId && c.is_active &&
    c.frequency === 'once' && c.due_date && c.due_date < t &&
    !state.completions.some(x => x.chore_id === c.id && x.status !== 'rejected'));
  return [...overdueOnce, ...due];
}

export function choreDate(chore) {
  const t = today();
  return chore.frequency === 'once' && chore.due_date && chore.due_date < t ? chore.due_date : t;
}

// ---------- Routines & habits ----------

export function stepsOf(routineId) {
  return state.steps.filter(s => s.routine_id === routineId);
}

export function routineProgress(routine, dateStr = today()) {
  const steps = stepsOf(routine.id);
  const done = steps.filter(s => state.checks.some(c => c.step_id === s.id && c.for_date === dateStr)).length;
  return { done, total: steps.length };
}

export function habitDone(habitId, dateStr) {
  return state.habitLogs.some(l => l.habit_id === habitId && l.for_date === dateStr);
}

// Days in a row, counting today if done, otherwise ending yesterday.
export function streak(habitId) {
  const days = new Set(state.habitLogs.filter(l => l.habit_id === habitId).map(l => l.for_date));
  const d = startOfToday();
  if (!days.has(toISODate(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(toISODate(d))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

// ---------- PINs ----------

export async function pinHash(scope, pin) {
  const bytes = new TextEncoder().encode(`family-hub:${scope}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export const validPin = pin => /^\d{4}$/.test(pin || '');

export const ICONS = {
  chore: ['🧹', '🛏️', '🍽️', '🧺', '🗑️', '🐶', '🐱', '🪴', '📚', '🧸', '🚿', '🦷', '🎒', '🧼', '🚗', '🍂'],
  reward: ['🎁', '🍦', '🎮', '📱', '🎬', '🍕', '🧸', '🛝', '🎨', '📖', '🌙', '💵', '🎟️', '🍩', '⚽', '🎧'],
  routine: ['☀️', '🌙', '🎒', '🛁', '🍽️', '🏫', '🧘', '🦷'],
  habit: ['❤️', '📚', '💧', '🏃', '🥦', '🎹', '🧘', '😴', '🦷', '✍️', '🚶', '🍎'],
};

export function iconPicker(name, list, chosen) {
  const pick = chosen && list.includes(chosen) ? chosen : list[0];
  return `<div class="icon-pick">${list.map(i => `<label><input type="radio" name="${name}" value="${i}" ${i === pick ? 'checked' : ''}><span>${i}</span></label>`).join('')}</div>`;
}

export function memberOptions(list, selected, allowEmpty = null) {
  return `${allowEmpty ? `<option value="">${esc(allowEmpty)}</option>` : ''}${list.map(m =>
    `<option value="${esc(m.id)}" ${m.id === selected ? 'selected' : ''}>${esc(m.display_name)}</option>`).join('')}`;
}
