// Family Memories: moments worth keeping, each with a date, a story, the
// people in it, and a photo. Photos are shrunk on the device before upload
// (about 300 KB each), so Supabase's free 1 GB holds thousands of them.
import { sb } from '../supabase.js';
import { state, update } from '../state.js';
import {
  esc, avatar, openModal, closeModal, toast, fmtDate, parseDate, startOfToday, toISODate, cardHead, setupNotice,
} from '../utils.js';
import { run, refresh } from '../data.js';
import { everyone, memberById, newId } from './kids.js';

const BUCKET = 'family-photos';
const MAX_SIDE = 1600;

// ---------- Photos ----------

// Photos are private, so each one is shown through a link that expires.
// Links are fetched in batches and reused until shortly before they expire.
const urls = new Map();   // path → { url, until }
const pending = new Set();
let batchTimer = null;

function photoUrl(path) {
  if (!path) return null;
  const hit = urls.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  pending.add(path);
  clearTimeout(batchTimer);
  batchTimer = setTimeout(loadUrls, 0);
  return hit?.url || null;
}

async function loadUrls() {
  const paths = [...pending];
  pending.clear();
  if (!paths.length) return;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(paths, 3600);
  if (error) {
    console.error(error);
    for (const p of paths) urls.set(p, { url: null, until: Date.now() + 60 * 1000 });
    return;
  }
  const until = Date.now() + 50 * 60 * 1000;
  let got = false;
  for (const r of data || []) {
    if (r.signedUrl) { urls.set(r.path, { url: r.signedUrl, until }); got = true; }
  }
  // A missing photo shows a placeholder; try it again in a few minutes
  for (const p of paths) if (!urls.get(p)?.url) urls.set(p, { url: null, until: Date.now() + 5 * 60 * 1000 });
  if (got) update();
}

function photo(m, cls = '') {
  if (!m.photo_path) return '';
  const url = photoUrl(m.photo_path);
  return url ? `<img class="${cls}" src="${esc(url)}" alt="${esc(m.title)}" loading="lazy">`
    : `<div class="${cls} photo-wait" aria-hidden="true">📷</div>`;
}

// Shrinks a photo to at most 1600 px on the long side, as a JPEG.
async function shrink(file) {
  const src = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.82));
    if (!blob) throw new Error('Could not read that photo.');
    return blob;
  } finally {
    URL.revokeObjectURL(src);
  }
}

async function uploadPhoto(file) {
  let blob;
  try {
    blob = await shrink(file);
  } catch {
    throw new Error('That photo couldn\'t be opened. Try a JPEG or PNG (on iPhone, share it as "Most Compatible").');
  }
  const path = `${state.me.family_id}/${newId()}.jpg`;
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  return path;
}

async function removePhoto(path) {
  if (!path) return;
  const { error } = await sb.storage.from(BUCKET).remove([path]);
  if (error) console.error(error);
  urls.delete(path);
}

// ---------- Views ----------

const peopleOf = m => (m.people || []).map(memberById).filter(Boolean);

function card(m) {
  const who = peopleOf(m);
  return `<button class="memory-card ${m.photo_path ? '' : 'no-photo'}" data-action="memory-open" data-id="${esc(m.id)}">
    ${photo(m, 'memory-img')}
    <div class="memory-text">
      <b>${esc(m.title)}</b>
      <small>${fmtDate(parseDate(m.happened_on), { month: 'short', day: 'numeric', year: 'numeric' })}</small>
      ${!m.photo_path && m.story ? `<p>${esc(m.story.slice(0, 140))}${m.story.length > 140 ? '…' : ''}</p>` : ''}
      ${who.length ? `<span class="faces">${who.map(p => avatar(p)).join('')}</span>` : ''}
    </div>
  </button>`;
}

