// Fitness dashboard: your totals, streaks, charts and a heatmap of workout
// days. Personal like the rest of Fitness, so only on your own login.
// Charts use Chart.js, loaded the first time the dashboard opens.
import { state, update } from '../state.js';
import { esc, startOfToday, toISODate, fmtDate } from '../utils.js';
import { addDays } from './calendar.js';
import { CATEGORY_IDS, catLabel, catIcon, fmtMinutes } from './fitcalc.js';
import { routineById } from './fitroutines.js';

const CHART_JS = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js';
const CHART_SRI = 'sha384-dug+JxfBvklEQdJ4AYuBBAIScUz0bVN73xpy273gcAwHjb3qI0fXmuYNaNfdyYJG';

const RANGES = [['week', 'This week'], ['month', 'This month'], ['90', 'Last 90 days'], ['all', 'All time']];
const WEEKS = 12;          // weeks in the bar charts
const HEAT_WEEKS = 26;     // weeks in the heatmap

// ---------- Dates ----------

const dayKey = d => toISODate(d);
const mondayOf = d => addDays(d, -((d.getDay() + 6) % 7));

function rangeStart(range, today = startOfToday()) {
  if (range === 'week') return mondayOf(today);
  if (range === 'month') return new Date(today.getFullYear(), today.getMonth(), 1);
  if (range === '90') return addDays(today, -89);
  return null;
}

// ---------- Numbers ----------

// Current streak: days in a row with a workout, counting back from today,
// or from yesterday if nothing is logged yet today (so it isn't "broken"
// in the middle of the day). Longest: the best run ever.
export function streaks(logs, today = startOfToday()) {
  const days = new Set(logs.map(l => dayKey(new Date(l.performed_at))));
  let current = 0;
  let d = days.has(dayKey(today)) ? today : addDays(today, -1);
  while (days.has(dayKey(d))) { current++; d = addDays(d, -1); }
  const sorted = [...days].sort();
  let longest = 0, run = 0, prev = null;
  for (const k of sorted) {
    const [y, m, dd] = k.split('-').map(Number);
    const date = new Date(y, m - 1, dd);
    run = prev && dayKey(addDays(prev, 1)) === k ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = date;
  }
  return { current, longest };
}

export function totals(logs) {
  return logs.reduce((t, l) => ({
    workouts: t.workouts + 1,
    minutes: t.minutes + Number(l.duration_min || 0),
    calories: t.calories + Number(l.calories_est || 0),
    miles: t.miles + Number(l.distance_mi || 0),
  }), { workouts: 0, minutes: 0, calories: 0, miles: 0 });
}

// Minutes and miles for each of the last 12 weeks (Monday to Sunday)
export function weekly(logs, today = startOfToday()) {
  const first = addDays(mondayOf(today), -7 * (WEEKS - 1));
  const weeks = Array.from({ length: WEEKS }, (_, i) => ({ start: addDays(first, 7 * i), minutes: 0, miles: 0 }));
  for (const l of logs) {
    const d = new Date(l.performed_at);
    const i = Math.round((mondayOf(new Date(d.getFullYear(), d.getMonth(), d.getDate())) - first) / (7 * 86400e3));
    if (i >= 0 && i < WEEKS) {
      weeks[i].minutes += Number(l.duration_min || 0);
      weeks[i].miles += Number(l.distance_mi || 0);
    }
  }
  return weeks;
}

const inRange = (logs, range) => {
  const from = rangeStart(range);
  return from ? logs.filter(l => new Date(l.performed_at) >= from) : logs;
};

const round1 = n => Math.round(n * 10) / 10;
const fmtNum = n => Math.round(n).toLocaleString();

// ---------- Page ----------

