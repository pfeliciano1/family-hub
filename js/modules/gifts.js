// Gifts: ideas and purchases for birthdays, holidays, and anyone else.
// A gift for someone in the family who has a login is hidden from them by
// the database, so surprises stay surprises. Gifts are never shown on Home,
// which may be on the TV.
import { sb } from '../supabase.js';
import { state, update } from '../state.js';
import {
  esc, avatar, openModal, closeModal, toast, fmtDate, parseDate, startOfToday, toISODate, daysBetween,
  daysLabel, money, parseMoney, setupNotice,
} from '../utils.js';
import { run, refresh } from '../data.js';
import { everyone, memberById } from './kids.js';
import { upcomingSpecialDays } from './birthdays.js';

export const STATUSES = [['idea', '💡', 'Idea'], ['bought', '🛍️', 'Bought'], ['wrapped', '🎀', 'Wrapped'], ['given', '✅', 'Given']];
const OCCASIONS = ['Christmas', 'Birthday', 'Anniversary', 'Mother\'s Day', 'Father\'s Day', 'Valentine\'s Day', 'Graduation', 'Just because'];
const OTHER = '__other';

const spent = list => list.filter(g => g.status !== 'idea').reduce((n, g) => n + (Number(g.price) || 0), 0);

function ideaCount(list) {
  const n = list.filter(g => g.status === 'idea').length;
  return n === 1 ? '1 idea' : `${n} ideas`;
}

function recipientLabel(g) {
  return g.recipient_id ? memberById(g.recipient_id)?.display_name || 'Someone' : g.recipient_name;
}

// People who have their own login (and so can't see gifts meant for them)
const hasLogin = m => Boolean(m?.user_id);

function privacyNote(memberId) {
  if (!memberId || memberId === OTHER) return '';
  const m = memberById(memberId);
  if (!m) return '';
  if (m.id === state.me.id) return '🙋 This is for you, so it goes on your wish list and everyone can see it.';
  if (hasLogin(m)) return `🔒 Hidden from ${esc(m.display_name)}.`;
  return `${esc(m.display_name)} doesn't have a login, but can see this on a shared device outside Kid mode.`;
}

function giftRow(g) {
  const st = STATUSES.find(s => s[0] === g.status) || STATUSES[0];
  const when = g.occasion_date ? fmtDate(parseDate(g.occasion_date), { month: 'short', day: 'numeric' }) : '';
  const sub = [g.occasion, when, g.note].filter(Boolean).map(esc).join(' • ');
  return `<div class="gift ${g.status}">
    <span class="big-ic" title="${st[2]}">${st[1]}</span>
    <div class="mr-main"><b>${esc(g.title)}</b>${g.url ? ` <a href="${esc(g.url)}" target="_blank" rel="noopener noreferrer" title="Open link">🔗</a>` : ''}
      ${sub ? `<small>${sub}</small>` : ''}</div>
    ${g.price != null ? `<span class="price">${money(g.price)}</span>` : ''}
    <div class="gift-ctl">
    <select class="gift-status" data-toggle="gift-status" data-id="${esc(g.id)}" aria-label="Status of ${esc(g.title)}">
      ${STATUSES.map(([v, i, l]) => `<option value="${v}" ${v === g.status ? 'selected' : ''}>${i} ${l}</option>`).join('')}</select>
    <span class="row-actions">
      <button class="icon-btn" data-action="gift-edit" data-id="${esc(g.id)}" title="Edit" aria-label="Edit ${esc(g.title)}">✏️</button>
      <button class="icon-btn" data-action="gift-delete" data-id="${esc(g.id)}" title="Delete" aria-label="Delete ${esc(g.title)}">🗑️</button></span>
    </div>
  </div>`;
}

// Upcoming birthdays, anniversaries, and gift dates in the next 60 days
function comingUp() {
  const today = startOfToday();
  const out = upcomingSpecialDays().filter(s => s.days <= 60).map(s => ({
    title: s.title, date: toISODate(s.next), days: s.days, memberId: s.memberId || '',
  }));
  const seen = new Set(out.map(o => `${o.title.toLowerCase()}|${o.date}`));
  for (const g of state.gifts) {
    if (!g.occasion_date || !g.occasion) continue;
    const days = daysBetween(today, parseDate(g.occasion_date));
    const key = `${g.occasion.toLowerCase()}|${g.occasion_date}`;
    if (days < 0 || days > 60 || seen.has(key)) continue;
    seen.add(key);
    out.push({ title: g.occasion, date: g.occasion_date, days, memberId: '' });
  }
  return out.sort((a, b) => a.days - b.days).slice(0, 6);
}

function giftsFor(o) {
  return state.gifts.filter(g => (g.occasion_date === o.date && (g.occasion || '').toLowerCase() === o.title.toLowerCase()) ||
    (o.memberId && g.recipient_id === o.memberId && g.occasion_date === o.date));
}