export function view() {
  const title = `<div class="page-title"><h2>📸 Family Memories</h2>
    <button class="btn primary" data-action="memory-new">＋ Add a memory</button></div>`;
  if (state.lifeMissing) return title + setupNotice('family memories');
  if (!state.memories.length) {
    return `${title}<div class="panel empty"><div class="empty-icon">📸</div>
      <h3>Keep the moments that matter</h3>
      <p>First steps, lost teeth, beach days, funny things the kids said. Add a photo and a few words, and they'll come back around "on this day" each year.</p>
      <button class="btn primary" data-action="memory-new">Add the first memory</button></div>`;
  }
  const people = everyone().filter(p => state.memories.some(m => (m.people || []).includes(p.id)));
  const shown = state.memories.filter(m => !state.memoryPerson || (m.people || []).includes(state.memoryPerson));
  const years = [...new Set(shown.map(m => m.happened_on.slice(0, 4)))];
  return `${title}
    ${people.length ? `<div class="fchips memory-filter">
      <button class="fchip ${state.memoryPerson ? '' : 'on'}" data-action="memory-person" data-id="">Everyone</button>
      ${people.map(p => `<button class="fchip ${state.memoryPerson === p.id ? 'on' : ''}" data-action="memory-person" data-id="${esc(p.id)}">${esc(p.display_name)}</button>`).join('')}
    </div>` : ''}
    ${years.map(y => `<h3 class="stage">${y} <span>${shown.filter(m => m.happened_on.startsWith(y)).length}</span></h3>
      <div class="memory-grid">${shown.filter(m => m.happened_on.startsWith(y)).map(card).join('')}</div>`).join('')
      || '<div class="panel empty"><p>No memories with this person yet.</p></div>'}`;
}

// Memories from this day in earlier years; otherwise one picked for today.
export function memoryOfTheDay() {
  if (!state.memories.length) return null;
  const t = startOfToday();
  const md = toISODate(t).slice(5);
  const year = String(t.getFullYear());
  const onThisDay = state.memories.filter(m => m.happened_on.slice(5) === md && !m.happened_on.startsWith(year));
  if (onThisDay.length) return { m: onThisDay[0], onThisDay: true };
  const withPhotos = state.memories.filter(m => m.photo_path);
  const pool = withPhotos.length ? withPhotos : state.memories;
  const dayNumber = Math.floor(t.getTime() / 86400e3);
  return { m: pool[dayNumber % pool.length], onThisDay: false };
}

export function homeCard() {
  const head = cardHead('📸', 'Family Memories', 'memories');
  if (state.lifeMissing) return '';
  const pick = memoryOfTheDay();
  if (!pick) {
    return `<div class="card">${head}<div class="empty-mini">Save a favorite moment with a photo. <button class="link" data-action="memory-new">Add a memory</button></div></div>`;
  }
  const { m, onThisDay } = pick;
  const yearsAgo = t => startOfToday().getFullYear() - parseDate(t).getFullYear();
  const label = onThisDay ? `On this day, ${yearsAgo(m.happened_on)} year${yearsAgo(m.happened_on) === 1 ? '' : 's'} ago`
    : fmtDate(parseDate(m.happened_on), { month: 'long', day: 'numeric', year: 'numeric' });
  return `<div class="card memory-home">${head}
    <button class="memory-home-btn" data-action="memory-open" data-id="${esc(m.id)}">
      ${photo(m, 'memory-home-img')}
      <span><b>${esc(m.title)}</b><small>${onThisDay ? '✨ ' : ''}${esc(label)}</small></span>
    </button></div>`;
}