export function dashboardView() {
  const logs = state.fitLogs;
  if (!logs.length) {
    return `<div class="panel empty"><div class="empty-icon">📊</div>
      <h3>Your dashboard fills in as you work out</h3>
      <p>Log your first workout, or start a routine, and your totals, streak and charts will show here.</p>
      <button class="btn primary" data-action="fit-log-new">Log a workout</button></div>`;
  }
  const range = RANGES.some(r => r[0] === state.fitRange) ? state.fitRange : 'week';
  const shown = inRange(logs, range);
  const t = totals(shown);
  const s = streaks(logs);
  const label = RANGES.find(r => r[0] === range)[1].toLowerCase();
  scheduleCharts();
  return `<div class="fchips fit-ranges">${RANGES.map(([id, name]) =>
      `<button class="fchip ${id === range ? 'on' : ''}" data-action="fit-range" data-range="${id}">${name}</button>`).join('')}</div>
    <div class="fit-kpis">
      ${kpi('Workouts', fmtNum(t.workouts), label)}
      ${kpi('Minutes', fmtNum(t.minutes), label)}
      ${kpi('Calories', fmtNum(t.calories), 'est.')}
      ${kpi('Miles run', round1(t.miles).toLocaleString(), label)}
      ${kpi('Current streak', `${s.current}`, s.current === 1 ? 'day' : 'days', 'fit-streak')}
      ${kpi('Longest streak', `${s.longest}`, s.longest === 1 ? 'day' : 'days')}
    </div>
    <div class="fit-charts">
      <section class="panel fit-chart wide"><h3>Minutes per week</h3><p class="muted small">Last ${WEEKS} weeks</p>
        <div class="fit-canvas"><canvas id="fit-chart-minutes" role="img" aria-label="Bar chart of workout minutes per week for the last ${WEEKS} weeks"></canvas></div></section>
      <section class="panel fit-chart"><h3>Workout mix</h3><p class="muted small">Minutes by type, ${esc(label)}</p>
        ${shown.length ? `<div class="fit-canvas round"><canvas id="fit-chart-mix" role="img" aria-label="Doughnut chart of minutes by workout type"></canvas></div>
        ${mixLegend(shown)}` : '<p class="muted">No workouts in this period.</p>'}</section>
      <section class="panel fit-chart"><h3>Miles per week</h3><p class="muted small">Last ${WEEKS} weeks</p>
        <div class="fit-canvas"><canvas id="fit-chart-miles" role="img" aria-label="Bar chart of miles run per week for the last ${WEEKS} weeks"></canvas></div></section>
      <section class="panel fit-chart wide"><h3>Workout days</h3><p class="muted small">Last ${HEAT_WEEKS} weeks</p>${heatmap(logs)}</section>
    </div>
    <h3 class="section-label">Recent workouts</h3>
    <div class="panel">${logs.slice(0, 5).map(recentRow).join('')}
      <button class="btn sm fit-see-all" data-action="fit-tab" data-tab="log">See all in Log & history</button></div>`;
}

function kpi(name, value, sub, cls = '') {
  return `<div class="fit-kpi ${cls}"><small>${esc(name)}</small><b>${esc(value)}</b><span>${esc(sub)}</span></div>`;
}

function recentRow(l) {
  const r = l.routine_id && routineById(l.routine_id);
  const d = new Date(l.performed_at);
  const bits = [fmtMinutes(l.duration_min)];
  if (l.distance_mi) bits.push(`${round1(Number(l.distance_mi))} mi`);
  if (l.calories_est) bits.push(`≈ ${Math.round(l.calories_est)} cal est.`);
  return `<div class="fit-log">
    <span class="cd-icon">${catIcon(l.category)}</span>
    <div class="cd-main"><b>${esc(r ? r.name : catLabel(l.category))}</b>
      <small>${esc(fmtDate(d, { weekday: 'short', month: 'short', day: 'numeric' }))} • ${esc(bits.join(' • '))}</small></div>
  </div>`;
}

// ---------- Colors (from the theme) ----------

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function catColor(c) {
  return {
    run: cssVar('--blue', '#1E3A5F'),
    cardio: cssVar('--red', '#8C2F2F'),
    abs: cssVar('--brass', '#B8893B'),
    strength: cssVar('--green', '#1F4D3A'),
    mobility: '#5E8C84',
  }[c] || '#888';
}

function mixData(logs) {
  const by = Object.fromEntries(CATEGORY_IDS.map(c => [c, 0]));
  for (const l of logs) by[l.category] = (by[l.category] || 0) + Number(l.duration_min || 0);
  return CATEGORY_IDS.filter(c => by[c] > 0).map(c => ({ c, minutes: by[c] }));
}

function mixLegend(logs) {
  const data = mixData(logs);
  const total = data.reduce((n, x) => n + x.minutes, 0) || 1;
  return `<ul class="fit-mix-legend">${data.map(x => `<li><i class="dot" style="background:${catColor(x.c)}"></i>
    ${catIcon(x.c)} ${esc(catLabel(x.c))} <b>${Math.round(x.minutes / total * 100)}%</b> <small class="muted">${esc(fmtMinutes(x.minutes))}</small></li>`).join('')}</ul>`;
}

// ---------- Heatmap (plain HTML, no library) ----------

