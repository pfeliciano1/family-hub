// Find recipes: search a free, open recipe collection (TheMealDB) and save
// one to the family cookbook, with its ingredients sent to the grocery list.
import { sb } from '../supabase.js';
import { state, update } from '../state.js';
import { esc, openModal, closeModal, toast } from '../utils.js';
import { run, refresh } from '../data.js';
import { openGroceryPicker } from './food.js';

const API = 'https://www.themealdb.com/api/json/v1/1/';

// Category → [label, icon]. These are TheMealDB's own category names.
const CATEGORIES = {
  Chicken: ['Chicken', '🍗'], Beef: ['Beef', '🥩'], Pasta: ['Pasta', '🍝'], Seafood: ['Seafood', '🐟'],
  Pork: ['Pork', '🥩'], Vegetarian: ['Vegetarian', '🥗'], Breakfast: ['Breakfast', '🍳'], Dessert: ['Dessert', '🍰'],
  Side: ['Sides', '🥗'], Lamb: ['Lamb', '🥘'], Vegan: ['Vegan', '🥗'], Starter: ['Starters', '🍲'],
  Miscellaneous: ['Other', '🍽️'], Goat: ['Goat', '🥘'],
};
const CHIPS = ['Chicken', 'Beef', 'Pasta', 'Seafood', 'Pork', 'Vegetarian', 'Breakfast', 'Dessert', 'Side'];

const cache = new Map(); // meal id → full meal

async function api(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error(`Recipe search answered ${res.status}`);
  const json = await res.json();
  return json.meals || [];
}

function remember(meals) {
  for (const m of meals) if (m.strInstructions !== undefined) cache.set(m.idMeal, m);
  return meals;
}

async function fullMeal(id) {
  if (cache.has(id)) return cache.get(id);
  const [m] = remember(await api(`lookup.php?i=${encodeURIComponent(id)}`));
  return m || null;
}

// Load results into the page. Only the latest search wins.
let seq = 0;
async function load(kind, value = '') {
  const my = ++seq;
  update({ finder: { kind, value, loading: true, results: state.finder?.kind === kind && state.finder?.value === value ? state.finder.results : [], error: null } });
  let results = [];
  let error = null;
  try {
    if (kind === 'search') results = remember(await api(`search.php?s=${encodeURIComponent(value)}`));
    else if (kind === 'category') results = await api(`filter.php?c=${encodeURIComponent(value)}`);
    else {
      // Ideas: a handful of random recipes (the free service gives one per call)
      const got = await Promise.all(Array.from({ length: 8 }, () => api('random.php').catch(() => null)));
      if (got.every(g => g === null)) throw new Error('Recipe ideas unavailable');
      const seen = new Set();
      results = remember(got.filter(Boolean).flat()).filter(m => !seen.has(m.idMeal) && seen.add(m.idMeal));
    }
  } catch (e) {
    console.error(e);
    error = 'Recipe search isn\'t reachable right now. Check the internet connection and try again.';
  }
  if (my !== seq) return;
  update({ finder: { kind, value, loading: false, results: results.slice(0, 48), error } });
}

// ---------- Turning a TheMealDB recipe into a Family Hub recipe ----------

function ingredientLines(m) {
  const out = [];
  for (let i = 1; i <= 20; i++) {
    const name = (m[`strIngredient${i}`] || '').trim();
    if (!name) continue;
    const measure = (m[`strMeasure${i}`] || '').trim();
    const item = name.toLowerCase();
    // "2 cups rice" reads well; "rice (to taste)" does too, and the grocery list ignores the note
    if (!measure) out.push(item);
    else if (/^[\d½¼¾⅓⅔⅛]/.test(measure)) out.push(`${measure} ${item}`);
    else out.push(`${item} (${measure.toLowerCase()})`);
  }
  return out;
}

function stepLines(m) {
  return (m.strInstructions || '')
    .split(/\r?\n|(?<=\.)\s{2,}/)
    .map(s => s.trim())
    .filter(s => s && !/^(step\s*)?\d+[.:)]?$/i.test(s)); // drop bare "STEP 1" headings
}

