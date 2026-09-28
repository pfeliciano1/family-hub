// The Home dashboard: what's happening, what needs doing, what's coming up.
import { state, update } from '../state.js';
import { sb } from '../supabase.js';
import { run } from '../data.js';
import {
  esc, avatar, greeting, todayLong, timeNow, fmtDate, daysLabel, cardHead, emptyMini, toast,
} from '../utils.js';
import { upcomingCountdowns } from './countdowns.js';
import { dashboardTasks, taskRow } from './tasks.js';
import { groceryRow } from './grocery.js';
import { heroWeather, weatherCard } from './weather.js';
import { upcomingSpecialDays, specialRow } from './birthdays.js';
import { todayCard } from './calendar.js';
import { homeCard as rewardsCard } from './rewards.js';
import { routinesHomeCard, habitsHomeCard } from './habits.js';
import { homeCard as dinnerCard } from './meals.js';
import { homeCard as projectsCard } from './projects.js';
import { homeCard as memoryCard } from './memories.js';
import { homeCard as listsCard } from './lists.js';
import { homeCard as recipesCard } from './recipes.js';

function countdownsCard() {
  const list = upcomingCountdowns().filter(c => c.show_on_dashboard).slice(0, 4);
  const body = list.length
    ? list.map(c => `<div class="countdown">
        <span>${c.icon} ${esc(c.title)}<small>${fmtDate(c.next, { weekday: 'short', month: 'short', day: 'numeric' })}</small></span>
        <strong>${daysLabel(c.days)}</strong></div>`).join('')
    : emptyMini('No countdowns yet.', 'countdown-new', 'Add one');
  return `<div class="card">${cardHead('⏳', 'Countdowns', 'countdowns')}${body}</div>`;
}

function membersCard() {
  return `<div class="card">${cardHead('👨‍👩‍👧‍👦', 'Family', 'settings', 'Manage')}
    <div class="member-grid">${state.members.map(m => `<div class="member-tile">
      ${avatar(m, 'lg')}<b>${esc(m.display_name)}</b><small>${m.role === 'parent' ? 'Parent' : 'Child'}</small></div>`).join('')}
    </div>
    ${state.members.length < 2 ? emptyMini('Add the rest of the family.', 'member-new', 'Add a member') : ''}</div>`;
}

function tasksCard() {
  const list = dashboardTasks();
  const body = list.length
    ? list.slice(0, 6).map(t => taskRow(t)).join('') +
      (list.length > 6 ? `<a class="more" href="#/tasks">+${list.length - 6} more</a>` : '')
    : emptyMini('Nothing due today. 🎉', 'task-new', 'Add a task');
  return `<div class="card">${cardHead('✅', 'Today\'s Tasks', 'tasks')}${body}</div>`;
}

function groceryCard() {
  const needed = state.grocery.filter(g => !g.is_checked);
  const shown = needed.slice(0, 6);
  return `<div class="card">${cardHead('🛒', 'Grocery List', 'grocery')}
    ${shown.length ? shown.map(g => groceryRow(g)).join('') : '<p class="muted">The list is empty.</p>'}
    ${needed.length > 6 ? `<a class="more" href="#/grocery">+${needed.length - 6} more</a>` : ''}
    <form class="inline-add" data-form="grocery-quick">
      <input id="home-grocery" name="name" placeholder="Add an item…" maxlength="80" autocomplete="off" required aria-label="Add a grocery item">
      <button class="btn primary sm" type="submit">Add</button>
    </form></div>`;
}

function birthdaysCard() {
  const list = upcomingSpecialDays().slice(0, 4);
  const body = list.length
    ? list.map(specialRow).join('')
    : `<div class="empty-mini">Add birthdays to family profiles in <a href="#/settings">Settings</a>.</div>`;
  return `<div class="card">${cardHead('🎂', 'Birthdays & Anniversaries', 'birthdays')}${body}</div>`;
}

function quickAddCard() {
  if (state.tv) return ''; // nothing to tap on the TV
  return `<div class="card quick-card">${cardHead('⚡', 'Quick Add')}
    <div class="quick">
      <button data-action="task-new">＋ Task</button>
      <button data-action="grocery-new">＋ Grocery</button>
      <button data-action="countdown-new">＋ Countdown</button>
      <button data-action="chore-new">＋ Chore</button>
      <button data-action="event-new">＋ Event</button>
      <button data-action="meal-new">＋ Meal</button>
      <button data-action="memory-new">＋ Memory</button>
      <button data-action="project-new">＋ Project</button>
      <button data-action="list-new">＋ List</button>
    </div></div>`;
}

