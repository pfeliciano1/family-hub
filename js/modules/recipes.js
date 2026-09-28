// Recipes: the family cookbook. Each recipe can go on the meal plan or
// send its ingredients to the grocery list.
import { sb } from '../supabase.js';
import { state, update } from '../state.js';
import { esc, openModal, closeModal, toast, cardHead } from '../utils.js';
import { run, refresh } from '../data.js';
import { recipeById, lines, lastHadLabel, foodSetupNotice, openGroceryPicker, suggestions } from './food.js';
import { iconPicker } from './kids.js';
import { openPlanner } from './meals.js';

export const RECIPE_ICONS = ['🍽️', '🌮', '🍝', '🍕', '🍔', '🍗', '🥩', '🐟', '🍲', '🥗', '🍛', '🍜', '🥞', '🍳', '🥪', '🌯', '🍚', '🥘', '🍰', '🍪'];

export function allTags() {
  const set = new Set();
  for (const r of state.recipes) for (const t of r.tags || []) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}

function matches(r) {
  if (state.recipeTag && !(r.tags || []).includes(state.recipeTag)) return false;
  const q = state.recipeQuery.trim().toLowerCase();
  if (!q) return true;
  return r.title.toLowerCase().includes(q) || (r.ingredients || '').toLowerCase().includes(q) ||
    (r.tags || []).some(t => t.toLowerCase().includes(q));
}

function recipeCard(r) {
  const meta = [r.prep_minutes ? `⏱️ ${r.prep_minutes} min` : '', r.servings ? `🍽️ ${r.servings}` : ''].filter(Boolean).join(' • ');
  return `<button class="recipe-card" data-action="recipe-open" data-id="${esc(r.id)}">
    <span class="recipe-ic">${esc(r.icon)}</span>
    <b>${esc(r.title)}</b>
    ${meta ? `<small>${meta}</small>` : ''}
    <small class="muted">${esc(lastHadLabel(r.id))}</small>
    ${(r.tags || []).length ? `<span class="tags">${r.tags.slice(0, 3).map(t => `<i>${esc(t)}</i>`).join('')}</span>` : ''}
  </button>`;
}

