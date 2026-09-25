// Settings: family details, weather location, members, invite code, account.
import { sb } from '../supabase.js';
import { state, update } from '../state.js';
import {
  esc, avatar, fmtDate, parseDate, openModal, closeModal, toast,
} from '../utils.js';
import { run, refresh } from '../data.js';

const PALETTE = ['#1976d2', '#8e24aa', '#2e7d32', '#ef6c00', '#c62828', '#00838f', '#6d4c41', '#3949ab'];

function memberRow(m) {
  const you = m.user_id === state.user.id;
  const badge = you ? '<span class="pill">You</span>' : m.user_id ? '<span class="pill muted-pill">Has a login</span>' : '';
  const bday = m.birthday ? ` • 🎂 ${fmtDate(parseDate(m.birthday), { month: 'long', day: 'numeric' })}` : '';
  return `<div class="member-row">
    ${avatar(m)}
    <div class="mr-main"><b>${esc(m.display_name)}</b> ${badge}
      <small>${m.role === 'parent' ? 'Parent' : 'Child'}${bday}</small></div>
    <div class="row-actions">
      <button class="icon-btn" data-action="member-edit" data-id="${esc(m.id)}" title="Edit" aria-label="Edit ${esc(m.display_name)}">✏️</button>
      ${you ? '' : `<button class="icon-btn" data-action="member-delete" data-id="${esc(m.id)}" title="Remove" aria-label="Remove ${esc(m.display_name)}">🗑️</button>`}
    </div>
  </div>`;
}

export function view() {
  const f = state.family;
  const isParent = state.me.role === 'parent';
  return `<div class="page-title"><h2>⚙️ Settings</h2></div>
  <div class="settings-grid">
    <section class="panel">
      <h3>🏠 Family</h3>
      <form data-form="family-save">
        <div class="field"><label for="s-name">Family name</label>
          <input id="s-name" name="name" value="${esc(f.name)}" required maxlength="80" ${isParent ? '' : 'disabled'}></div>
        <div class="field"><label for="s-unit">Temperature</label>
          <select id="s-unit" name="temp_unit" ${isParent ? '' : 'disabled'}>
            <option value="fahrenheit" ${f.temp_unit !== 'celsius' ? 'selected' : ''}>°F (Fahrenheit)</option>
            <option value="celsius" ${f.temp_unit === 'celsius' ? 'selected' : ''}>°C (Celsius)</option>
          </select></div>
        ${isParent ? '<button class="btn primary" type="submit">Save family details</button>' : ''}
      </form>
    </section>

    <section class="panel">
      <h3>📍 Weather location</h3>
      <p class="muted">${f.location_name ? `Currently: <b>${esc(f.location_name)}</b>` : 'Not set yet. Search for your town to turn on weather and clothing suggestions.'}</p>
      <form class="inline-add" data-form="loc-search">
        <input id="loc-q" name="q" placeholder="Town or city name" required maxlength="60" autocomplete="off" aria-label="Town or city">
        <button class="btn primary" type="submit">Search</button>
      </form>
      ${state.locResults.length ? `<p class="muted small">Pick the right one:</p><div class="loc-results">${state.locResults.map(r => {
        const label = [r.name, r.admin1, r.country_code === 'US' ? null : r.country].filter(Boolean).join(', ');
        return `<button class="loc-opt" data-action="loc-pick" data-lat="${esc(r.latitude)}" data-lon="${esc(r.longitude)}" data-name="${esc(label)}">📍 ${esc(label)}</button>`;
      }).join('')}</div>` : ''}
    </section>

    <section class="panel wide">
      <div class="panel-head"><h3>👨‍👩‍👧‍👦 Family members</h3>
        ${isParent ? '<button class="btn primary sm" data-action="member-new">＋ Add member</button>' : ''}</div>
      ${state.members.map(memberRow).join('')}
      <p class="muted small">Kids don't need their own email or login. Add them here; kid-friendly profiles with a PIN come with the Rewards system.</p>
    </section>

    <section class="panel">
      <h3>🔑 Invite another adult</h3>
      <p class="muted">To give your spouse or partner their own login, have them open Family Hub, create an account, choose <b>Join your family</b>, and enter this code:</p>
      <div class="invite"><code>${esc(f.invite_code)}</code>
        <button class="btn sm" data-action="copy-invite">Copy</button></div>
      <p class="muted small">If you already added them above as a Parent, they should type the same name when joining. Their profile gets linked instead of duplicated.</p>
    </section>

    <section class="panel">
      <h3>👤 Your account</h3>
      <p>Signed in as <b>${esc(state.user.email)}</b></p>
      <button class="btn" data-action="sign-out">Sign out</button>
    </section>
  </div>`;
}

