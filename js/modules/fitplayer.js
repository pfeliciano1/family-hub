// Fitness workout player: steps through a routine one exercise at a time
// with moving pictures, countdowns and rest timers, then opens the log
// already filled in. It draws into its own layer, so live updates that
// redraw the page don't interrupt a workout.
import { esc, toast } from '../utils.js';
import { state } from '../state.js';
import { stepDose, fmtSeconds, fmtMinutes } from './fitcalc.js';
import { routineById, stepsOf, stepName } from './fitroutines.js';
import { openLog } from './fitness.js';

let p = null;          // the workout in progress
let tickTimer = null;  // updates the clock and countdowns
let frameTimer = null; // switches between the two exercise pictures
let wakeLock = null;
let audio = null;

const exById = id => state.fitExercises.find(e => e.id === id);
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function soundOn() {
  try { return localStorage.getItem('familyHub.fitSound') !== '0'; } catch { return true; }
}

// ---------- The list of things to do ----------

// Every set of every step, round after round, with a rest after each
// one that has a rest time (but not after the very last).
function buildQueue(routine) {
  const steps = stepsOf(routine.id);
  const rounds = Math.max(1, Number(routine.rounds) || 1);
  const q = [];
  for (let round = 1; round <= rounds; round++) {
    for (const st of steps) {
      const sets = Math.max(1, Number(st.sets) || 1);
      for (let set = 1; set <= sets; set++) {
        q.push({ kind: 'work', step: st, round, set, sets, seconds: Number(st.duration_sec) || 0 });
        if (Number(st.rest_sec) > 0) q.push({ kind: 'rest', seconds: Number(st.rest_sec) });
      }
    }
  }
  while (q.length && q.at(-1).kind === 'rest') q.pop();
  return q;
}

// ---------- Timekeeping ----------

const now = () => Date.now();

// Time spent working out so far, not counting pauses
function elapsedMs() {
  if (!p) return 0;
  return (p.pausedAt || now()) - p.startedAt - p.pausedTotal;
}

// Seconds left on the current countdown, or null for a reps step
function secondsLeft() {
  const it = p.queue[p.i];
  if (!it?.seconds) return null;
  const ms = p.endsAt - (p.pausedAt || now());
  return Math.max(0, Math.ceil(ms / 1000));
}

function startItem() {
  const it = p.queue[p.i];
  p.endsAt = it?.seconds ? now() + it.seconds * 1000 : null;
  p.lastBeep = null;
}

// ---------- Sound and buzz ----------

function beep(freq = 880, ms = 120) {
  if (!soundOn() || !audio) return;
  try {
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.25, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + ms / 1000);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + ms / 1000);
  } catch { /* no sound on this device */ }
}

function buzz(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}

// ---------- Keeping the screen on ----------