function detail(m) {
  const who = peopleOf(m);
  const url = m.photo_path && photoUrl(m.photo_path);
  return `<div class="memory-detail">
    ${url ? `<img src="${esc(url)}" alt="${esc(m.title)}">` : ''}
    <h2>${esc(m.title)}</h2>
    <p class="muted">${fmtDate(parseDate(m.happened_on), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
      ${who.length ? ` • ${who.map(p => esc(p.display_name)).join(', ')}` : ''}</p>
    ${m.story ? `<p class="story">${esc(m.story).replace(/\n/g, '<br>')}</p>` : ''}
    <div class="modal-actions">
      <button class="btn danger-text" data-action="memory-delete" data-id="${esc(m.id)}">Delete</button>
      ${url ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener" download>⬇️ Photo</a>` : ''}
      <button class="btn" data-action="memory-edit" data-id="${esc(m.id)}">✏️ Edit</button>
      <button class="btn" data-action="close-modal">Close</button>
    </div></div>`;
}

function form(m = {}) {
  const isNew = !m.id;
  const chosen = new Set(m.people || []);
  return `<h2>${isNew ? 'Add a memory' : 'Edit memory'}</h2>
    <form data-form="memory-save">
      <input type="hidden" name="id" value="${esc(m.id || '')}">
      <div class="field"><label for="mm-photo">${m.photo_path ? 'Replace the photo (optional)' : 'Photo (optional)'}</label>
        <input id="mm-photo" name="photo" type="file" accept="image/*" data-toggle="memory-photo">
        <div id="mm-preview" class="photo-preview">${m.photo_path ? photo(m) : ''}</div>
        ${m.photo_path ? '<label class="check opt"><input type="checkbox" name="remove_photo" value="1"> <span>Remove the photo</span></label>' : ''}</div>
      <div class="field"><label for="mm-title">What happened</label>
        <input id="mm-title" name="title" required maxlength="100" value="${esc(m.title || '')}" placeholder="e.g., Leo's first bike ride"></div>
      <div class="field"><label for="mm-date">When</label>
        <input id="mm-date" type="date" name="happened_on" required value="${esc(m.happened_on || toISODate(startOfToday()))}"></div>
      <div class="field"><label>Who was there</label>
        <div class="people-pick">${everyone().map(p => `<label class="check"><input type="checkbox" name="p_${esc(p.id)}" value="1" ${chosen.has(p.id) ? 'checked' : ''}>
          <span>${avatar(p)} ${esc(p.display_name)}</span></label>`).join('')}</div></div>
      <div class="field"><label for="mm-story">The story (optional)</label>
        <textarea id="mm-story" name="story" rows="4" maxlength="5000" placeholder="What made it special? Anything funny someone said?">${esc(m.story || '')}</textarea></div>
      <div class="modal-actions">
        <button type="button" class="btn" data-action="close-modal">Cancel</button>
        <button type="submit" class="btn primary">${isNew ? 'Save memory' : 'Save changes'}</button>
      </div>
    </form>`;
}

const memoryById = id => state.memories.find(m => m.id === id);

export const actions = {
  'memory-new': () => {
    if (state.lifeMissing) { toast('Run the Alpha 0.8 database update first. See the README.', 'error'); return; }
    openModal(form());
  },
  'memory-open': el => {
    const m = memoryById(el.dataset.id);
    if (!m) return;
    openModal(detail(m));
    // The photo link may still be on its way
    if (m.photo_path && !photoUrl(m.photo_path)) setTimeout(() => { if (memoryById(m.id)) openModal(detail(m)); }, 800);
  },
  'memory-edit': el => openModal(form(memoryById(el.dataset.id))),
  'memory-person': el => update({ memoryPerson: el.dataset.id || '' }),
  'memory-delete': async el => {
    const m = memoryById(el.dataset.id);
    if (!m || !confirm(`Delete "${m.title}"${m.photo_path ? ' and its photo' : ''}? This can't be undone.`)) return;
    if (await run(sb.from('memories').delete().eq('id', m.id), 'Memory deleted')) {
      await removePhoto(m.photo_path);
      closeModal();
      refresh('memories');
    }
  },
};

export const toggles = {
  // Show the chosen photo before saving
  'memory-photo': el => {
    const box = document.getElementById('mm-preview');
    const file = el.files?.[0];
    if (!box || !file) return;
    const src = URL.createObjectURL(file);
    box.innerHTML = `<img src="${src}" alt="Chosen photo">`;
  },
};

export const forms = {
  'memory-save': async (d, f) => {
    const title = d.title.trim();
    if (!title) return;
    const old = d.id && memoryById(d.id);
    const file = f.querySelector('input[type=file]')?.files?.[0];
    let path = old?.photo_path || null;
    if (file) {
      toast('Uploading the photo…');
      try {
        path = await uploadPhoto(file);
      } catch (e) {
        console.error(e);
        toast(e.message || 'The photo didn\'t upload.', 'error');
        return;
      }
    } else if (d.remove_photo) {
      path = null;
    }
    const row = {
      title,
      happened_on: d.happened_on || toISODate(startOfToday()),
      story: (d.story || '').trim() || null,
      people: everyone().filter(p => d[`p_${p.id}`]).map(p => p.id),
      photo_path: path,
    };
    const query = d.id
      ? sb.from('memories').update(row).eq('id', d.id)
      : sb.from('memories').insert({ ...row, family_id: state.me.family_id });
    if (await run(query, d.id ? 'Memory saved' : 'Memory saved 💛')) {
      if (old?.photo_path && old.photo_path !== path) await removePhoto(old.photo_path);
      closeModal();
      refresh('memories');
    } else if (file && path) {
      await removePhoto(path); // don't leave an orphan photo behind
    }
  },
};
