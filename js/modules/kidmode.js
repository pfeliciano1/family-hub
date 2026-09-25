// Kid mode: a simple, kid-sized screen for a shared tablet or laptop.
// A child picks their picture (and PIN, if they have one) and sees only
// their own chores, routines, habits, and rewards. A parent PIN is needed
// to leave. This is a convenience lock for family devices, not security:
// the device stays signed in with the parent's account.
import { sb } from '../supabase.js';
import { state, update } from '../state.js';
import { esc, avatar, openModal, closeModal, toast } from '../utils.js';
import { run, refresh } from '../data.js';
import {
  children, memberById, balanceOf, pendingSpend, starLine, progressBar, goalOf, choresForToday,
  completionFor, choreDate, pinHash, validPin,
} from './kids.js';
import { choreRow } from './chores.js';
import { routineCard } from './routines.js';
import { habitRow } from './habits.js';
import { rewardsFor } from './rewards.js';

const KEY = 'familyHub.kid';

function remember(id) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch { /* private mode */ }
}

export function restore() {
  try {
    const id = localStorage.getItem(KEY);
    if (id === 'picker') state.kidPicker = true;
    else if (id) state.kidId = id;
  } catch { /* private mode */ }
}

export const active = () => Boolean(state.kidId || state.kidPicker);

function pickerView() {
  const kids = children();
  return `<div class="kid-app"><div class="kid-picker">
    <h1>Who's here? 👋</h1>
    <div class="kid-faces">${kids.length ? kids.map(m => `<button class="kid-face" data-action="kid-pick" data-id="${esc(m.id)}" style="--c:${esc(m.color)}">
        ${avatar(m, 'xl')}<b>${esc(m.display_name)}</b>${m.pin_hash ? '<small>🔒 PIN</small>' : ''}</button>`).join('')
      : '<p>No kids added yet. A parent can add them in Settings.</p>'}</div>
    <button class="btn" data-action="kid-exit">🔒 Parent view</button>
  </div></div>`;
}

function kidView(m) {
  const bal = balanceOf(m.id);
  const goal = goalOf(m);
  const chores = choresForToday(m.id);
  const routines = state.routines.filter(r => r.member_id === m.id);
  const habits = state.habits.filter(h => h.member_id === m.id);
  const rewards = rewardsFor(m.id);
  const spendable = bal - pendingSpend(m.id);
  const waiting = state.claims.filter(c => c.member_id === m.id && c.status === 'pending');
  const choresLeft = chores.filter(c => {
    const x = completionFor(c, choreDate(c));
    return !x || x.status === 'rejected';
  }).length;

  return `<div class="kid-app" style="--kid:${esc(m.color)}">
    <header class="kid-top">
      <div class="kid-hello">${avatar(m, 'lg')}<div><h1>Hi ${esc(m.display_name)}! 👋</h1>
        <p>${chores.length ? (choresLeft ? `${choresLeft} chore${choresLeft === 1 ? '' : 's'} to go today` : 'All chores done today! 🎉') : 'No chores today'}</p></div></div>
      <div class="kid-stars">${starLine(bal)}<small>stars</small></div>
      <div class="kid-actions">
        <button class="btn sm" data-action="kid-switch">Switch</button>
        <button class="btn sm" data-action="kid-exit">🔒 Exit</button>
      </div>
    </header>
    ${goal ? `<section class="kid-card kid-goal"><b>Saving for ${esc(goal.icon)} ${esc(goal.title)}</b>
      ${progressBar(bal, goal.cost, m.color)}
      <small>${bal >= goal.cost ? 'You have enough! Ask for it below. 🎉' : `${goal.cost - bal} more ⭐ to go!`}</small></section>` : ''}
    <div class="kid-grid">
      <section class="kid-card"><h2>✅ My chores</h2>
        ${chores.length ? chores.map(c => choreRow(c, true)).join('') : '<p class="muted">Nothing today. Enjoy! 🎈</p>'}</section>
      ${routines.length ? `<section class="kid-card"><h2>🔄 My routines</h2>${routines.map(r => routineCard(r, true)).join('')}</section>` : ''}
      ${habits.length ? `<section class="kid-card"><h2>❤️ My habits</h2>${habits.map(h => habitRow(h, true)).join('')}</section>` : ''}
      <section class="kid-card"><h2>🎁 Rewards</h2>
        ${waiting.length ? waiting.map(c => `<div class="kid-reward waiting"><span>${esc(c.title)}</span><small>Waiting for a parent</small></div>`).join('') : ''}
        ${rewards.length ? rewards.map(r => `<div class="kid-reward">
            <span class="big-ic">${esc(r.icon)}</span><div class="mr-main"><b>${esc(r.title)}</b><small>${r.cost} ⭐</small></div>
            <button class="btn sm ${spendable >= r.cost ? 'primary' : ''}" data-action="claim-new" data-id="${esc(r.id)}" ${spendable >= r.cost ? '' : 'disabled'}>
              ${spendable >= r.cost ? 'Ask for it' : `${r.cost - spendable} more`}</button></div>`).join('')
          : '<p class="muted">No rewards yet. Ask a parent to add some!</p>'}
      </section>
    </div>
    <footer class="footer"><span>${state.live ? '<span class="live">● Live</span>' : '<span class="offline">○ Connecting…</span>'}</span><span>Family Hub • Kid mode</span></footer>
  </div>`;
}

