// The Home dashboard: what's happening, what needs doing, what's coming up.
import { state } from '../state.js';
import {
  esc, avatar, greeting, todayLong, timeNow, fmtDate, daysLabel, cardHead, soonCard, emptyMini,
} from '../utils.js';
import { upcomingCountdowns } from './countdowns.js';
import { dashboardTasks, taskRow } from './tasks.js';
import { groceryRow } from './grocery.js';
import { heroWeather, weatherCard } from './weather.js';
import { upcomingSpecialDays, specialRow } from './birthdays.js';

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
      <button data-action="member-new">＋ Family member</button>
      <button disabled title="Arrives with the calendar in Alpha 0.5">＋ Event</button>
      <button disabled title="Arrives with meal planning in Alpha 0.7">＋ Meal</button>
    </div></div>`;
}

export function view() {
  return `<section class="hero">
      <div class="hero-text">
        <h2>${greeting()}, ${esc(state.family.name)}!</h2>
        <p>${todayLong()} • <span id="clock-time">${timeNow()}</span></p>
      </div>
      ${heroWeather()}
    </section>
    <div class="grid">
      ${soonCard('📅', 'Today\'s Calendar', 'Alpha 0.5', 'Your Google calendars will show up here, combined into one family schedule.')}
      ${countdownsCard()}
      ${membersCard()}
      ${tasksCard()}
      ${soonCard('🍽️', 'Dinner Tonight', 'Alpha 0.7', 'Tonight\'s meal from the weekly plan, with a link to the recipe.')}
      ${groceryCard()}
      ${soonCard('⭐', 'Rewards', 'Alpha 0.6', 'Each child\'s points and the prize they\'re working toward.')}
      ${birthdaysCard()}
      ${soonCard('❤️', 'Routines & Habits', 'Alpha 0.6', 'Morning and night routines and healthy habits, with progress like 4/5 done.')}
      ${weatherCard()}
      ${quickAddCard()}
    </div>`;
}