// iPhones and iPads don't offer to install web apps on their own, so show
// how once (until dismissed). Hidden when already opened from the home screen.
function installHint() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS reports as a Mac
  const installed = navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
  let dismissed = false;
  try { dismissed = localStorage.getItem('familyHub.installHint') === 'no'; } catch { /* private mode */ }
  if (!ios || installed || dismissed || state.tv) return '';
  return `<div class="notice install-hint">
    <b>📲 Add Family Hub to your home screen</b>
    <span>In Safari, tap the Share button <span aria-hidden="true">(□↑)</span>, scroll down, and tap <b>Add to Home Screen</b>, then <b>Add</b>.</span>
    <button class="link" data-action="install-hint-hide">Got it</button></div>`;
}

// ---------- Layout: which cards show, and in what order ----------

// id, icon, name, how to draw it. This order is the default layout.
const CARDS = [
  ['today', '📅', 'Today\'s Calendar', todayCard],
  ['tasks', '✅', 'Today\'s Tasks', tasksCard],
  ['quick', '⚡', 'Quick Add', quickAddCard],
  ['dinner', '🍽️', 'Dinner Tonight', dinnerCard],
  ['grocery', '🛒', 'Grocery List', groceryCard],
  ['lists', '📝', 'Lists', listsCard],
  ['rewards', '⭐', 'Rewards', rewardsCard],
  ['routines', '🔄', 'Routines', routinesHomeCard],
  ['habits', '❤️', 'Habits', habitsHomeCard],
  ['countdowns', '⏳', 'Countdowns', countdownsCard],
  ['birthdays', '🎂', 'Birthdays & Anniversaries', birthdaysCard],
  ['projects', '🔨', 'Home Projects', projectsCard],
  ['recipes', '📖', 'Recipes', recipesCard],
  ['memory', '📸', 'Family Memories', memoryCard],
  ['weather', '🌤️', 'Weather & What to Wear', weatherCard],
  ['members', '👨‍👩‍👧‍👦', 'Family', membersCard],
];
const BY_ID = Object.fromEntries(CARDS.map(c => [c[0], c]));

// The saved order, with any cards added in later versions slotted in
// after the card they follow by default.
function layout() {
  const saved = state.homeLayout || {};
  const order = (saved.order || []).filter(id => BY_ID[id]);
  CARDS.forEach(([id], i) => {
    if (order.includes(id)) return;
    const before = CARDS.slice(0, i).map(c => c[0]).reverse().find(b => order.includes(b));
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, id);
  });
  const hidden = new Set((saved.hidden || []).filter(id => BY_ID[id]));
  return { order, hidden };
}

async function saveLayout(order, hidden) {
  const value = { order, hidden: [...hidden] };
  update({ homeLayout: value, layoutChangedAt: Date.now() });
  if (state.layoutMissing) {
    try { localStorage.setItem('familyHub.homeLayout', JSON.stringify(value)); } catch { /* private mode */ }
    return;
  }
  await run(sb.from('home_layouts').upsert({
    member_id: state.me.id, family_id: state.me.family_id, layout: value, updated_at: new Date().toISOString(),
  }));
}

function move(id, to) {
  const { order, hidden } = layout();
  const shown = order.filter(x => !hidden.has(x));
  const from = shown.indexOf(id);
  if (from < 0 || to < 0 || to >= shown.length || to === from) return;
  const target = shown[to];
  order.splice(order.indexOf(id), 1);
  order.splice(order.indexOf(target) + (to > from ? 1 : 0), 0, id);
  saveLayout(order, hidden);
}

function editSlot(id, html, i, count) {
  const [, icon, name] = BY_ID[id];
  const body = html || `<div class="card slot-empty">${cardHead(icon, name)}<p class="muted">Nothing to show here yet.</p></div>`;
  return `<div class="card-slot" data-card="${id}">
    <div class="slot-bar">
      <span class="grip" title="Drag to move" aria-hidden="true">⠿</span>
      <b>${icon} ${esc(name)}</b>
      <button class="icon-btn" data-action="home-move" data-id="${id}" data-to="${i - 1}" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(name)} earlier"><span class="wide-only">←</span><span class="narrow-only">↑</span></button>
      <button class="icon-btn" data-action="home-move" data-id="${id}" data-to="${i + 1}" ${i === count - 1 ? 'disabled' : ''} aria-label="Move ${esc(name)} later"><span class="wide-only">→</span><span class="narrow-only">↓</span></button>
      <button class="btn sm" data-action="home-hide" data-id="${id}">Hide</button>
    </div>
    <div class="slot-card">${body}</div></div>`;
}

function editBar() {
  const { hidden } = layout();
  const tray = CARDS.filter(([id]) => hidden.has(id));
  return `<div class="edit-bar">
    <div class="edit-bar-top">
      <div><b>Customize your Home</b>
        <span>Drag a card by its bar, or use the arrows.
        Only you see this layout${state.layoutMissing ? ' (saved on this device until the database update)' : ', on every device you sign in to'}.</span></div>
      <div class="edit-bar-btns">
        <button class="btn sm" data-action="home-reset">Reset to default</button>
        <button class="btn primary sm" data-action="home-edit-done">Done</button>
      </div>
    </div>
    <div class="tray"><small>Hidden cards</small>
      ${tray.length
        ? tray.map(([id, icon, name]) => `<button class="chip-add" data-action="home-show" data-id="${id}">＋ ${icon} ${esc(name)}</button>`).join('')
        : '<span class="muted">None. Tap Hide on a card to take it off your Home.</span>'}
    </div></div>`;
}