function heatmap(logs, today = startOfToday()) {
  const mins = new Map();
  for (const l of logs) {
    const k = dayKey(new Date(l.performed_at));
    mins.set(k, (mins.get(k) || 0) + Number(l.duration_min || 0));
  }
  const first = addDays(mondayOf(today), -7 * (HEAT_WEEKS - 1));
  const level = m => (!m ? 0 : m < 20 ? 1 : m < 40 ? 2 : 3);
  let cols = '';
  let months = '';
  let lastMonth = -1;
  for (let w = 0; w < HEAT_WEEKS; w++) {
    const monday = addDays(first, 7 * w);
    const month = monday.getMonth();
    months += `<span>${month !== lastMonth ? esc(fmtDate(monday, { month: 'short' })) : ''}</span>`;
    lastMonth = month;
    let cells = '';
    for (let d = 0; d < 7; d++) {
      const day = addDays(monday, d);
      if (day > today) { cells += '<i class="future"></i>'; continue; }
      const m = mins.get(dayKey(day)) || 0;
      const tip = `${fmtDate(day, { weekday: 'short', month: 'short', day: 'numeric' })}: ${m ? fmtMinutes(m) : 'no workout'}`;
      cells += `<i class="l${level(m)}" title="${esc(tip)}"></i>`;
    }
    cols += `<div class="fh-col">${cells}</div>`;
  }
  return `<div class="fit-heat-wrap"><div class="fit-heat" style="--weeks:${HEAT_WEEKS}">
      <div class="fh-months">${months}</div>
      <div class="fh-days"><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span><span>Sun</span></div>
      <div class="fh-grid">${cols}</div>
    </div></div>
    <div class="fh-key muted small">Less <i class="l0"></i><i class="l1"></i><i class="l2"></i><i class="l3"></i> More <span>(under 20, 20–39, 40+ minutes)</span></div>`;
}

// ---------- Charts ----------

let charts = [];
let loading = null;

function loadChartJs() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = CHART_JS;
      s.integrity = CHART_SRI;
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve(window.Chart);
      s.onerror = () => { loading = null; reject(new Error('Chart.js did not load')); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

// The page is redrawn as HTML, so charts are drawn again after each redraw
function scheduleCharts() {
  requestAnimationFrame(() => {
    // Phones show the most recent weeks of the heatmap first
    const heat = document.querySelector('.fit-heat-wrap');
    if (heat) heat.scrollLeft = heat.scrollWidth;
    if (!document.getElementById('fit-chart-minutes')) return;
    loadChartJs().then(drawCharts).catch(() => {
      for (const c of document.querySelectorAll('.fit-canvas')) {
        c.innerHTML = '<p class="muted small">Charts couldn\'t load. Check your internet connection and reopen this tab.</p>';
      }
    });
  });
}

function drawCharts(Chart) {
  charts.forEach(c => c.destroy());
  charts = [];
  const minutesEl = document.getElementById('fit-chart-minutes');
  if (!minutesEl) return;
  const font = { family: getComputedStyle(document.body).fontFamily, size: 12 };
  Chart.defaults.font = { ...Chart.defaults.font, ...font };
  Chart.defaults.color = cssVar('--muted', '#6E6A60');
  const grid = cssVar('--line-soft', '#EFE7D6');
  const weeks = weekly(state.fitLogs);
  const labels = weeks.map(w => fmtDate(w.start, { month: 'short', day: 'numeric' }));
  const bars = (el, data, color, unit, digits = 0) => new Chart(el, {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: color, borderRadius: 4, maxBarThickness: 28 }] },
    options: {
      animation: false, responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: i => `Week of ${i[0].label}`, label: i => `${Number(i.raw).toFixed(digits)} ${unit}` } } },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 6 } },
        y: { beginAtZero: true, grid: { color: grid }, ticks: { precision: 0 } },
      },
    },
  });
  charts.push(bars(minutesEl, weeks.map(w => Math.round(w.minutes)), cssVar('--green', '#1F4D3A'), 'min'));
  const milesEl = document.getElementById('fit-chart-miles');
  if (milesEl) charts.push(bars(milesEl, weeks.map(w => round1(w.miles)), cssVar('--blue', '#1E3A5F'), 'mi', 1));
  const mixEl = document.getElementById('fit-chart-mix');
  if (mixEl) {
    const range = RANGES.some(r => r[0] === state.fitRange) ? state.fitRange : 'week';
    const data = mixData(inRange(state.fitLogs, range));
    charts.push(new Chart(mixEl, {
      type: 'doughnut',
      data: { labels: data.map(x => catLabel(x.c)), datasets: [{ data: data.map(x => Math.round(x.minutes)), backgroundColor: data.map(x => catColor(x.c)), borderColor: cssVar('--card', '#fff'), borderWidth: 2 }] },
      options: {
        animation: false, responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: i => `${i.label}: ${fmtMinutes(i.raw)}` } } },
      },
    }));
  }
}

// ---------- Buttons ----------

export const actions = {
  'fit-range': el => update({ fitRange: el.dataset.range }),
};