export function view() {
  const title = `<div class="page-title"><h2>🎁 Gifts</h2>
    <button class="btn primary" data-action="gift-new">＋ New gift</button></div>`;
  if (state.lifeMissing) return title + setupNotice('gift tracking');
  const soon = comingUp();
  const soonPanel = soon.length ? `<div class="panel"><h3>📅 Coming up</h3>
    ${soon.map(o => {
      const list = giftsFor(o);
      const ready = list.filter(g => g.status !== 'idea').length;
      return `<div class="member-row">
        <div class="mr-main"><b>${esc(o.title)}</b><small>${fmtDate(parseDate(o.date), { weekday: 'short', month: 'short', day: 'numeric' })}
          ${list.length ? ` • ${ready} of ${list.length} gift${list.length === 1 ? '' : 's'} ready` : ' • no gifts yet'}</small></div>
        <strong class="days">${daysLabel(o.days)}</strong>
        <button class="btn sm" data-action="gift-new" data-occasion="${esc(o.title)}" data-date="${o.date}" data-member="${esc(o.memberId)}">＋ Gift</button>
      </div>`;
    }).join('')}</div>` : '';

  const shown = state.gifts.filter(g => state.giftShowGiven || g.status !== 'given');
  const hiddenGiven = state.gifts.length - shown.length;
  const groups = [];
  for (const m of everyone()) {
    const list = shown.filter(g => g.recipient_id === m.id);
    if (list.length) groups.push({ head: `${avatar(m)} ${esc(m.display_name)}${m.id === state.me.id ? ' <small class="muted">(your wish list)</small>' : ''}`, list, memberId: m.id });
  }
  const names = [...new Set(shown.filter(g => !g.recipient_id).map(g => g.recipient_name.trim()))].sort((a, b) => a.localeCompare(b));
  for (const n of names) {
    groups.push({ head: `<span class="avatar" style="background:#8a97a8">${esc(n.slice(0, 1).toUpperCase())}</span> ${esc(n)}`, list: shown.filter(g => !g.recipient_id && g.recipient_name.trim() === n), name: n });
  }
  const statusOrder = g => STATUSES.findIndex(s => s[0] === g.status);

  const body = groups.length ? `<div class="kid-grid">${groups.map(gr => {
    const total = spent(gr.list);
    return `<section class="panel"><h3 class="who">${gr.head}</h3>
      <p class="muted small">${ideaCount(gr.list)}${total ? ` • ${money(total)} spent` : ''}</p>
      ${[...gr.list].sort((a, b) => statusOrder(a) - statusOrder(b)).map(giftRow).join('')}
      <button class="link" data-action="gift-new" ${gr.memberId ? `data-member="${esc(gr.memberId)}"` : `data-name="${esc(gr.name)}"`}>＋ Add a gift</button>
    </section>`;
  }).join('')}</div>`
    : `<div class="panel empty"><div class="empty-icon">🎁</div>
        <h3>Never scramble for a gift idea again</h3>
        <p>Jot down ideas the moment you hear them, then track what's bought and wrapped. Gifts you add for someone with their own login are hidden from them.</p>
        <button class="btn primary" data-action="gift-new">Add a gift idea</button></div>`;

  const totalSpent = spent(state.gifts);
  return `${title}${soonPanel}${body}
    <p class="muted small gift-foot">🔒 Gifts for someone with their own login are hidden from them.
      ${totalSpent ? `Total spent: ${money(totalSpent)}.` : ''}
      ${hiddenGiven || state.giftShowGiven ? `<button class="link" data-action="gift-toggle-given">${state.giftShowGiven ? 'Hide given gifts' : `Show ${hiddenGiven} given`}</button>` : ''}</p>`;
}

