// Lists: any shared checklist the family needs (packing, ideas, school supplies).
import { sb } from '../supabase.js';
import { state } from '../state.js';
import { esc, openModal, closeModal, toast } from '../utils.js';
import { run, refresh } from '../data.js';
import { foodSetupNotice } from './food.js';
import { iconPicker } from './kids.js';

const LIST_ICONS = ['📝', '🧳', '🎒', '💡', '🎄', '🏕️', '🏖️', '🎉', '📚', '🎬', '🏠', '🛍️'];

export const TEMPLATES = {
  blank: { name: '', icon: '📝', label: 'Blank list', items: [] },
  packing: {
    name: 'Packing list', icon: '🧳', label: 'Trip packing',
    items: ['Clothes for each day', 'Pajamas', 'Underwear & socks', 'Toothbrushes & toothpaste', 'Shampoo & soap',
      'Medicines', 'Phone chargers', 'Swimsuits', 'Jackets', 'Snacks for the drive', 'Books & toys for the kids', 'Sunscreen'],
  },
  school: {
    name: 'School supplies', icon: '🎒', label: 'School supplies',
    items: ['Backpack', 'Pencils', 'Erasers', 'Crayons or markers', 'Glue sticks', 'Scissors', 'Notebooks', 'Folders',
      'Ruler', 'Lunch box', 'Water bottle', 'Tissues'],
  },
  ideas: { name: 'Ideas', icon: '💡', label: 'Ideas (dates, outings, movies)', items: [] },
};

const itemsOf = listId => state.listItems.filter(i => i.list_id === listId);

function listPanel(l) {
  const items = itemsOf(l.id);
  const open = items.filter(i => !i.is_checked);
  const done = items.filter(i => i.is_checked);
  const row = i => `<div class="grocery ${i.is_checked ? 'done' : ''}">
    <label class="check"><input type="checkbox" data-toggle="list-item-check" data-id="${esc(i.id)}" ${i.is_checked ? 'checked' : ''}>
      <span>${esc(i.text)}</span></label>
    <button class="icon-btn" data-action="list-item-delete" data-id="${esc(i.id)}" title="Remove" aria-label="Remove ${esc(i.text)}">✕</button></div>`;
  return `<section class="panel list-panel">
    <h3><span>${esc(l.icon)} ${esc(l.name)} <small class="muted">${done.length}/${items.length}</small></span>
      <span class="row-actions">
        <button class="icon-btn" data-action="list-edit" data-id="${esc(l.id)}" title="Rename" aria-label="Rename ${esc(l.name)}">✏️</button>
        <button class="icon-btn" data-action="list-delete" data-id="${esc(l.id)}" title="Delete" aria-label="Delete ${esc(l.name)}">🗑️</button>
      </span></h3>
    ${open.map(row).join('')}
    ${done.length ? `<div class="g-group in-cart">${done.map(row).join('')}</div>` : ''}
    ${items.length ? '' : '<p class="muted">Nothing on this list yet.</p>'}
    <form class="inline-add" data-form="list-item-add">
      <input type="hidden" name="list_id" value="${esc(l.id)}">
      <input id="li-${esc(l.id)}" name="text" placeholder="Add an item…" maxlength="120" autocomplete="off" required aria-label="Add to ${esc(l.name)}">
      <button class="btn primary sm" type="submit">Add</button>
    </form>
    ${done.length ? `<div class="list-foot">
      <button class="link" data-action="list-uncheck" data-id="${esc(l.id)}">Uncheck all</button>
      <button class="link" data-action="list-clear" data-id="${esc(l.id)}">Remove checked</button></div>` : ''}
  </section>`;
}

export function view() {
  const title = `<div class="page-title"><h2>📝 Lists</h2>
    <button class="btn primary" data-action="list-new">＋ New list</button></div>`;
  if (state.foodMissing) return title + foodSetupNotice('custom lists');
  if (!state.lists.length) {
    return `${title}<div class="panel empty"><div class="empty-icon">📝</div>
      <h3>Lists for everything else</h3>
      <p>Packing for a trip, school supplies, date night ideas, movies to watch. Everyone sees the same list, live.</p>
      <button class="btn primary" data-action="list-new">Make a list</button></div>`;
  }
  return `${title}<div class="list-grid">${state.lists.map(listPanel).join('')}</div>`;
}

