// The frame around every page: sidebar, mobile menu, TV mode.
import { state, update } from '../state.js';
import { esc, avatar, openModal, closeModal } from '../utils.js';
import { NAV, SETTINGS } from '../nav.js';
import * as home from './home.js';
import * as countdowns from './countdowns.js';
import * as tasks from './tasks.js';
import * as grocery from './grocery.js';
import * as settings from './settings.js';
import * as weather from './weather.js';
import * as birthdays from './birthdays.js';
import * as calendar from './calendar.js';
import * as rewards from './rewards.js';
import * as routines from './routines.js';
import * as habits from './habits.js';
import * as meals from './meals.js';
import * as recipes from './recipes.js';
import * as lists from './lists.js';
import * as gifts from './gifts.js';
import * as projects from './projects.js';
import * as memories from './memories.js';

// Sections that are built. Everything else in NAV shows a roadmap page.
const VIEWS = {
  home: home.view,
  countdowns: countdowns.view,
  tasks: tasks.view,
  grocery: grocery.view,
  settings: settings.view,
  weather: weather.view,
  birthdays: birthdays.view,
  calendar: calendar.view,
  rewards: rewards.view,
  routines: routines.view,
  habits: habits.view,
  meals: meals.view,
  recipes: recipes.view,
  lists: lists.view,
  gifts: gifts.view,
  projects: projects.view,
  memories: memories.view,
};

const MOBILE_TABS = ['home', 'calendar', 'tasks', 'grocery'];

function placeholder(n) {
  return `<div class="page-title"><h2>${n.icon} ${esc(n.label)}</h2></div>
    <div class="panel empty">
      <div class="empty-icon">${n.icon}</div>
      <h3>${esc(n.label)} is on the way</h3>
      <p>Planned for ${n.soon}. It will plug into the same shared family data, so everything you've already added stays put.</p>
      <a class="btn" href="#/home">Back to Home</a>
    </div>`;
}

function renderView() {
  const fn = VIEWS[state.view];
  if (fn) return fn();
  const n = NAV.find(x => x.id === state.view);
  return n ? placeholder(n) : home.view();
}

function navLink(n) {
  const active = state.view === n.id ? 'active' : '';
  return `<a href="#/${n.id}" class="${active} ${n.soon ? 'is-soon' : ''}" ${active ? 'aria-current="page"' : ''}>
    <span>${n.icon}</span>${esc(n.label)}${n.soon ? '<em>soon</em>' : ''}</a>`;
}

export function shellView() {
  return `<div class="app ${state.tv ? 'tv' : ''}">
    <aside class="sidebar">
      <div class="brand"><div class="logo">🏠</div>
        <div><h1>Family Hub</h1><p>${esc(state.family.name)}</p></div></div>
      <nav class="nav" aria-label="Sections">${NAV.map(navLink).join('')}</nav>
      <div class="divider"></div>
      <p class="members-title">Family members</p>
      ${state.members.map(m => `<div class="member">${avatar(m)}<div>${esc(m.display_name)}
        <small>${m.role === 'parent' ? 'Parent' : 'Child'}</small></div></div>`).join('')}
      <div class="divider"></div>
      <nav class="nav">${navLink(SETTINGS)}
        <button data-action="kid-mode-start"><span>🧒</span>Kid mode</button>
        <button data-action="tv-toggle"><span>📺</span>TV Display</button></nav>
    </aside>

    <main class="main">
      ${renderView()}
      <footer class="footer">
        <span>${state.live ? '<span class="live">● Live sync on</span>' : '<span class="offline">○ Connecting…</span>'}</span>
        <span>Family Hub • Alpha 0.8.3${state.tv ? ' • TV Display' : ''}</span>
      </footer>
    </main>

    ${state.tv ? '<button class="exit-tv" data-action="tv-toggle">✕ Exit TV Mode</button>' : ''}

    <nav class="mobile-menu" aria-label="Main">
      ${MOBILE_TABS.map(id => {
        const n = NAV.find(x => x.id === id);
        return `<a href="#/${id}" class="${state.view === id ? 'active' : ''}"><span>${n.icon}</span>${esc(n.short || n.label)}</a>`;
      }).join('')}
      <button data-action="more-menu"><span>☰</span>More</button>
    </nav>
  </div>`;
}

// ---------- TV mode ----------

let wakeLock = null;

// Keeps the laptop screen from going to sleep while the TV display is on.
export async function requestWakeLock() {
  if (!state.tv || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* not supported */ }
}

function toggleTV() {
  const tv = !state.tv;
  try { localStorage.setItem('familyHub.tv', tv ? '1' : '0'); } catch { /* private mode */ }
  if (tv) {
    if (location.hash !== '#/home') location.hash = '#/home';
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    wakeLock?.release().catch(() => {});
    wakeLock = null;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  update({ tv });
  requestWakeLock();
}

export const actions = {
  'tv-toggle': () => { closeModal(); toggleTV(); },
  'more-menu': () => openModal(`<h2>All sections</h2>
    <div class="more-grid">
      ${[...NAV, SETTINGS].map(n => `<a href="#/${n.id}" data-action="close-modal" class="${n.soon ? 'is-soon' : ''}">
        <span>${n.icon}</span>${esc(n.short || n.label)}</a>`).join('')}
      <button data-action="kid-mode-start"><span>🧒</span>Kid mode</button>
      <button data-action="tv-toggle"><span>📺</span>TV Display</button>
    </div>
    <div class="modal-actions"><button class="btn" data-action="close-modal">Close</button></div>`),
};
