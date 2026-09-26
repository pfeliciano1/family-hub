// Meals: the weekly meal plan, tonight's dinner, and what to cook next.
import { sb } from '../supabase.js';
import { state, update } from '../state.js';
import { esc, openModal, closeModal, toast, parseDate, startOfToday, toISODate, fmtDate, daysBetween, cardHead } from '../utils.js';
import { run, refresh } from '../data.js';
import { today, recipeById, lastHad, suggestions, foodSetupNotice, openGroceryPicker } from './food.js';

const SLOTS = [['breakfast', '🥣', 'Breakfast'], ['lunch', '🥪', 'Lunch'], ['dinner', '🍽️', 'Dinner']];
const SLOTS_KEY = 'familyHub.mealSlots';

function allSlots() {
  try { return localStorage.getItem(SLOTS_KEY) === 'all'; } catch { return false; }
}

const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function weekStart() {
  if (state.mealWeek) return parseDate(state.mealWeek);
  const t = startOfToday();
  return addDays(t, -t.getDay()); // Sunday
}

export const mealAt = (date, slot) => state.meals.find(m => m.plan_date === date && m.slot === slot);

function mealIcon(m) {
  return recipeById(m.recipe_id)?.icon || SLOTS.find(s => s[0] === m.slot)[1];
}

function cell(date, slot) {
  const m = mealAt(date, slot);
  if (!m) {
    return `<button class="meal-slot empty" data-action="meal-plan" data-date="${date}" data-slot="${slot}" aria-label="Plan ${slot}">＋</button>`;
  }
  return `<button class="meal-slot" data-action="meal-plan" data-date="${date}" data-slot="${slot}">
    <span>${esc(mealIcon(m))}</span><b>${esc(m.title)}</b>${m.note ? `<small>${esc(m.note)}</small>` : ''}</button>`;
}

function weekLabel(start) {
  const end = addDays(start, 6);
  const same = start.getMonth() === end.getMonth();
  return `${fmtDate(start, { month: 'short', day: 'numeric' })} – ${fmtDate(end, same ? { day: 'numeric' } : { month: 'short', day: 'numeric' })}`;
}

function sidePanels() {
  const sug = suggestions(4);
  const t = today();
  const recent = state.meals
    .filter(m => m.plan_date < t && m.plan_date >= toISODate(addDays(startOfToday(), -14)) && m.slot === 'dinner')
    .sort((a, b) => b.plan_date.localeCompare(a.plan_date))
    .slice(0, 7);
  return `<div class="settings-grid">
    <section class="panel"><h3>💡 Ideas for this week</h3>
      ${sug.length ? sug.map(r => {
        const last = lastHad(r.id);
        return `<div class="member-row"><span class="big-ic">${esc(r.icon)}</span>
          <div class="mr-main"><b>${esc(r.title)}</b><small>${last ? `Last had ${daysBetween(parseDate(last), startOfToday())} days ago` : 'Not made in a while'}</small></div>
          <button class="btn sm" data-action="meal-suggest" data-id="${esc(r.id)}">Plan it</button></div>`;
      }).join('') : `<p class="muted">${state.recipes.length ? 'Every recipe is already on this week\'s plan. Nice!' : 'Add a few <a href="#/recipes">recipes</a> and ideas will show up here.'}</p>`}
    </section>
    <section class="panel"><h3>🕘 Recent dinners</h3>
      ${recent.length ? recent.map(m => `<div class="hist"><span class="big-ic">${esc(mealIcon(m))}</span>
          <div class="mr-main">${esc(m.title)}<small>${fmtDate(parseDate(m.plan_date), { weekday: 'short', month: 'short', day: 'numeric' })}</small></div></div>`).join('')
        : '<p class="muted">Past dinners show up here, so it\'s easy to see what you haven\'t had in a while.</p>'}
    </section>
  </div>`;
}