function grid() {
  const { order, hidden } = layout();
  const shown = order.filter(id => !hidden.has(id));
  if (state.homeEdit && !state.tv) {
    return `${editBar()}<div class="grid editing">${shown.map((id, i) => editSlot(id, BY_ID[id][3](), i, shown.length)).join('')}</div>
      <div class="edit-foot"><button class="btn primary" data-action="home-edit-done">Done</button></div>`;
  }
  const cards = shown.map(id => BY_ID[id][3]()).join('');
  return `<div class="grid">${cards || `<div class="card">${emptyMini('All your cards are hidden.', 'home-edit', 'Customize')}</div>`}</div>`;
}

// Drag and drop by the card's bar, with a mouse or a finger. The bar
// doesn't scroll the page, so a finger on the card itself still does.
let drag = null; // { id, slot, x, y, lastX, lastY, over, timer }

function dragMove(clientX, clientY) {
  if (!drag.slot.isConnected) return dragEnd(false); // the page redrew underneath
  drag.lastX = clientX; drag.lastY = clientY;
  drag.slot.style.transform = `translate(${clientX - drag.x}px, ${clientY + window.scrollY - drag.y}px)`;
  const under = document.elementFromPoint(clientX, clientY)?.closest('.card-slot');
  const over = under && under !== drag.slot ? under : null;
  if (over !== drag.over) {
    drag.over?.classList.remove('drop');
    over?.classList.add('drop');
    drag.over = over;
  }
}

function dragEnd(drop = true) {
  const d = drag;
  if (!d) return;
  drag = null;
  window.clearInterval(d.timer);
  d.slot.classList.remove('dragging');
  d.slot.style.transform = '';
  d.over?.classList.remove('drop');
  document.body.classList.remove('home-dragging');
  if (drop && d.over) {
    const slots = [...document.querySelectorAll('.card-slot')].map(s => s.dataset.card);
    move(d.id, slots.indexOf(d.over.dataset.card));
  }
}

document.addEventListener('pointerdown', e => {
  const bar = e.target.closest?.('.slot-bar');
  if (!bar || e.target.closest('button') || e.button > 0) return;
  const slot = bar.closest('.card-slot');
  e.preventDefault();
  drag = { id: slot.dataset.card, slot, x: e.clientX, y: e.clientY + window.scrollY, over: null };
  slot.classList.add('dragging');
  document.body.classList.add('home-dragging');
  // Scroll while a card is held near the top or bottom of the screen
  drag.timer = setInterval(() => {
    if (!drag || drag.lastY == null) return;
    const edge = 70;
    const step = drag.lastY < edge ? -14 : drag.lastY > window.innerHeight - edge - 60 ? 14 : 0;
    if (step) { window.scrollBy(0, step); dragMove(drag.lastX, drag.lastY); }
  }, 16);
});
document.addEventListener('pointermove', e => { if (drag) dragMove(e.clientX, e.clientY); });
document.addEventListener('pointerup', () => dragEnd(true));
document.addEventListener('pointercancel', () => dragEnd(false));

export const actions = {
  'home-edit': () => { update({ homeEdit: true }); window.scrollTo(0, 0); },
  'home-edit-done': () => update({ homeEdit: false }),
  'home-move': el => move(el.dataset.id, Number(el.dataset.to)),
  'home-hide': el => {
    const { order, hidden } = layout();
    hidden.add(el.dataset.id);
    saveLayout(order, hidden);
  },
  'home-show': el => {
    const { order, hidden } = layout();
    hidden.delete(el.dataset.id);
    order.splice(order.indexOf(el.dataset.id), 1); // comes back at the end, where it's easy to spot
    order.push(el.dataset.id);
    saveLayout(order, hidden);
  },
  'home-reset': () => {
    if (!confirm('Put every card back in the original order?')) return;
    saveLayout(CARDS.map(c => c[0]), new Set());
    toast('Home is back to the original layout.', 'success');
  },
  'install-hint-hide': () => {
    try { localStorage.setItem('familyHub.installHint', 'no'); } catch { /* private mode */ }
    update();
  },
};

export function view() {
  return `${installHint()}<section class="hero">
      <div class="hero-text">
        <h2>${greeting()}, ${esc(state.family.name)}!</h2>
        <p>${todayLong()} • <span id="clock-time">${timeNow()}</span></p>
      </div>
      ${heroWeather()}
    </section>
    ${state.tv || state.homeEdit ? '' : '<div class="home-tools"><button class="link" data-action="home-edit">✏️ Customize Home</button></div>'}
    ${grid()}`;
}