function memberForm(m = {}) {
  const isNew = !m.id;
  const you = m.user_id && m.user_id === state.user.id;
  const color = m.color || PALETTE[state.members.length % PALETTE.length];
  return `<h2>${isNew ? 'Add a family member' : `Edit ${esc(m.display_name)}`}</h2>
    <form data-form="member-save">
      <input type="hidden" name="id" value="${esc(m.id || '')}">
      <div class="field"><label for="m-name">Name</label>
        <input id="m-name" name="display_name" required maxlength="40" value="${esc(m.display_name || '')}" placeholder="First name or nickname"></div>
      <div class="field-row">
        <div class="field"><label for="m-role">Role</label>
          <select id="m-role" name="role" ${you ? 'disabled' : ''}>
            <option value="parent" ${m.role === 'parent' ? 'selected' : ''}>Parent</option>
            <option value="child" ${m.role !== 'parent' ? 'selected' : ''}>Child</option>
          </select>
          ${you ? '<small class="muted">You can\'t change your own role.</small>' : ''}</div>
        <div class="field"><label for="m-bday">Birthday (optional)</label>
          <input id="m-bday" type="date" name="birthday" value="${esc(m.birthday || '')}"></div>
      </div>
      <div class="field"><label>Color</label>
        <div class="swatches">${PALETTE.map(c => `<label class="swatch" style="--c:${c}">
          <input type="radio" name="color" value="${c}" ${c === color ? 'checked' : ''} aria-label="Color ${c}"><span></span></label>`).join('')}</div></div>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">${isNew ? 'Add member' : 'Save changes'}</button>
      </div>
    </form>`;
}

export const actions = {
  'member-new': () => openModal(memberForm()),
  'member-edit': el => openModal(memberForm(state.members.find(m => m.id === el.dataset.id))),
  'member-delete': async el => {
    const m = state.members.find(x => x.id === el.dataset.id);
    if (!m) return;
    const warning = m.user_id
      ? `Remove ${m.display_name}? They will lose access to Family Hub.`
      : `Remove ${m.display_name} from the family?`;
    if (!confirm(warning)) return;
    if (await run(sb.from('family_members').delete().eq('id', m.id), `${m.display_name} removed`)) refresh('members');
  },
  'copy-invite': async () => {
    try {
      await navigator.clipboard.writeText(state.family.invite_code);
      toast('Invite code copied', 'success');
    } catch {
      toast(`Invite code: ${state.family.invite_code}`);
    }
  },
  'loc-pick': async el => {
    const { lat, lon, name } = el.dataset;
    const query = sb.from('families')
      .update({ location_name: name, latitude: Number(lat), longitude: Number(lon) })
      .eq('id', state.family.id);
    if (await run(query, 'Location saved')) {
      state.locResults = [];
      await refresh('family');
    }
  },
};

export const forms = {
  'family-save': async d => {
    const query = sb.from('families')
      .update({ name: d.name.trim(), temp_unit: d.temp_unit })
      .eq('id', state.family.id);
    if (await run(query, 'Family details saved')) await refresh('family');
  },
  'loc-search': async d => {
    const q = d.q.trim();
    if (!q) return;
    try {
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`);
      const j = await res.json();
      update({ locResults: j.results || [] });
      if (!j.results?.length) toast('No places found. Try just the town name, without the state.', 'error');
    } catch {
      toast('Location search is unavailable right now.', 'error');
    }
  },
  'member-save': async d => {
    const existing = state.members.find(m => m.id === d.id);
    const row = {
      display_name: d.display_name.trim(),
      role: d.role || existing?.role || 'child',
      color: d.color || PALETTE[0],
      birthday: d.birthday || null,
    };
    const query = d.id
      ? sb.from('family_members').update(row).eq('id', d.id)
      : sb.from('family_members').insert({ ...row, family_id: state.me.family_id, sort_order: state.members.length });
    if (await run(query, d.id ? 'Changes saved' : `${row.display_name} added`)) {
      closeModal();
      refresh('members');
    }
  },
};
