// Birthdays (from family member profiles) and anniversaries/birthday countdowns.
import { state } from '../state.js';
import {
  esc, fmtDate, parseDate, nextOccurrence, daysBetween, startOfToday, daysLabel,
} from '../utils.js';
import { enrich } from './countdowns.js';

export function upcomingSpecialDays() {
  const today = startOfToday();
  const out = [];

  for (const m of state.members) {
    if (!m.birthday) continue;
    const next = nextOccurrence(m.birthday, true);
    const born = parseDate(m.birthday).getFullYear();
    out.push({
      icon: '🎂', title: `${m.display_name}'s birthday`, next,
      days: daysBetween(today, next),
      sub: born > 1900 ? `Turns ${next.getFullYear() - born}` : '',
    });
  }

  for (const c of state.countdowns) {
    if (!['birthday', 'anniversary'].includes(c.category)) continue;
    const e = enrich(c);
    if (e.days < 0) continue;
    const startYear = parseDate(c.event_date).getFullYear();
    const years = e.next.getFullYear() - startYear;
    out.push({
      icon: e.icon, title: c.title, next: e.next, days: e.days,
      sub: c.repeats_yearly && years > 0 ? (c.category === 'anniversary' ? `${years} years` : `Turns ${years}`) : '',
    });
  }
  return out.sort((a, b) => a.days - b.days);
}

export function specialRow(s) {
  return `<div class="special">
    <span>${s.icon} <b>${esc(s.title)}</b>
      <small>${fmtDate(s.next, { weekday: 'short', month: 'short', day: 'numeric' })}${s.sub ? ` • ${esc(s.sub)}` : ''}</small></span>
    <strong>${daysLabel(s.days)}</strong>
  </div>`;
}

export function view() {
  const list = upcomingSpecialDays();
  return `<div class="page-title"><h2>🎂 Birthdays & Anniversaries</h2>
      <button class="btn primary" data-action="countdown-new">＋ Add an anniversary</button></div>
    <div class="panel">${list.length ? list.map(specialRow).join('')
      : `<div class="empty"><div class="empty-icon">🎂</div>
          <p>Add birthdays to family member profiles in Settings, or add anniversaries and other people's birthdays as countdowns.</p>
          <a class="btn primary" href="#/settings">Open Settings</a></div>`}</div>
    <p class="muted small">Tip: family members' birthdays come from their profiles. For grandparents, friends, or your anniversary, add a countdown with the type set to Birthday or Anniversary and turn on "Repeats every year." Gift ideas arrive in Alpha 0.8.</p>`;
}
