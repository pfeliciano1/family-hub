// Shared pieces for Meals and Recipes: meal history, suggestions, and
// turning recipe ingredients into grocery list items.
import { sb } from '../supabase.js';
import { state } from '../state.js';
import { esc, openModal, closeModal, toast, parseDate, startOfToday, toISODate, daysBetween } from '../utils.js';
import { run, refresh } from '../data.js';

export const today = () => toISODate(startOfToday());

export const recipeById = id => state.recipes.find(r => r.id === id);

export function foodSetupNotice(what) {
  return `<div class="panel empty"><div class="empty-icon">🛠️</div>
    <h3>One database update first</h3>
    <p>Run <code>database/setup.sql</code> again in Supabase's SQL Editor to turn on ${esc(what)}. Your existing data stays put.</p></div>`;
}

export const lines = text => String(text || '').split('\n').map(x => x.trim()).filter(Boolean);

// ---------- Meal history ----------

const mealKey = m => (m.recipe_id ? `r:${m.recipe_id}` : `t:${m.title.trim().toLowerCase()}`);

// The last date (up to today) a recipe or named meal was on the plan.
export function lastHad(recipeIdOrTitle) {
  const t = today();
  const key = recipeById(recipeIdOrTitle) ? `r:${recipeIdOrTitle}` : `t:${String(recipeIdOrTitle).trim().toLowerCase()}`;
  let last = null;
  for (const m of state.meals) {
    if (m.plan_date <= t && mealKey(m) === key && (!last || m.plan_date > last)) last = m.plan_date;
  }
  return last;
}

export function lastHadLabel(recipeId) {
  const d = lastHad(recipeId);
  if (!d) return 'Not on the plan yet';
  const n = daysBetween(parseDate(d), startOfToday());
  return n === 0 ? 'Had it today' : n === 1 ? 'Had it yesterday' : `Last had ${n} days ago`;
}

// Recipes to suggest: never had first, then the longest since last time.
// Skips anything already planned in the coming week.
export function suggestions(n = 3) {
  const t = today();
  const soon = toISODate(new Date(startOfToday().getTime() + 7 * 86400e3));
  const planned = new Set(state.meals.filter(m => m.plan_date >= t && m.plan_date <= soon && m.recipe_id).map(m => m.recipe_id));
  return state.recipes
    .filter(r => !planned.has(r.id))
    .map(r => ({ r, last: lastHad(r.id) || '0000' }))
    .sort((a, b) => a.last.localeCompare(b.last) || a.r.title.localeCompare(b.r.title))
    .slice(0, n)
    .map(x => x.r);
}

// ---------- Ingredients → grocery list ----------

const UNITS = 'cups?|c\\.|tbsps?|tablespoons?|tsps?|teaspoons?|lbs?|pounds?|oz|ounces?|g|grams?|kg|ml|l|liters?|litres?|' +
  'cans?|packages?|pkgs?|packets?|cloves?|bunch(?:es)?|heads?|slices?|pieces?|pinch(?:es)?|dash(?:es)?|sticks?|' +
  'jars?|bags?|boxes?|bottles?|containers?|dozen|quarts?|pints?|gallons?|sprigs?|stalks?';
const QTY = '(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?(?:\\s*-\\s*\\d+(?:\\.\\d+)?)?|[½¼¾⅓⅔⅛]|\\d+\\s*[½¼¾⅓⅔⅛]|a|an|one|two|three|four)';
const LINE = new RegExp(`^(${QTY})?\\s*(?:(${UNITS})\\.?\\s+)?(?:of\\s+)?(.+)$`, 'i');

// "2 lbs ground beef, browned" → { quantity: "2 lbs", name: "ground beef" }
export function parseIngredient(line) {
  const text = line.replace(/^[-•*\s]+/, '').trim();
  const m = text.match(LINE);
  let qty = '';
  let name = text;
  if (m) {
    const [, num, unit, rest] = m;
    const wordNum = num && /^(a|an|one|two|three|four)$/i.test(num);
    if (num && (!wordNum || unit)) {
      qty = [num, unit].filter(Boolean).join(' ');
      name = rest;
    } else if (!num && unit && /^(pinch|dash)/i.test(unit)) {
      qty = unit;
      name = rest;
    }
  }
  name = name.replace(/\([^)]*\)/g, '').split(',')[0].trim();
  return { quantity: qty.trim(), name: name || text };
}

const STAPLES = /^(salt|pepper|black pepper|salt and pepper|water|ice|olive oil|vegetable oil|oil|cooking spray|sugar|flour|all-purpose flour|baking soda|baking powder)$/i;

