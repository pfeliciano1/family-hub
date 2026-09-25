// Shared grocery list, grouped by store section.
import { sb } from '../supabase.js';
import { state } from '../state.js';
import { esc, openModal, closeModal } from '../utils.js';
import { run, refresh } from '../data.js';

export const SECTIONS = [
  ['Produce', '🥬'], ['Meat & Seafood', '🥩'], ['Dairy & Eggs', '🥛'], ['Bakery', '🍞'],
  ['Pantry', '🥫'], ['Frozen', '🧊'], ['Snacks & Drinks', '🥤'], ['Household', '🧼'],
  ['Pets', '🐶'], ['Other', '🛒'],
];

function sectionOptions(selected) {
  return SECTIONS.map(([name, icon]) =>
    `<option value="${esc(name)}" ${name === selected ? 'selected' : ''}>${icon} ${esc(name)}</option>`).join('');
}

export function groceryRow(g, full = false) {
  return `<div class="grocery ${g.is_checked ? 'done' : ''}">
    <label class="check"><input type="checkbox" data-toggle="grocery-check" data-id="${esc(g.id)}" ${g.is_checked ? 'checked' : ''}>
      <span>${esc(g.name)}${g.quantity ? ` <small class="muted">${esc(g.quantity)}</small>` : ''}</span></label>
    ${full ? `<button class="icon-btn" data-action="grocery-delete" data-id="${esc(g.id)}" title="Remove" aria-label="Remove ${esc(g.name)}">✕</button>` : ''}
  </div>`;
}

export function view() {
  const needed = state.grocery.filter(g => !g.is_checked);
  const inCart = state.grocery.filter(g => g.is_checked);
  const groups = SECTIONS
    .map(([name, icon]) => ({ name, icon, items: needed.filter(g => (g.category || 'Other') === name) }))
    .filter(s => s.items.length);
  // Items with a section name we don't recognize still show up under Other
  const known = new Set(SECTIONS.map(s => s[0]));
  const stray = needed.filter(g => !known.has(g.category || 'Other'));
  if (stray.length) {
    const other = groups.find(s => s.name === 'Other');
    if (other) other.items.push(...stray);
    else groups.push({ name: 'Other', icon: '🛒', items: stray });
  }

  return `<div class="page-title"><h2>🛒 Grocery List</h2>
      ${inCart.length ? `<button class="btn" data-action="grocery-clear">Clear ${inCart.length} checked</button>` : ''}</div>
    <div class="panel">
      <form class="grocery-add" data-form="grocery-add">
        <input id="g-name" name="name" placeholder="Add an item, e.g., Milk" required maxlength="80" autocomplete="off" aria-label="Item">
        <input id="g-qty" name="quantity" placeholder="Qty (optional)" maxlength="30" autocomplete="off" aria-label="Quantity">
        <select name="category" aria-label="Store section">${sectionOptions(state.lastGroceryCat)}</select>
        <button class="btn primary" type="submit">Add</button>
      </form>
      ${groups.length ? groups.map(s => `<div class="g-group">
          <h4>${s.icon} ${esc(s.name)} <span>${s.items.length}</span></h4>
          ${s.items.map(g => groceryRow(g, true)).join('')}</div>`).join('')
        : `<div class="empty"><p>The list is empty. Add what you need and it shows up on every device.</p></div>`}
      ${inCart.length ? `<div class="g-group in-cart"><h4>✔️ In the cart <span>${inCart.length}</span></h4>
          ${inCart.map(g => groceryRow(g, true)).join('')}</div>` : ''}
    </div>`;
}

async function addItem(d, formEl, category) {
  const name = (d.name || '').trim();
  if (!name) return;
  const row = {
    family_id: state.me.family_id,
    name,
    quantity: (d.quantity || '').trim() || null,
    category: category || d.category || 'Other',
  };
  if (d.category) state.lastGroceryCat = d.category;
  if (await run(sb.from('grocery_items').insert(row))) {
    formEl.reset();
    if (formEl.closest('.modal')) closeModal();
    refresh('grocery');
  }
}

export const actions = {
  'grocery-new': () => openModal(`<h2>Add to the grocery list</h2>
    <form data-form="grocery-add">
      <div class="field"><label for="gm-name">Item</label>
        <input id="gm-name" name="name" required maxlength="80" placeholder="e.g., Tortillas" autocomplete="off"></div>
      <div class="field-row">
        <div class="field"><label for="gm-qty">Quantity (optional)</label>
          <input id="gm-qty" name="quantity" maxlength="30" placeholder="e.g., 2 packs"></div>
        <div class="field"><label for="gm-sec">Store section</label>
          <select id="gm-sec" name="category">${sectionOptions(state.lastGroceryCat)}</select></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">Add item</button>
      </div>
    </form>`),
  'grocery-delete': async el => {
    if (await run(sb.from('grocery_items').delete().eq('id', el.dataset.id))) refresh('grocery');
  },
  'grocery-clear': async () => {
    if (!confirm('Remove all checked items from the list?')) return;
    const query = sb.from('grocery_items').delete().eq('family_id', state.me.family_id).eq('is_checked', true);
    if (await run(query, 'Checked items cleared')) refresh('grocery');
  },
};

export const forms = {
  'grocery-add': (d, f) => addItem(d, f),
  'grocery-quick': (d, f) => addItem(d, f, 'Other'),
};

export const toggles = {
  'grocery-check': async el => {
    await run(sb.from('grocery_items').update({ is_checked: el.checked }).eq('id', el.dataset.id));
    refresh('grocery');
  },
};