export function view() {
  const title = `<div class="page-title"><h2>📖 Recipes</h2>
    <button class="btn primary" data-action="recipe-new">＋ New recipe</button></div>`;
  if (state.foodMissing) return title + foodSetupNotice('recipes');
  if (!state.recipes.length) {
    return `${title}<div class="panel empty"><div class="empty-icon">📖</div>
      <h3>Start your family cookbook</h3>
      <p>Save the meals you make again and again. Add them to the weekly plan with one tap, and send the ingredients straight to the grocery list.</p>
      <button class="btn primary" data-action="recipe-new">Add a recipe</button></div>`;
  }
  const tags = allTags();
  const shown = state.recipes.filter(matches);
  return `${title}
    <div class="recipe-bar">
      <input id="recipe-search" type="search" placeholder="Search recipes or ingredients…" value="${esc(state.recipeQuery)}" aria-label="Search recipes" autocomplete="off">
      ${tags.length ? `<div class="fchips">
        <button class="fchip ${state.recipeTag ? '' : 'on'}" data-action="recipe-tag" data-tag="">All</button>
        ${tags.map(t => `<button class="fchip ${state.recipeTag === t ? 'on' : ''}" data-action="recipe-tag" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}
      </div>` : ''}
    </div>
    ${shown.length ? `<div class="recipe-grid">${shown.map(recipeCard).join('')}</div>`
      : '<div class="panel empty"><p>No recipes match. <button class="link" data-action="recipe-tag" data-tag="" data-clear="1">Show all</button></p></div>'}`;
}

function detail(r) {
  const ings = lines(r.ingredients);
  const steps = lines(r.steps);
  const meta = [r.prep_minutes ? `⏱️ ${r.prep_minutes} minutes` : '', r.servings ? `🍽️ Serves ${r.servings}` : '', lastHadLabel(r.id)].filter(Boolean);
  let link = '';
  if (r.source_url) {
    try { link = `<a href="${esc(r.source_url)}" target="_blank" rel="noopener noreferrer">🔗 Original recipe (${esc(new URL(r.source_url).hostname)})</a>`; } catch { /* bad URL */ }
  }
  return `<h2>${esc(r.icon)} ${esc(r.title)}</h2>
    <p class="muted">${meta.map(esc).join(' • ')}</p>
    ${(r.tags || []).length ? `<p class="tags">${r.tags.map(t => `<i>${esc(t)}</i>`).join('')}</p>` : ''}
    <div class="recipe-actions">
      <button class="btn primary" data-action="recipe-plan" data-id="${esc(r.id)}">📅 Plan it</button>
      <button class="btn" data-action="recipe-grocery" data-id="${esc(r.id)}">🛒 Add to grocery</button>
    </div>
    <div class="recipe-body">
      <section><h3>Ingredients</h3>${ings.length ? `<ul>${ings.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p class="muted">None listed yet.</p>'}</section>
      <section><h3>Steps</h3>${steps.length ? `<ol>${steps.map(s => `<li>${esc(s.replace(/^\d+[.)]\s*/, ''))}</li>`).join('')}</ol>` : '<p class="muted">None listed yet.</p>'}</section>
    </div>
    ${link ? `<p>${link}</p>` : ''}
    <div class="modal-actions">
      <button class="btn danger-text" data-action="recipe-delete" data-id="${esc(r.id)}">Delete</button>
      <button class="btn" data-action="recipe-edit" data-id="${esc(r.id)}">✏️ Edit</button>
      <button class="btn" data-action="close-modal">Close</button>
    </div>`;
}

function form(r = {}) {
  const isNew = !r.id;
  return `<h2>${isNew ? 'New recipe' : 'Edit recipe'}</h2>
    <form data-form="recipe-save">
      <input type="hidden" name="id" value="${esc(r.id || '')}">
      <div class="field"><label for="rc-title">Name</label>
        <input id="rc-title" name="title" required maxlength="80" value="${esc(r.title || '')}" placeholder="e.g., Taco Tuesday tacos"></div>
      <div class="field"><label>Icon</label>${iconPicker('icon', RECIPE_ICONS, r.icon)}</div>
      <div class="field-row">
        <div class="field"><label for="rc-prep">Minutes to make</label>
          <input id="rc-prep" name="prep_minutes" type="number" min="0" max="1440" value="${esc(r.prep_minutes ?? '')}" placeholder="30"></div>
        <div class="field"><label for="rc-serv">Serves</label>
          <input id="rc-serv" name="servings" type="number" min="1" max="100" value="${esc(r.servings ?? '')}" placeholder="4"></div>
      </div>
      <div class="field"><label for="rc-tags">Tags (comma separated)</label>
        <input id="rc-tags" name="tags" maxlength="200" value="${esc((r.tags || []).join(', '))}" placeholder="e.g., quick, kid favorite, vegetarian"
          list="rc-tag-list" autocomplete="off">
        <datalist id="rc-tag-list">${allTags().map(t => `<option value="${esc(t)}">`).join('')}</datalist></div>
      <div class="field"><label for="rc-ing">Ingredients (one per line)</label>
        <textarea id="rc-ing" name="ingredients" rows="7" maxlength="5000" placeholder="1 lb ground beef&#10;8 taco shells&#10;1 cup shredded cheese&#10;1 tomato">${esc(r.ingredients || '')}</textarea></div>
      <div class="field"><label for="rc-steps">Steps (one per line)</label>
        <textarea id="rc-steps" name="steps" rows="6" maxlength="10000" placeholder="Brown the beef with the seasoning.&#10;Warm the shells.&#10;Fill and top.">${esc(r.steps || '')}</textarea></div>
      <div class="field"><label for="rc-url">Link to the original (optional)</label>
        <input id="rc-url" name="source_url" type="url" maxlength="500" value="${esc(r.source_url || '')}" placeholder="https://…"></div>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">${isNew ? 'Add recipe' : 'Save changes'}</button>
      </div>
    </form>`;
}

const intOrNull = (v, lo, hi) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : null;
};

export const actions = {
  'recipe-new': () => {
    if (state.foodMissing) { toast('Run the Alpha 0.7 database update first. See the README.', 'error'); return; }
    openModal(form());
  },
  'recipe-open': el => {
    const r = recipeById(el.dataset.id);
    if (r) openModal(detail(r));
  },
  'recipe-edit': el => openModal(form(recipeById(el.dataset.id))),
  'recipe-delete': async el => {
    const r = recipeById(el.dataset.id);
    if (!r || !confirm(`Delete "${r.title}"? Meals already planned keep their name.`)) return;
    if (await run(sb.from('recipes').delete().eq('id', r.id), 'Recipe deleted')) {
      closeModal();
      refresh('recipes');
      refresh('meals');
    }
  },
  'recipe-tag': el => update({ recipeTag: el.dataset.tag || '', ...(el.dataset.clear ? { recipeQuery: '' } : {}) }),
  'recipe-plan': el => openPlanner({ recipeId: el.dataset.id }),
  'recipe-grocery': el => openGroceryPicker([el.dataset.id], `Add ${recipeById(el.dataset.id)?.title || 'ingredients'} to the grocery list`),
};

// Search as you type, without a database round trip
let searchTimer = null;
export function bindSearch() {
  document.addEventListener('input', e => {
    if (e.target.id !== 'recipe-search') return;
    clearTimeout(searchTimer);
    const value = e.target.value;
    searchTimer = setTimeout(() => update({ recipeQuery: value }), 200);
  });
}

export const forms = {
  'recipe-save': async d => {
    const title = d.title.trim();
    if (!title) return;
    const url = (d.source_url || '').trim();
    const row = {
      title,
      icon: d.icon || RECIPE_ICONS[0],
      prep_minutes: intOrNull(d.prep_minutes, 0, 1440),
      servings: intOrNull(d.servings, 1, 100),
      tags: [...new Set((d.tags || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean))].slice(0, 12),
      ingredients: (d.ingredients || '').trim(),
      steps: (d.steps || '').trim(),
      source_url: /^https?:\/\//i.test(url) ? url : null,
    };
    const query = d.id
      ? sb.from('recipes').update(row).eq('id', d.id)
      : sb.from('recipes').insert({ ...row, family_id: state.me.family_id });
    if (await run(query, d.id ? 'Recipe saved' : 'Recipe added')) {
      closeModal();
      refresh('recipes');
    }
  },
};

// Home card: recipes you haven't made in a while
export function homeCard() {
  const head = cardHead('📖', 'Recipes', 'recipes');
  if (state.foodMissing) return `<div class="card">${head}<div class="empty-mini">Run the Alpha 0.7 database update to turn on recipes.</div></div>`;
  if (!state.recipes.length) {
    return `<div class="card">${head}<div class="empty-mini">Save the family favorites. <button class="link" data-action="recipe-new">Add a recipe</button></div></div>`;
  }
  const ideas = suggestions(3);
  return `<div class="card">${head}
    <p class="muted">${ideas.length ? 'Haven\'t had these in a while:' : 'Every recipe is on this week\'s plan. 🎉'}</p>
    ${ideas.map(r => `<div class="home-recipe">
      <button class="link" data-action="recipe-open" data-id="${esc(r.id)}">${esc(r.icon)} ${esc(r.title)}</button>
      <small class="muted">${esc(lastHadLabel(r.id))}</small>
      <button class="btn sm" data-action="recipe-plan" data-id="${esc(r.id)}">Plan it</button></div>`).join('')}
    <small class="muted">${state.recipes.length} recipe${state.recipes.length === 1 ? '' : 's'} in the cookbook</small></div>`;
}