export function view() {
  const title = `<div class="page-title"><h2>🍽️ Meals</h2>
    <button class="btn primary" data-action="meal-new">＋ Plan a meal</button></div>`;
  if (state.foodMissing) return title + foodSetupNotice('meal planning');
  const start = weekStart();
  const t = today();
  const days = [...Array(7)].map((_, i) => addDays(start, i));
  const slots = allSlots() ? SLOTS : SLOTS.filter(s => s[0] === 'dinner');
  return `${title}
    <div class="cal-bar">
      <div class="cal-nav">
        <button class="btn sm" data-action="meal-week" data-step="-1" aria-label="Previous week">‹</button>
        <button class="btn sm" data-action="meal-week" data-step="0">This week</button>
        <button class="btn sm" data-action="meal-week" data-step="1" aria-label="Next week">›</button>
        <b>${weekLabel(start)}</b>
      </div>
      <div class="row-actions">
        <label class="check opt"><input type="checkbox" data-toggle="meal-slots" ${allSlots() ? 'checked' : ''}> <span>Breakfast &amp; lunch</span></label>
        <button class="btn sm" data-action="meal-week-grocery">🛒 Add this week's ingredients</button>
      </div>
    </div>
    <div class="panel planner ${slots.length > 1 ? 'all' : ''}">
      ${days.map(d => {
        const iso = toISODate(d);
        return `<div class="plan-day ${iso === t ? 'today' : ''} ${iso < t ? 'past' : ''}">
          <div class="plan-date"><b>${fmtDate(d, { weekday: 'short' })}</b><small>${fmtDate(d, { month: 'short', day: 'numeric' })}</small></div>
          <div class="plan-slots">${slots.map(([s, , label]) => `<div class="plan-slot">${slots.length > 1 ? `<small>${label}</small>` : ''}${cell(iso, s)}</div>`).join('')}</div>
        </div>`;
      }).join('')}
    </div>
    ${sidePanels()}`;
}

// Home card
export function homeCard() {
  const head = cardHead('🍽️', 'Dinner Tonight', 'meals', 'Meal plan');
  if (state.foodMissing) return `<div class="card">${head}<div class="empty-mini">Run the Alpha 0.7 database update to turn on meal planning. See the README.</div></div>`;
  const t = today();
  const tomorrow = toISODate(addDays(startOfToday(), 1));
  const m = mealAt(t, 'dinner');
  const next = mealAt(tomorrow, 'dinner');
  const r = m && recipeById(m.recipe_id);
  let body;
  if (m) {
    body = `<div class="dinner">
      <span class="dinner-ic">${esc(mealIcon(m))}</span>
      <div><b>${esc(m.title)}</b>${r?.prep_minutes ? `<small>⏱️ ${r.prep_minutes} min</small>` : ''}${m.note ? `<small>${esc(m.note)}</small>` : ''}</div></div>
      ${r ? `<button class="link" data-action="recipe-open" data-id="${esc(r.id)}">View recipe</button>` : ''}`;
  } else {
    const idea = suggestions(1)[0];
    body = `<div class="empty-mini">Nothing planned yet. <button class="link" data-action="meal-new">Plan dinner</button></div>
      ${idea ? `<div class="dinner idea"><span>💡 How about <b>${esc(idea.title)}</b>?</span>
        <button class="btn sm" data-action="meal-tonight" data-id="${esc(idea.id)}">Make it tonight</button></div>` : ''}`;
  }
  return `<div class="card">${head}${body}
    ${next ? `<p class="muted small">Tomorrow: ${esc(mealIcon(next))} ${esc(next.title)}</p>` : ''}</div>`;
}

// ---------- Planning a meal ----------

