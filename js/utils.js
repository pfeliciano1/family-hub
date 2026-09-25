// Small helpers shared by every module.

// Escape anything typed by a person before putting it on the page.
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function safeColor(c) {
  return /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#1976d2';
}

export function initials(name) {
  return String(name || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
}

export function avatar(member, size = '') {
  return `<span class="avatar ${size}" style="background:${safeColor(member.color)}" aria-hidden="true">${esc(initials(member.display_name))}</span>`;
}

// ---------- Dates (all local time, no time-zone surprises) ----------

export function parseDate(s) {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function startOfToday() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

export function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

// Next time a date comes around. Yearly dates (birthdays) roll forward.
export function nextOccurrence(s, yearly) {
  const d = parseDate(s);
  if (!d) return null;
  if (!yearly) return d;
  const today = startOfToday();
  let next = new Date(today.getFullYear(), d.getMonth(), d.getDate());
  if (next < today) next = new Date(today.getFullYear() + 1, d.getMonth(), d.getDate());
  return next;
}

export function fmtDate(d, opts = { month: 'short', day: 'numeric' }) {
  return d ? d.toLocaleDateString(undefined, opts) : '';
}

export function daysLabel(n) {
  if (n === 0) return 'Today!';
  if (n === 1) return 'Tomorrow';
  return `${n} days`;
}

export function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export const todayLong = () =>
  new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

export const timeNow = () =>
  new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// ---------- Building blocks for cards ----------

export function cardHead(icon, title, link, linkText = 'View all') {
  return `<h3><span>${icon} ${esc(title)}</span>${link ? `<a href="#/${link}">${linkText}</a>` : ''}</h3>`;
}

export function soonCard(icon, title, version, text) {
  return `<div class="card soon">${cardHead(icon, title)}
    <div class="soon-body"><p>${text}</p><span class="pill">Coming in ${version}</span></div></div>`;
}

export function emptyMini(text, action, label) {
  return `<div class="empty-mini">${text} <button class="link" data-action="${action}">${label}</button></div>`;
}

// ---------- Errors, toasts, modals ----------

export function friendlyError(error) {
  const msg = error?.message || String(error || 'Something went wrong');
  if (/does not exist|Could not find the (table|function)|schema cache/i.test(msg)) {
    return 'The database isn\'t set up yet. Run database/setup.sql in Supabase\'s SQL Editor.';
  }
  if (/Failed to fetch|NetworkError/i.test(msg)) {
    return 'Can\'t reach the server. Check your internet connection.';
  }
  return msg;
}

export function toast(message, type = 'info') {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.classList.add('hide'), type === 'error' ? 5000 : 2800);
  setTimeout(() => el.remove(), type === 'error' ? 5500 : 3300);
}

export function openModal(html) {
  document.getElementById('modal-root').innerHTML =
    `<div class="modal-backdrop" data-action="close-modal-backdrop">
       <div class="modal" role="dialog" aria-modal="true">${html}</div>
     </div>`;
  const first = document.querySelector('#modal-root input:not([type=hidden]), #modal-root select');
  if (first && window.matchMedia('(pointer: fine)').matches) first.focus();
}

export function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
}

export function modalIsOpen() {
  return document.getElementById('modal-root').children.length > 0;
}