const SECTION_WORDS = [
  ['Produce', /lettuce|tomato|onion|garlic|pepper|potato|carrot|celery|apple|banana|lemon|lime|orange|berr|avocado|cilantro|parsley|basil|herb|spinach|kale|broccoli|cucumber|zucchini|squash|mushroom|corn|ginger|scallion|green onion|cabbage|fruit|grape|mango|pineapple|peach|pear|salad|jalape/i],
  ['Meat & Seafood', /beef|chicken|pork|turkey|sausage|bacon|ham|steak|fish|salmon|shrimp|tuna|meat|lamb|chorizo/i],
  ['Dairy & Eggs', /milk|cheese|butter|yogurt|cream|egg|sour cream|cheddar|mozzarella|parmesan/i],
  ['Bakery', /bread|bun|roll|tortilla|bagel|pita|croissant|naan/i],
  ['Frozen', /frozen|ice cream/i],
  ['Snacks & Drinks', /chip|cracker|juice|soda|coffee|tea|cookie|snack|popcorn/i],
  ['Pantry', /rice|pasta|noodle|spaghetti|penne|macaroni|lasagna|linguine|fettuccine|quinoa|lentil|bean|sauce|broth|stock|flour|sugar|oil|vinegar|spice|salt|pepper|cumin|paprika|oregano|cinnamon|can|soup|salsa|ketchup|mustard|mayo|honey|syrup|oat|cereal|peanut|nut|seasoning|vanilla|baking/i],
];

export function guessSection(name) {
  // Some words ("pepper", "cream") exist in two sections; the first match wins,
  // with a couple of common exceptions handled first.
  if (/black pepper|pepper flakes|cayenne/i.test(name)) return 'Pantry';
  if (/ice cream/i.test(name)) return 'Frozen';
  if (/cream of|peanut butter|coconut milk|evaporated milk|condensed milk/i.test(name)) return 'Pantry';
  const hit = SECTION_WORDS.find(([, re]) => re.test(name));
  return hit ? hit[0] : 'Other';
}

function onList(name) {
  const n = name.toLowerCase();
  return state.grocery.some(g => !g.is_checked && (g.name.toLowerCase() === n || g.name.toLowerCase().includes(n) || n.includes(g.name.toLowerCase())));
}

// Shows the ingredients of one or more recipes with checkboxes, then adds
// the checked ones to the grocery list.
export function openGroceryPicker(recipeIds, title = 'Add to the grocery list') {
  const items = [];
  const seen = new Set();
  for (const id of recipeIds) {
    const r = recipeById(id);
    if (!r) continue;
    for (const line of lines(r.ingredients)) {
      const p = parseIngredient(line);
      const key = p.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ ...p, from: r.title, have: onList(p.name), staple: STAPLES.test(p.name) });
    }
  }
  if (!items.length) {
    toast(recipeIds.length ? 'No ingredients listed yet. Edit the recipe to add them.' : 'No recipes planned for these days.', 'error');
    return;
  }
  const many = new Set(items.map(i => i.from)).size > 1;
  openModal(`<h2>${esc(title)}</h2>
    <p class="muted">Uncheck anything you already have. Items already on the list and pantry basics start unchecked.</p>
    <form data-form="ingredients-add">
      <div class="ing-list">${items.map((it, i) => `<label class="check ing">
        <input type="checkbox" name="i${i}" value="1" ${it.have || it.staple ? '' : 'checked'}>
        <span>${esc(it.name)}${it.quantity ? ` <small class="muted">${esc(it.quantity)}</small>` : ''}
          ${it.have ? '<small class="pill muted-pill">on the list</small>' : ''}${many ? ` <small class="muted">• ${esc(it.from)}</small>` : ''}</span>
        <input type="hidden" name="n${i}" value="${esc(it.name)}"><input type="hidden" name="q${i}" value="${esc(it.quantity)}">
      </label>`).join('')}</div>
      <input type="hidden" name="count" value="${items.length}">
      <div class="modal-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">Add to grocery list</button>
      </div>
    </form>`);
}

export const forms = {
  'ingredients-add': async d => {
    const rows = [];
    for (let i = 0; i < Number(d.count); i++) {
      if (!d[`i${i}`]) continue;
      const name = (d[`n${i}`] || '').trim();
      if (!name) continue;
      rows.push({ family_id: state.me.family_id, name: name.slice(0, 80), quantity: (d[`q${i}`] || '').slice(0, 30) || null, category: guessSection(name) });
    }
    if (!rows.length) { closeModal(); return; }
    if (await run(sb.from('grocery_items').insert(rows), `${rows.length} item${rows.length === 1 ? '' : 's'} added to the grocery list`)) {
      closeModal();
      refresh('grocery');
    }
  },
};