function newListForm() {
  return `<h2>New list</h2>
    <form data-form="list-create">
      <div class="field"><label>Start from</label>
        <div class="template-pick">${Object.entries(TEMPLATES).map(([k, t], i) => `<label>
          <input type="radio" name="template" value="${k}" ${i === 0 ? 'checked' : ''} data-toggle="list-template">
          <span>${t.icon} ${esc(t.label)}${t.items.length ? ` <small>${t.items.length} items</small>` : ''}</span></label>`).join('')}</div></div>
      <div class="field"><label for="ls-name">Name</label>
        <input id="ls-name" name="name" required maxlength="60" placeholder="e.g., Beach trip"></div>
      <div class="field"><label>Icon</label>${iconPicker('icon', LIST_ICONS, '📝')}</div>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">Create list</button>
      </div>
    </form>`;
}

function renameForm(l) {
  return `<h2>Edit list</h2>
    <form data-form="list-rename">
      <input type="hidden" name="id" value="${esc(l.id)}">
      <div class="field"><label for="lr-name">Name</label>
        <input id="lr-name" name="name" required maxlength="60" value="${esc(l.name)}"></div>
      <div class="field"><label>Icon</label>${iconPicker('icon', LIST_ICONS, l.icon)}</div>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">Save</button>
      </div>
    </form>`;
}

export const actions = {
  'list-new': () => {
    if (state.foodMissing) { toast('Run the Alpha 0.7 database update first. See the README.', 'error'); return; }
    openModal(newListForm());
  },
  'list-edit': el => {
    const l = state.lists.find(x => x.id === el.dataset.id);
    if (l) openModal(renameForm(l));
  },
  'list-delete': async el => {
    const l = state.lists.find(x => x.id === el.dataset.id);
    if (!l || !confirm(`Delete "${l.name}" and everything on it?`)) return;
    if (await run(sb.from('lists').delete().eq('id', l.id), 'List deleted')) {
      refresh('lists');
      refresh('listItems');
    }
  },
  'list-item-delete': async el => {
    if (await run(sb.from('list_items').delete().eq('id', el.dataset.id))) refresh('listItems');
  },
  'list-uncheck': async el => {
    if (await run(sb.from('list_items').update({ is_checked: false }).eq('list_id', el.dataset.id).eq('is_checked', true))) refresh('listItems');
  },
  'list-clear': async el => {
    if (!confirm('Remove the checked items from this list?')) return;
    if (await run(sb.from('list_items').delete().eq('list_id', el.dataset.id).eq('is_checked', true), 'Checked items removed')) refresh('listItems');
  },
};

export const toggles = {
  'list-item-check': async el => {
    await run(sb.from('list_items').update({ is_checked: el.checked }).eq('id', el.dataset.id));
    refresh('listItems');
  },
  // Picking a template fills in its name and icon
  'list-template': el => {
    const t = TEMPLATES[el.value];
    const name = document.getElementById('ls-name');
    if (t && name && (!name.value || Object.values(TEMPLATES).some(x => x.name === name.value))) name.value = t.name;
    const icon = document.querySelector(`#modal-root input[name=icon][value="${t?.icon}"]`);
    if (icon) icon.checked = true;
  },
};

export const forms = {
  'list-create': async d => {
    const name = d.name.trim();
    if (!name) return;
    const t = TEMPLATES[d.template] || TEMPLATES.blank;
    const { data, error } = await sb.from('lists').insert({ family_id: state.me.family_id, name, icon: d.icon || t.icon }).select().single();
    if (error) { await run(Promise.resolve({ error })); return; }
    if (t.items.length) {
      await run(sb.from('list_items').insert(t.items.map((text, i) => ({ family_id: state.me.family_id, list_id: data.id, text, sort_order: i }))));
    }
    toast('List created', 'success');
    closeModal();
    refresh('lists');
    refresh('listItems');
  },
  'list-rename': async d => {
    const name = d.name.trim();
    if (!name) return;
    if (await run(sb.from('lists').update({ name, icon: d.icon || '📝' }).eq('id', d.id), 'List saved')) {
      closeModal();
      refresh('lists');
    }
  },
  'list-item-add': async (d, f) => {
    const text = (d.text || '').trim();
    if (!text) return;
    const last = itemsOf(d.list_id).reduce((n, i) => Math.max(n, i.sort_order), -1);
    if (await run(sb.from('list_items').insert({ family_id: state.me.family_id, list_id: d.list_id, text, sort_order: last + 1 }))) {
      f.reset();
      refresh('listItems');
    }
  },
};