export function openPlanner({ date = today(), slot = 'dinner', recipeId = '' } = {}) {
  if (state.foodMissing) { toast('Run the Alpha 0.7 database update first. See the README.', 'error'); return; }
  const m = mealAt(date, slot);
  const rid = recipeId || m?.recipe_id || '';
  const custom = m && !m.recipe_id ? m.title : '';
  const sug = suggestions(4);
  openModal(`<h2>${m ? 'Change meal' : 'Plan a meal'}</h2>
    <form data-form="meal-save">
      <input type="hidden" name="id" value="${esc(m?.id || '')}">
      <div class="field-row">
        <div class="field"><label for="mp-date">Day</label>
          <input id="mp-date" type="date" name="plan_date" required value="${esc(date)}"></div>
        <div class="field"><label for="mp-slot">Meal</label>
          <select id="mp-slot" name="slot">${SLOTS.map(([s, i, l]) => `<option value="${s}" ${s === slot ? 'selected' : ''}>${i} ${l}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label for="mp-recipe">Recipe</label>
        <select id="mp-recipe" name="recipe_id" data-toggle="meal-recipe-pick">
          <option value="">${state.recipes.length ? 'Pick a recipe…' : 'No recipes yet'}</option>
          ${state.recipes.map(r => `<option value="${esc(r.id)}" ${r.id === rid ? 'selected' : ''}>${esc(r.icon)} ${esc(r.title)}</option>`).join('')}
        </select></div>
      ${sug.length && !m ? `<div class="fchips idea-chips"><small class="muted">Ideas:</small>
        ${sug.map(r => `<button type="button" class="fchip" data-action="meal-pick" data-id="${esc(r.id)}">${esc(r.icon)} ${esc(r.title)}</button>`).join('')}</div>` : ''}
      <div class="field"><label for="mp-title">…or just type it</label>
        <input id="mp-title" name="title" maxlength="80" value="${esc(custom)}" placeholder="e.g., Leftovers, Pizza night, Eating out" autocomplete="off"></div>
      <div class="field"><label for="mp-note">Note (optional)</label>
        <input id="mp-note" name="note" maxlength="120" value="${esc(m?.note || '')}" placeholder="e.g., Grandma's coming"></div>
      <div class="modal-actions">
        ${m ? `<button type="button" class="btn danger-text" data-action="meal-remove" data-id="${esc(m.id)}">Remove</button>` : ''}
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">Save</button>
      </div>
    </form>`);
}

async function saveMeal({ id, plan_date: date, slot, recipe_id: recipeId, title, note }) {
  const r = recipeId ? recipeById(recipeId) : null;
  const name = (title || '').trim() || r?.title || '';
  if (!name) { toast('Pick a recipe or type what\'s for the meal.', 'error'); return false; }
  const row = { plan_date: date, slot, recipe_id: (title || '').trim() ? null : (r?.id || null), title: name.slice(0, 80), note: (note || '').trim() || null };
  // One meal per day and slot: replace what's there
  const existing = mealAt(date, slot);
  const target = existing?.id || id;
  if (existing && id && existing.id !== id) {
    if (!confirm(`${existing.title} is already planned then. Replace it?`)) return false;
    if (!await run(sb.from('meal_plan').delete().eq('id', id))) return false;
  }
  const query = target
    ? sb.from('meal_plan').update(row).eq('id', target)
    : sb.from('meal_plan').insert({ ...row, family_id: state.me.family_id });
  if (!await run(query, 'Meal planned')) return false;
  refresh('meals');
  return true;
}

export const actions = {
  'meal-new': () => { closeModal(); openPlanner(); },
  'meal-plan': el => openPlanner({ date: el.dataset.date, slot: el.dataset.slot }),
  'meal-suggest': el => {
    // Next open dinner this week (from today), else today
    const t = today();
    const start = weekStart();
    const open = [...Array(7)].map((_, i) => toISODate(addDays(start, i))).find(d => d >= t && !mealAt(d, 'dinner'));
    openPlanner({ date: open || t, recipeId: el.dataset.id });
  },
  'meal-pick': el => {
    const sel = document.getElementById('mp-recipe');
    if (sel) sel.value = el.dataset.id;
    const custom = document.getElementById('mp-title');
    if (custom) custom.value = '';
  },
  'meal-tonight': async el => {
    await saveMeal({ plan_date: today(), slot: 'dinner', recipe_id: el.dataset.id, title: '', note: '' });
  },
  'meal-remove': async el => {
    if (await run(sb.from('meal_plan').delete().eq('id', el.dataset.id), 'Meal removed')) {
      closeModal();
      refresh('meals');
    }
  },
  'meal-week': el => {
    const step = Number(el.dataset.step);
    update({ mealWeek: step ? toISODate(addDays(weekStart(), step * 7)) : null });
  },
  'meal-week-grocery': () => {
    const start = weekStart();
    const from = [today(), toISODate(start)].sort()[1]; // skip days already past
    const to = toISODate(addDays(start, 6));
    const ids = [...new Set(state.meals.filter(m => m.recipe_id && m.plan_date >= from && m.plan_date <= to).map(m => m.recipe_id))];
    openGroceryPicker(ids, 'Groceries for this week\'s meals');
  },
};

export const toggles = {
  'meal-recipe-pick': el => {
    const custom = document.getElementById('mp-title');
    if (custom && el.value) custom.value = '';
  },
  'meal-slots': el => {
    try { localStorage.setItem(SLOTS_KEY, el.checked ? 'all' : 'dinner'); } catch { /* private mode */ }
    update();
  },
};

export const forms = {
  'meal-save': async d => {
    if (await saveMeal(d)) closeModal();
  },
};