export function toRecipe(m) {
  const cat = CATEGORIES[m.strCategory];
  const tags = [cat?.[0], m.strArea && m.strArea !== 'Unknown' ? m.strArea : '',
    ...(m.strTags || '').split(',')].map(t => (t || '').trim().toLowerCase()).filter(Boolean);
  const source = [m.strSource, m.strYoutube].find(u => /^https?:\/\//i.test(u || ''));
  return {
    title: m.strMeal.trim().slice(0, 80),
    icon: cat?.[1] || '🍽️',
    ingredients: ingredientLines(m).join('\n'),
    steps: stepLines(m).join('\n'),
    tags: [...new Set(tags)].slice(0, 12),
    source_url: source || null,
  };
}

function mine(title) {
  const t = title.trim().toLowerCase();
  return state.recipes.find(r => r.title.trim().toLowerCase() === t);
}

// ---------- Views ----------

function resultCard(m) {
  const have = mine(m.strMeal);
  return `<button class="find-card" data-action="find-open" data-id="${esc(m.idMeal)}">
    <img src="${esc(m.strMealThumb)}" alt="" loading="lazy">
    <b>${esc(m.strMeal)}</b>
    ${have ? '<small class="pill">Saved</small>' : m.strCategory ? `<small class="muted">${esc([CATEGORIES[m.strCategory]?.[0] || m.strCategory, m.strArea !== 'Unknown' ? m.strArea : ''].filter(Boolean).join(' • '))}</small>` : ''}
  </button>`;
}

export function finderView() {
  const f = state.finder;
  if (!f) {
    state.finder = { kind: 'ideas', value: '', loading: true, results: [], error: null };
    setTimeout(() => load('ideas'));
    return '<div class="panel"><p class="muted">Finding ideas…</p></div>';
  }
  const heading = f.kind === 'search' ? `Results for "${esc(f.value)}"`
    : f.kind === 'category' ? `${esc(CATEGORIES[f.value]?.[0] || f.value)} recipes` : 'Ideas for you';
  let body;
  if (f.error) body = `<div class="panel empty"><p>${esc(f.error)}</p><button class="btn" data-action="find-ideas">Try again</button></div>`;
  else if (f.loading && !f.results.length) body = '<div class="panel"><p class="muted">Looking…</p></div>';
  else if (!f.results.length) body = `<div class="panel empty"><p>No recipes found. Try one word, like "chicken" or "soup".</p></div>`;
  else body = `<div class="find-grid">${f.results.map(resultCard).join('')}</div>`;
  return `<form class="find-bar" data-form="find-search">
      <input id="find-q" name="q" type="search" placeholder="Search thousands of recipes, e.g. lasagna" value="${esc(f.kind === 'search' ? f.value : '')}" aria-label="Search recipes online" autocomplete="off" maxlength="60">
      <button class="btn primary" type="submit">Search</button>
    </form>
    <div class="fchips find-chips">
      <button class="fchip ${f.kind === 'ideas' ? 'on' : ''}" data-action="find-ideas">🎲 Surprise me</button>
      ${CHIPS.map(c => `<button class="fchip ${f.kind === 'category' && f.value === c ? 'on' : ''}" data-action="find-cat" data-cat="${c}">${CATEGORIES[c][1]} ${CATEGORIES[c][0]}</button>`).join('')}
    </div>
    <h3 class="find-head">${heading}${f.loading && f.results.length ? ' <small class="muted">Updating…</small>' : ''}</h3>
    ${body}
    <p class="muted find-credit">Recipes from <a href="https://www.themealdb.com" target="_blank" rel="noopener noreferrer">TheMealDB</a>, a free, open recipe collection. Amounts are sometimes metric.</p>`;
}

function preview(m) {
  const r = toRecipe(m);
  const have = mine(r.title);
  const ings = r.ingredients.split('\n').filter(Boolean);
  const steps = r.steps.split('\n').filter(Boolean);
  return `<div class="find-preview">
      <img src="${esc(m.strMealThumb)}" alt="">
      <h2>${esc(r.icon)} ${esc(r.title)}</h2>
      ${r.tags.length ? `<p class="tags">${r.tags.map(t => `<i>${esc(t)}</i>`).join('')}</p>` : ''}
    </div>
    <div class="recipe-actions">
      ${have
        ? `<button class="btn primary" data-action="recipe-open" data-id="${esc(have.id)}">Already saved: open it</button>`
        : `<button class="btn primary" data-action="find-save" data-id="${esc(m.idMeal)}" data-grocery="1">🛒 Save + grocery list</button>
           <button class="btn" data-action="find-save" data-id="${esc(m.idMeal)}">Save recipe</button>`}
    </div>
    <div class="recipe-body">
      <section><h3>Ingredients (${ings.length})</h3><ul>${ings.map(i => `<li>${esc(i)}</li>`).join('')}</ul></section>
      <section><h3>Steps</h3><ol>${steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol></section>
    </div>
    <div class="modal-actions"><button class="btn" data-action="close-modal">Close</button></div>`;
}

// ---------- Buttons and forms ----------

export const actions = {
  'recipe-tab': el => {
    update({ recipeTab: el.dataset.tab });
    window.scrollTo(0, 0);
  },
  'find-ideas': () => load('ideas'),
  'find-cat': el => load('category', el.dataset.cat),
  'find-open': async el => {
    openModal('<p class="muted">Opening recipe…</p>');
    try {
      const m = await fullMeal(el.dataset.id);
      if (!m) { closeModal(); toast('That recipe is no longer available.', 'error'); return; }
      openModal(preview(m));
    } catch (e) {
      console.error(e);
      closeModal();
      toast('Recipe search isn\'t reachable right now. Try again in a moment.', 'error');
    }
  },
  'find-save': async el => {
    if (state.foodMissing) { toast('Run the Alpha 0.7 database update first. See the README.', 'error'); return; }
    const m = cache.get(el.dataset.id);
    if (!m) return;
    const r = toRecipe(m);
    if (mine(r.title)) { toast('That recipe is already in your cookbook.'); return; }
    el.disabled = true;
    const { data, error } = await sb.from('recipes').insert({ ...r, family_id: state.me.family_id }).select('id').single();
    if (error) {
      el.disabled = false;
      await run(Promise.resolve({ error })); // shows the friendly message
      return;
    }
    await refresh('recipes');
    toast(`${r.title} saved to your recipes`, 'success');
    if (el.dataset.grocery) openGroceryPicker([data.id], `Add ${r.title} to the grocery list`);
    else closeModal();
  },
};

export const forms = {
  'find-search': d => {
    const q = (d.q || '').trim();
    if (q) load('search', q);
    else load('ideas');
  },
};