export function view() {
  const m = state.kidId && memberById(state.kidId);
  if (!m || state.kidPicker) return pickerView();
  return kidView(m);
}

function pinForm(formName, title, hidden = '') {
  return `<h2>${title}</h2>
    <form data-form="${formName}">
      ${hidden}
      <div class="field"><label for="pin-in">PIN</label>
        <input id="pin-in" class="pin-input" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4"
          autocomplete="off" required placeholder="••••"></div>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">OK</button>
      </div>
    </form>`;
}

function enterKid(id) {
  remember(id);
  closeModal();
  update({ kidId: id, kidPicker: false });
  window.scrollTo(0, 0);
}

function leave() {
  remember(null);
  closeModal();
  update({ kidId: null, kidPicker: false });
}

export const actions = {
  'kid-mode-start': () => {
    closeModal();
    if (state.kidsMissing) { toast('Run the Alpha 0.6 database update first. See the README.', 'error'); return; }
    if (!children().length) { toast('Add your kids in Settings first.', 'error'); return; }
    if (!state.family.parent_pin_hash &&
      !confirm('There\'s no parent PIN yet, so anyone can leave Kid mode. You can set one in Settings → Kid mode. Start Kid mode anyway?')) return;
    remember('picker');
    update({ kidPicker: true, kidId: null });
  },
  'kid-switch': () => { remember('picker'); update({ kidPicker: true }); },
  'kid-pick': el => {
    const m = memberById(el.dataset.id);
    if (!m) return;
    if (m.pin_hash) openModal(pinForm('kid-pin', `${esc(m.display_name)}'s PIN`, `<input type="hidden" name="id" value="${esc(m.id)}">`));
    else enterKid(m.id);
  },
  'kid-exit': () => {
    if (state.family.parent_pin_hash) openModal(pinForm('parent-pin', 'Parent PIN'));
    else leave();
  },
  'parent-pin-clear': async () => {
    if (!confirm('Remove the parent PIN? Anyone will be able to leave Kid mode.')) return;
    if (await run(sb.from('families').update({ parent_pin_hash: null }).eq('id', state.family.id), 'Parent PIN removed')) refresh('family');
  },
};

export const forms = {
  'kid-pin': async (d, f) => {
    const m = memberById(d.id);
    if (m && await pinHash(m.id, d.pin) === m.pin_hash) enterKid(m.id);
    else wrong(f);
  },
  'parent-pin': async (d, f) => {
    if (await pinHash(state.family.id, d.pin) === state.family.parent_pin_hash) leave();
    else wrong(f);
  },
  'parent-pin-save': async d => {
    if (!validPin(d.pin)) { toast('The PIN must be 4 digits.', 'error'); return; }
    if (d.pin !== d.pin2) { toast('The two PINs don\'t match.', 'error'); return; }
    const hash = await pinHash(state.family.id, d.pin);
    if (await run(sb.from('families').update({ parent_pin_hash: hash }).eq('id', state.family.id), 'Parent PIN saved')) {
      refresh('family');
    }
  },
};

function wrong(f) {
  const input = f.querySelector('input[name=pin]');
  input.value = '';
  input.focus();
  toast('That PIN isn\'t right. Try again.', 'error');
}

// Settings panel
export function settingsPanel() {
  const has = Boolean(state.family.parent_pin_hash);
  return `<section class="panel">
    <h3>🧒 Kid mode</h3>
    <p class="muted">Turns a shared tablet or laptop into a kid-friendly screen with just their chores, routines, habits, and rewards. Kids can give themselves a PIN in their profile.</p>
    <form data-form="parent-pin-save" class="pin-row">
      <div class="field"><label for="pp1">${has ? 'Change parent PIN' : 'Parent PIN (needed to leave Kid mode)'}</label>
        <input id="pp1" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="new-password" required placeholder="4 digits"></div>
      <div class="field"><label for="pp2">Type it again</label>
        <input id="pp2" name="pin2" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="new-password" required placeholder="4 digits"></div>
      <button class="btn" type="submit">Save PIN</button>
    </form>
    <p class="muted small">${has ? '🔒 A parent PIN is set. <button class="link" data-action="parent-pin-clear">Remove it</button>' : 'No parent PIN yet.'}</p>
    <button class="btn primary" data-action="kid-mode-start">Start Kid mode on this device</button>
  </section>`;
}
