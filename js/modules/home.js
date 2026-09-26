// The Home dashboard: what's happening, what needs doing, what's coming up.
import { state, update } from '../state.js';
import {
  esc, avatar, greeting, todayLong, timeNow, fmtDate, daysLabel, cardHead, soonCard, emptyMini,
} from '../utils.js';
import { upcomingCountdowns } from './countdowns.js';
import { dashboardTasks, taskRow } from './tasks.js';
import { groceryRow } from './grocery.js';
import { heroWeather, weatherCard } from './weather.js';
import { upcomingSpecialDays, specialRow } from './birthdays.js';
import { todayCard } from './calendar.js';
import { homeCard as rewardsCard } from './rewards.js';
import { homeCard as routinesCard } from './habits.js';

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
  return `<div class="card">${cardHead('⚡', 'Quick Add')}
    <div class="quick">
      <button data-action="task-new">＋ Task</button>
      <button data-action="grocery-new">＋ Grocery</button>
      <button data-action="countdown-new">＋ Countdown</button>
      <button data-action="chore-new">＋ Chore</button>
      <button data-action="event-new">＋ Event</button>
      <button disabled title="Arrives with meal planning in Alpha 0.7">＋ Meal</button>
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

export const actions = {
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
    <div class="grid">
      ${todayCard()}
      ${countdownsCard()}
      ${membersCard()}
      ${tasksCard()}
      ${soonCard('🍽️', 'Dinner Tonight', 'Alpha 0.7', 'Tonight\'s meal from the weekly plan, with a link to the recipe.')}
      ${groceryCard()}
      ${rewardsCard()}
      ${birthdaysCard()}
      ${routinesCard()}
      ${weatherCard()}
      ${quickAddCard()}
    </div>`;
}