async function keepAwake() {
  if (!p || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try { wakeLock = await navigator.wakeLock.request('screen'); } catch { /* not supported */ }
}

function letSleep() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

// Phones drop the screen lock when the app goes to the background
document.addEventListener('visibilitychange', () => {
  if (p && document.visibilityState === 'visible') keepAwake();
});

// ---------- Drawing ----------

function picture(st, routine) {
  const ex = st.exercise_id && exById(st.exercise_id);
  if (ex?.image_urls?.length) {
    return `<img class="fp-img" id="fp-img" src="${esc(ex.image_urls[0])}" alt="${esc(ex.name)}"
      data-frames="${esc(JSON.stringify(ex.image_urls))}">`;
  }
  return `<div class="fp-img icon" aria-hidden="true">${routine.category === 'run' ? '🏃' : '🤸'}</div>`;
}

const nextWork = from => p.queue.slice(from).find(it => it.kind === 'work');

function workView(it) {
  const st = it.step;
  const ex = st.exercise_id && exById(st.exercise_id);
  const dose = it.seconds ? fmtSeconds(it.seconds) : st.reps ? `${st.reps} reps` : '';
  const left = secondsLeft();
  return `${picture(st, p.routine)}
    <div class="fp-info">
      <h2 class="fp-name">${esc(stepName(st))}</h2>
      <p class="fp-dose">${esc(dose)}${it.sets > 1 ? ` <small>• set ${it.set} of ${it.sets}</small>` : ''}</p>
      ${left !== null ? `<div class="fp-clock" id="fp-clock" aria-live="off">${fmtClock(left)}</div>
        <div class="fp-bar"><i id="fp-bar" style="width:${pct(left, it.seconds)}%"></i></div>` : ''}
      ${ex?.instructions ? `<details class="fp-how"><summary>How to do it</summary><p>${esc(ex.instructions).replace(/\n/g, '<br>')}</p></details>` : ''}
    </div>`;
}

function restView(it) {
  const nx = nextWork(p.i + 1);
  const left = secondsLeft();
  return `<div class="fp-rest">
      <p class="fp-rest-label">Rest</p>
      <div class="fp-clock big" id="fp-clock">${fmtClock(left)}</div>
      <div class="fp-bar"><i id="fp-bar" style="width:${pct(left, it.seconds)}%"></i></div>
      <div class="fp-rest-actions">
        <button class="btn" data-action="fp-more-rest">＋15 s</button>
        <button class="btn primary" data-action="fp-next">Skip rest</button>
      </div>
      ${nx ? `<div class="fp-upnext"><small class="muted">Up next</small>
        <div class="fp-upnext-row">${upNextThumb(nx.step)}<span><b>${esc(stepName(nx.step))}</b>
          <small class="muted">${esc(stepDose(nx.step))}</small></span></div></div>` : ''}
    </div>`;
}

function upNextThumb(st) {
  const ex = st.exercise_id && exById(st.exercise_id);
  return ex?.image_urls?.length ? `<img class="fit-thumb" src="${esc(ex.image_urls[0])}" alt="">`
    : `<span class="fit-thumb icon" aria-hidden="true">${p.routine.category === 'run' ? '🏃' : '🤸'}</span>`;
}

function doneView() {
  const min = Math.max(1, Math.round(elapsedMs() / 6000) / 10);
  return `<div class="fp-done">
      <div class="fp-done-icon">🎉</div>
      <h2>Workout done!</h2>
      <p>${esc(p.routine.name)} • ${fmtMinutes(min)}</p>
      <button class="btn primary big" data-action="fp-log">✅ Log it</button>
      <button class="btn" data-action="fp-close">Close without logging</button>
    </div>`;
}

const pct = (left, total) => total ? Math.max(0, Math.min(100, (left / total) * 100)) : 0;
const fmtClock = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function render() {
  const root = document.getElementById('fit-player');
  if (!root || !p) return;
  const it = p.queue[p.i];
  const works = p.queue.filter(x => x.kind === 'work').length;
  const done = p.queue.slice(0, p.i).filter(x => x.kind === 'work').length + (it?.kind === 'work' ? 1 : 0);
  const rounds = Number(p.routine.rounds) || 1;
  const finished = p.i >= p.queue.length;
  const isReps = it?.kind === 'work' && !it.seconds;
  // During a rest, show the round of the exercise just done
  const cur = it?.kind === 'work' ? it : p.queue.slice(0, p.i).reverse().find(x => x.kind === 'work');

  root.innerHTML = `<div class="fp-top">
      <button class="icon-btn" data-action="fp-quit" aria-label="Stop workout">✕</button>
      <div class="fp-title"><b>${esc(p.routine.name)}</b>
        <small>${finished ? 'Finished' : `${cur && rounds > 1 ? `Round ${cur.round} of ${rounds} • ` : ''}Exercise ${done} of ${works}`}</small></div>
      <span class="fp-elapsed" id="fp-elapsed">${fmtClock(Math.floor(elapsedMs() / 1000))}</span>
      <button class="icon-btn" data-action="fp-sound" aria-label="${soundOn() ? 'Turn sound off' : 'Turn sound on'}">${soundOn() ? '🔊' : '🔇'}</button>
    </div>
    <div class="fp-progress"><i style="width:${finished ? 100 : (done - (it?.kind === 'work' ? 1 : 0)) / works * 100}%"></i></div>
    <div class="fp-body ${it?.kind === 'rest' ? 'resting' : ''}">${finished ? doneView() : it.kind === 'rest' ? restView(it) : workView(it)}</div>
    ${finished ? '' : `<div class="fp-controls">
      <button class="btn" data-action="fp-prev" ${p.i === 0 ? 'disabled' : ''} aria-label="Previous">⏮</button>
      <button class="btn" data-action="fp-pause">${p.pausedAt ? '▶ Resume' : '⏸ Pause'}</button>
      <button class="btn ${isReps ? 'primary' : ''}" data-action="fp-next">${isReps ? 'Done ✓' : 'Next ⏭'}</button>
    </div>
    <button class="fp-finish" data-action="fp-finish">Finish early and log</button>`}
    ${p.pausedAt && !finished ? '<div class="fp-paused">Paused</div>' : ''}`;
  startFrames();
}

// Switch between the two pictures to show the movement
function startFrames() {
  clearInterval(frameTimer);
  const img = document.getElementById('fp-img');
  if (!img || reducedMotion()) return;
  let frames;
  try { frames = JSON.parse(img.dataset.frames || '[]'); } catch { frames = []; }
  if (frames.length < 2) return;
  let n = 0;
  frameTimer = setInterval(() => {
    if (p?.pausedAt) return;
    n = (n + 1) % frames.length;
    img.src = frames[n];
  }, 800);
}

// Only the numbers change each tick, so the pictures don't flicker
function tick() {
  if (!p) return;
  const el = document.getElementById('fp-elapsed');
  if (el) el.textContent = fmtClock(Math.floor(elapsedMs() / 1000));
  const it = p.queue[p.i];
  if (!it?.seconds || p.pausedAt) return;
  const left = secondsLeft();
  const clock = document.getElementById('fp-clock');
  if (clock) clock.textContent = fmtClock(left);
  const bar = document.getElementById('fp-bar');
  if (bar) bar.style.width = `${pct(left, it.seconds)}%`;
  if (left <= 3 && left > 0 && p.lastBeep !== left) {
    p.lastBeep = left;
    beep(660, 100);
  }
  if (left === 0) {
    beep(it.kind === 'rest' ? 1040 : 880, 300);
    buzz(it.kind === 'rest' ? [120, 80, 120] : 300);
    advance(1);
  }
}

function advance(dir) {
  p.i = Math.max(0, Math.min(p.queue.length, p.i + dir));
  if (p.i >= p.queue.length) finish();
  else {
    startItem();
    render();
  }
}

function finish() {
  if (!p.pausedAt) p.pausedAt = now(); // stop the clock
  p.i = p.queue.length;
  letSleep();
  render();
}

function close() {
  clearInterval(tickTimer);
  clearInterval(frameTimer);
  tickTimer = frameTimer = null;
  letSleep();
  document.getElementById('fit-player')?.remove();
  document.body.classList.remove('fit-playing');
  document.removeEventListener('keydown', onKey);
  p = null;
}

function onKey(e) {
  if (!p) return;
  if (e.key === ' ' && e.target === document.body) { e.preventDefault(); actions['fp-pause'](); }
  if (e.key === 'ArrowRight') actions['fp-next']();
  if (e.key === 'ArrowLeft') actions['fp-prev']();
}

// ---------- Starting ----------

export function startWorkout(routine) {
  const queue = buildQueue(routine);
  if (!queue.length) { toast('This routine has no steps yet.', 'error'); return; }
  if (p) close();
  // Sound can only start from a tap, so set it up now
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume?.(); } catch { audio = null; }
  p = { routine, queue, i: 0, startedAt: now(), startedDate: new Date(), pausedAt: null, pausedTotal: 0, endsAt: null, lastBeep: null };
  startItem();
  const root = document.createElement('div');
  root.id = 'fit-player';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', `Workout: ${routine.name}`);
  document.body.appendChild(root);
  document.body.classList.add('fit-playing');
  document.addEventListener('keydown', onKey);
  render();
  tickTimer = setInterval(tick, 250);
  keepAwake();
}