function form(g = {}, preset = {}) {
  const isNew = !g.id;
  const who = g.id ? (g.recipient_id || OTHER) : (preset.member || (preset.name ? OTHER : ''));
  const name = g.recipient_name || preset.name || '';
  const specials = upcomingSpecialDays();
  return `<h2>${isNew ? 'New gift' : 'Edit gift'}</h2>
    <form data-form="gift-save">
      <input type="hidden" name="id" value="${esc(g.id || '')}">
      <div class="field"><label for="gf-who">For</label>
        <select id="gf-who" name="recipient" required data-toggle="gift-who">
          <option value="" ${who ? '' : 'selected'} disabled>Pick someone…</option>
          ${everyone().map(m => `<option value="${esc(m.id)}" ${m.id === who ? 'selected' : ''}>${esc(m.display_name)}${m.id === state.me.id ? ' (me)' : ''}</option>`).join('')}
          <option value="${OTHER}" ${who === OTHER ? 'selected' : ''}>Someone else…</option>
        </select>
        <small class="muted" id="gf-privacy">${privacyNote(who)}</small></div>
      <div class="field ${who === OTHER ? '' : 'hidden'}" id="gf-name-field"><label for="gf-name">Their name</label>
        <input id="gf-name" name="recipient_name" maxlength="60" value="${esc(name)}" placeholder="e.g., Grandma" list="gf-names" autocomplete="off">
        <datalist id="gf-names">${[...new Set(state.gifts.filter(x => x.recipient_name).map(x => x.recipient_name))].map(n => `<option value="${esc(n)}">`).join('')}</datalist></div>
      <div class="field"><label for="gf-title">Gift</label>
        <input id="gf-title" name="title" required maxlength="100" value="${esc(g.title || '')}" placeholder="e.g., LEGO castle set"></div>
      <div class="field-row">
        <div class="field"><label for="gf-occ">Occasion (optional)</label>
          <input id="gf-occ" name="occasion" maxlength="60" value="${esc(g.occasion || preset.occasion || '')}" list="gf-occ-list" autocomplete="off"
            placeholder="e.g., Christmas" data-toggle="gift-occasion">
          <datalist id="gf-occ-list">${[...specials.map(s => s.title), ...OCCASIONS].map(o => `<option value="${esc(o)}">`).join('')}</datalist></div>
        <div class="field"><label for="gf-date">Date (optional)</label>
          <input id="gf-date" type="date" name="occasion_date" value="${esc(g.occasion_date || preset.date || '')}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="gf-price">Price (optional)</label>
          <input id="gf-price" name="price" inputmode="decimal" maxlength="12" value="${g.price != null ? esc(g.price) : ''}" placeholder="$0.00"></div>
        <div class="field"><label for="gf-status">Status</label>
          <select id="gf-status" name="status">${STATUSES.map(([v, i, l]) => `<option value="${v}" ${v === (g.status || 'idea') ? 'selected' : ''}>${i} ${l}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label for="gf-url">Link (optional)</label>
        <input id="gf-url" name="url" type="url" maxlength="500" value="${esc(g.url || '')}" placeholder="https://…"></div>
      <div class="field"><label for="gf-note">Note (optional)</label>
        <input id="gf-note" name="note" maxlength="200" value="${esc(g.note || '')}" placeholder="e.g., size M, blue"></div>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">${isNew ? 'Add gift' : 'Save changes'}</button>
      </div>
    </form>`;
}

export const actions = {
  'gift-new': el => {
    if (state.lifeMissing) { toast('Run the Alpha 0.8 database update first. See the README.', 'error'); return; }
    const d = el?.dataset || {};
    openModal(form({}, { member: d.member || '', name: d.name || '', occasion: d.occasion || '', date: d.date || '' }));
  },
  'gift-edit': el => {
    const g = state.gifts.find(x => x.id === el.dataset.id);
    if (g) openModal(form(g));
  },
  'gift-delete': async el => {
    const g = state.gifts.find(x => x.id === el.dataset.id);
    if (!g || !confirm(`Delete "${g.title}" for ${recipientLabel(g)}?`)) return;
    if (await run(sb.from('gifts').delete().eq('id', g.id), 'Gift deleted')) refresh('gifts');
  },
  'gift-toggle-given': () => update({ giftShowGiven: !state.giftShowGiven }),
};

export const toggles = {
  'gift-status': async el => {
    const st = STATUSES.find(s => s[0] === el.value);
    if (await run(sb.from('gifts').update({ status: el.value }).eq('id', el.dataset.id), st ? `Marked ${st[2].toLowerCase()}` : '')) refresh('gifts');
  },
  'gift-who': el => {
    document.getElementById('gf-name-field')?.classList.toggle('hidden', el.value !== OTHER);
    const note = document.getElementById('gf-privacy');
    if (note) note.innerHTML = privacyNote(el.value);
    if (el.value === OTHER) document.getElementById('gf-name')?.focus();
  },
  // Picking "Ana's birthday" from the suggestions fills in the date
  'gift-occasion': el => {
    const s = upcomingSpecialDays().find(x => x.title.toLowerCase() === el.value.trim().toLowerCase());
    const date = document.getElementById('gf-date');
    if (s && date && !date.value) date.value = toISODate(s.next);
  },
};

export const forms = {
  'gift-save': async d => {
    const other = d.recipient === OTHER;
    const name = (d.recipient_name || '').trim();
    if (!d.recipient) { toast('Pick who the gift is for.', 'error'); return; }
    if (other && !name) { toast('Type the person\'s name.', 'error'); return; }
    const url = (d.url || '').trim();
    const row = {
      recipient_id: other ? null : d.recipient,
      recipient_name: other ? name.slice(0, 60) : null,
      title: d.title.trim(),
      occasion: (d.occasion || '').trim() || null,
      occasion_date: d.occasion_date || null,
      price: parseMoney(d.price),
      status: d.status || 'idea',
      url: /^https?:\/\//i.test(url) ? url : null,
      note: (d.note || '').trim() || null,
    };
    if (!row.title) return;
    const query = d.id
      ? sb.from('gifts').update(row).eq('id', d.id)
      : sb.from('gifts').insert({ ...row, family_id: state.me.family_id });
    const m = row.recipient_id && memberById(row.recipient_id);
    const msg = d.id ? 'Gift saved' : (m && hasLogin(m) && m.id !== state.me.id ? `Gift added, hidden from ${m.display_name} 🤫` : 'Gift added');
    if (await run(query, msg)) {
      closeModal();
      refresh('gifts');
    }
  },
};