// ---------- Buttons ----------

export const actions = {
  'fit-routine-start': el => {
    const r = routineById(el.dataset.id);
    if (!r) return;
    document.getElementById('modal-root').innerHTML = '';
    startWorkout(r);
  },
  'fp-next': () => p && p.i < p.queue.length && advance(1),
  'fp-prev': () => {
    if (!p || p.i === 0) return;
    // Back to the start of this exercise if it's under way, otherwise the one before
    const it = p.queue[p.i];
    const started = it?.seconds && secondsLeft() < it.seconds - 2;
    if (started) { startItem(); render(); }
    else {
      let j = p.i - 1;
      while (j > 0 && p.queue[j].kind === 'rest') j--;
      p.i = j;
      startItem();
      render();
    }
  },
  'fp-pause': () => {
    if (!p || p.i >= p.queue.length) return;
    if (p.pausedAt) {
      const gap = now() - p.pausedAt;
      p.pausedTotal += gap;
      if (p.endsAt) p.endsAt += gap;
      p.pausedAt = null;
      keepAwake();
    } else {
      p.pausedAt = now();
    }
    render();
  },
  'fp-more-rest': () => {
    if (!p || !p.endsAt) return;
    p.endsAt += 15000;
    p.queue[p.i] = { ...p.queue[p.i], seconds: p.queue[p.i].seconds + 15 };
    render();
  },
  'fp-sound': () => {
    try { localStorage.setItem('familyHub.fitSound', soundOn() ? '0' : '1'); } catch { /* private mode */ }
    render();
  },
  'fp-finish': () => p && finish(),
  'fp-quit': () => {
    if (!p) return;
    const started = elapsedMs() > 30000 && p.i < p.queue.length;
    if (started && !confirm('Stop this workout? It won\'t be logged.')) return;
    close();
  },
  'fp-close': () => close(),
  'fp-log': () => {
    if (!p) return;
    const minutes = Math.max(1, Math.round(elapsedMs() / 6000) / 10);
    const routine = p.routine, when = p.startedDate;
    close();
    openLog({ routine, minutes, when });
  },
};
