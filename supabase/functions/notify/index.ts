// Family Hub — notify (Supabase Edge Function)
// ------------------------------------------------------------------
// Sends push notifications to the phones and computers where someone
// turned them on (Settings → Notifications):
//   • a morning summary: today's events, tasks, and dinner
//   • the day before a birthday or countdown
//   • new grocery or list items added by someone else
//
// A database schedule calls this function once a minute ({ action: "run" })
// with a secret only the database knows. The app calls it to get the
// public key ({ action: "key" }) and to send a test ({ action: "test" }).
//
// Free: push messages go through the phone makers' own push services
// (Apple, Google, Mozilla, Microsoft) using the open Web Push standard.
// The keys that sign them are created on first use and kept in the
// database, where signed-in people can't read them.
// ------------------------------------------------------------------

import ICAL from 'npm:ical.js@2.2.1';
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ================= Web Push (RFC 8291 encryption, RFC 8292 VAPID) =================

const te = new TextEncoder();

export function b64u(bytes: Uint8Array) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64u(s: string) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  const params = { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource };
  return new Uint8Array(await crypto.subtle.deriveBits(params, key, length * 8));
}

// Encrypts a message so only the browser that subscribed can read it.
export async function encryptPayload(p256dh: string, auth: string, payload: Uint8Array) {
  const uaPublic = unb64u(p256dh);
  const authSecret = unb64u(auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const localPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(te.encode('WebPush: info\0'), uaPublic, localPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(payload, new Uint8Array([2]))));
  const header = new Uint8Array(86); // salt | record size | key id length | key id
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = 65;
  header.set(localPublic, 21);
  return concat(header, body);
}

export async function makeVapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  return {
    public_key: b64u(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
    private_jwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
  };
}

// The signed note that tells the push service who is sending.
export async function vapidHeader(endpoint: string, publicKey: string, privateJwk: JsonWebKey, subject: string) {
  const key = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(te.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(`${head}.${claims}`)));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${publicKey}`;
}

export type Sub = { id: string; endpoint: string; p256dh: string; auth: string };
export type Note = { title: string; body: string; url?: string; tag?: string };

// Returns 'sent', 'gone' (the device unsubscribed; delete it), or 'failed'.
export async function sendPush(sub: Sub, note: Note, cfg: { public_key: string; private_jwk: JsonWebKey; subject: string }, ttl = 12 * 3600) {
  try {
    const body = await encryptPayload(sub.p256dh, sub.auth, te.encode(JSON.stringify(note)));
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidHeader(sub.endpoint, cfg.public_key, cfg.private_jwk, cfg.subject),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttl),
        Urgency: 'normal',
      },
      body,
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 404 || res.status === 410) return 'gone';
    if (!res.ok) {
      console.error('push failed', res.status, (await res.text()).slice(0, 200));
      return 'failed';
    }
    return 'sent';
  } catch (e) {
    console.error('push error', e);
    return 'failed';
  }
}

// ================= Calendar reading (same as the calendar-feed function) =================

const MAX_FEED_BYTES = 8 * 1024 * 1024;
const MAX_STEPS = 100000; // per repeating event, a safety stop for unusual rules

export type FeedEvent = {
  uid: string;
  title: string;
  location: string;
  allDay: boolean;
  start: string; // all-day: "YYYY-MM-DD"; timed: ISO time in UTC
  end: string;   // all-day: the day AFTER the last day; timed: ISO time in UTC
};

function pad(n: number) { return String(n).padStart(2, '0'); }

function dateOnly(t: any) {
  return `${t.year}-${pad(t.month)}-${pad(t.day)}`;
}

function toFeedEvent(uid: string, title: string, location: string, start: any, end: any): FeedEvent {
  const allDay = start.isDate;
  const stop = end || start;
  if (allDay) {
    let endDate = dateOnly(stop);
    if (endDate <= dateOnly(start)) {
      const next = start.clone();
      next.adjust(1, 0, 0, 0);
      endDate = dateOnly(next);
    }
    return { uid, title, location, allDay, start: dateOnly(start), end: endDate };
  }
  const s = start.toJSDate();
  let e = stop.toJSDate();
  if (e < s) e = s;
  return { uid, title, location, allDay, start: s.toISOString(), end: e.toISOString() };
}

// Overlap test that works for both all-day dates and timed events.
function overlaps(ev: FeedEvent, from: Date, to: Date) {
  const s = ev.allDay ? new Date(`${ev.start}T00:00:00Z`).getTime() - 14 * 3600e3 : Date.parse(ev.start);
  const e = ev.allDay ? new Date(`${ev.end}T00:00:00Z`).getTime() + 14 * 3600e3 : Date.parse(ev.end);
  return e > from.getTime() && s < to.getTime();
}

// Turns the text of an .ics file into the events between `from` and `to`,
// with repeating events expanded and moved/cancelled instances applied.
export function eventsFromIcs(text: string, from: Date, to: Date): FeedEvent[] {
  const root = new ICAL.Component(ICAL.parse(text));

  for (const tz of root.getAllSubcomponents('vtimezone')) {
    try { ICAL.TimezoneService.register(tz); } catch { /* duplicate or malformed zone */ }
  }

  const masters = new Map<string, any>();
  const exceptions: any[] = [];
  const singles: any[] = [];
  for (const comp of root.getAllSubcomponents('vevent')) {
    const ev = new ICAL.Event(comp);
    if (!ev.startDate) continue;
    if (String(comp.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED' && !ev.isRecurrenceException()) continue;
    if (ev.isRecurrenceException()) exceptions.push(ev);
    else if (ev.isRecurring()) masters.set(ev.uid, ev);
    else singles.push(ev);
  }
  for (const ex of exceptions) {
    const master = masters.get(ex.uid);
    if (master) master.relateException(ex);
    else singles.push(ex); // moved instance of a series we don't have
  }

  const out: FeedEvent[] = [];
  const add = (ev: FeedEvent, status: string) => {
    if (status.toUpperCase() === 'CANCELLED') return;
    if (overlaps(ev, from, to)) out.push(ev);
  };
  const statusOf = (ev: any) => String(ev.component.getFirstPropertyValue('status') || '');

  for (const ev of singles) {
    add(toFeedEvent(ev.uid, ev.summary || '(No title)', ev.location || '', ev.startDate, ev.endDate), statusOf(ev));
  }

  const toTime = ICAL.Time.fromJSDate(to, true);
  for (const master of masters.values()) {
    const it = master.iterator();
    let next: any;
    let steps = 0;
    while ((next = it.next()) && steps++ < MAX_STEPS) {
      if (next.compare(toTime) > 0) break;
      const d = master.getOccurrenceDetails(next);
      const item = d.item;
      add(
        toFeedEvent(master.uid, item.summary || '(No title)', item.location || '', d.startDate, d.endDate),
        statusOf(item),
      );
    }
  }

  return out.sort((a, b) => a.start.localeCompare(b.start));
}

async function fetchFeed(url: string) {
  const address = url.trim().replace(/^webcal:\/\//i, 'https://');
  if (!/^https:\/\//i.test(address)) throw new Error('The address must start with https:// or webcal://');
  const res = await fetch(address, {
    headers: { Accept: 'text/calendar, */*' },
    signal: AbortSignal.timeout(12000),
    redirect: 'follow',
  });
  if (res.status === 404 || res.status === 401 || res.status === 403) {
    throw new Error('The calendar address was not accepted. It may have been reset in Google Calendar.');
  }
  if (!res.ok) throw new Error(`The calendar service answered with an error (${res.status}).`);
  const text = await res.text();
  if (text.length > MAX_FEED_BYTES) throw new Error('This calendar is too large to read.');
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('That address did not return a calendar. Use the iCal (.ics) address.');
  return text;
}

// ================= Dates in each device's own time zone =================

export function localParts(now: Date, tz: string) {
  let zone = tz;
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); } catch { zone = 'America/New_York'; }
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(now).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), zone };
}

export function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function timeLabel(iso: string, zone: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)).replace(':00', '');
}

function listText(items: string[], max = 4) {
  const shown = items.slice(0, max).join(', ');
  return items.length > max ? `${shown} +${items.length - max} more` : shown;
}

// ================= What each notification says =================

type Family = { id: string; name: string };
type Member = { id: string; family_id: string; user_id: string | null; display_name: string; birthday: string | null };

export function morningNote(o: {
  zone: string; today: string; member?: Member;
  events: FeedEvent[]; tasks: { title: string; due_date: string | null }[]; dinner?: string | null;
}): Note {
  const todays = o.events
    .filter(ev => ev.allDay ? ev.start <= o.today && o.today < ev.end : localParts(new Date(ev.start), o.zone).date === o.today)
    .sort((a, b) => (a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1));
  const seen = new Set<string>();
  const events = todays.filter(ev => {
    const k = `${ev.title}|${ev.start}`; // the same event on two people's calendars
    return !seen.has(k) && seen.add(k);
  }).map(ev => ev.allDay ? ev.title : `${timeLabel(ev.start, o.zone)} ${ev.title}`);
  const lines = [
    events.length ? `📅 ${listText(events, 3)}` : '📅 Nothing on the calendar',
    o.tasks.length ? `✅ ${o.tasks.length} ${o.tasks.length === 1 ? 'task' : 'tasks'}: ${listText(o.tasks.map(t => t.title), 3)}` : '✅ No tasks due',
    o.dinner ? `🍽️ Dinner: ${o.dinner}` : '🍽️ No dinner planned yet',
  ];
  return {
    title: `☀️ Good morning${o.member ? `, ${o.member.display_name}` : ''}!`,
    body: lines.join('\n'),
    url: '#/home',
    tag: 'morning',
  };
}

export function reminderNote(o: {
  tomorrow: string; me?: Member; members: Member[];
  countdowns: { title: string; event_date: string; repeats_yearly: boolean; category: string }[];
}): Note | null {
  const md = o.tomorrow.slice(5);
  const year = Number(o.tomorrow.slice(0, 4));
  const items: string[] = [];
  for (const m of o.members) {
    if (!m.birthday || m.birthday.slice(5) !== md || m.id === o.me?.id) continue; // no spoilers about your own
    items.push(`🎂 ${m.display_name}'s birthday`);
  }
  for (const c of o.countdowns) {
    const hit = c.event_date === o.tomorrow ||
      (c.repeats_yearly && c.event_date.slice(5) === md && Number(c.event_date.slice(0, 4)) < year);
    if (!hit) continue;
    const icon = c.category === 'birthday' ? '🎂' : c.category === 'anniversary' ? '💍' : '⏳';
    items.push(`${icon} ${c.title}`);
  }
  if (!items.length) return null;
  return {
    title: items.length === 1 ? 'Tomorrow' : `Tomorrow: ${items.length} things`,
    body: items.join('\n'),
    url: '#/home',
    tag: 'tomorrow',
  };
}

// ================= The scheduled run =================

type Row = Record<string, any>;

export async function runOnce(db: any, cfg: any, now = new Date(), send = sendPush) {
  const report = { sent: 0, gone: 0, failed: 0, morning: 0, reminders: 0, lists: 0 };
  const { data: subs, error } = await db.from('push_subscriptions').select('*');
  if (error) throw error;
  if (!subs?.length) {
    await db.from('notify_queue').delete().lt('id', Number.MAX_SAFE_INTEGER);
    return report;
  }

  const deliver = async (sub: Row, note: Note, ttl?: number) => {
    const r = await send(sub as Sub, note, cfg, ttl);
    report[r]++;
    if (r === 'gone') await db.from('push_subscriptions').delete().eq('id', sub.id);
    return r;
  };

  const familyIds = [...new Set(subs.map((s: Row) => s.family_id))];
  const { data: members } = await db.from('family_members').select('id, family_id, user_id, display_name, birthday').in('family_id', familyIds);
  const memberOf = (id: string) => (members || []).find((m: Member) => m.id === id);

  // ---- 1. New grocery and list items (sent once people stop adding for a bit)
  const { data: queue } = await db.from('notify_queue').select('*').order('id').limit(1000);
  if (queue?.length) {
    const quietSince = now.getTime() - 45 * 1000;
    const byFamily = new Map<string, Row[]>();
    for (const q of queue) byFamily.set(q.family_id, [...(byFamily.get(q.family_id) || []), q]);
    const listIds = [...new Set(queue.filter((q: Row) => q.list_id).map((q: Row) => q.list_id))];
    const { data: lists } = listIds.length ? await db.from('lists').select('id, name, icon').in('id', listIds) : { data: [] };
    const done: number[] = [];
    for (const [fid, rows] of byFamily) {
      const newest = Math.max(...rows.map(r => Date.parse(r.created_at)));
      const stale = now.getTime() - newest > 24 * 3600e3;
      if (newest > quietSince && !stale) continue; // still adding; try again next minute
      done.push(...rows.map(r => r.id));
      if (stale) continue;
      for (const sub of subs.filter((s: Row) => s.family_id === fid && s.lists)) {
        const me = memberOf(sub.member_id);
        const mine = rows.filter(r => !r.actor || r.actor !== me?.user_id);
        const groceries = mine.filter(r => r.kind === 'grocery').map(r => r.text);
        if (groceries.length) {
          await deliver(sub, { title: `🛒 ${groceries.length === 1 ? 'Added' : `${groceries.length} added`} to the Grocery List`, body: listText(groceries, 6), url: '#/grocery', tag: 'grocery' }, 6 * 3600);
          report.lists++;
        }
        const perList = new Map<string, string[]>();
        for (const r of mine.filter(x => x.kind === 'list')) perList.set(r.list_id, [...(perList.get(r.list_id) || []), r.text]);
        for (const [lid, texts] of perList) {
          const l = (lists || []).find((x: Row) => x.id === lid);
          if (!l) continue; // the list was deleted
          await deliver(sub, { title: `${l.icon} ${texts.length === 1 ? 'Added' : `${texts.length} added`} to ${l.name}`, body: listText(texts, 6), url: '#/lists', tag: `list-${lid}` }, 6 * 3600);
          report.lists++;
        }
      }
    }
    if (done.length) await db.from('notify_queue').delete().in('id', done);
  }

  // ---- 2. Morning summary and 3. tomorrow's birthdays and countdowns
  const due: { sub: Row; local: ReturnType<typeof localParts>; morning: boolean; reminder: boolean }[] = [];
  for (const sub of subs) {
    const local = localParts(now, sub.tz || 'America/New_York');
    const [h, m] = String(sub.morning_time || '07:00').split(':').map(Number);
    const at = h * 60 + m;
    const inWindow = local.minutes >= at && local.minutes < at + 180; // not hours late if a run was missed
    const morning = sub.morning && inWindow && sub.last_morning !== local.date;
    const reminder = sub.reminders && inWindow && sub.last_reminder !== local.date;
    if (morning || reminder) due.push({ sub, local, morning, reminder });
  }
  if (!due.length) return report;

  const fams = [...new Set(due.map(d => d.sub.family_id))];
  const cache = new Map<string, any>();
  const familyData = async (fid: string) => {
    if (cache.has(fid)) return cache.get(fid);
    const [tasks, meals, countdowns, calendars] = await Promise.all([
      db.from('tasks').select('title, due_date, is_done').eq('family_id', fid).eq('is_done', false),
      db.from('meal_plan').select('plan_date, slot, title').eq('family_id', fid).gte('plan_date', addDays(now.toISOString().slice(0, 10), -2)),
      db.from('countdowns').select('title, event_date, repeats_yearly, category').eq('family_id', fid),
      db.from('calendars').select('id, ical_url').eq('family_id', fid),
    ]);
    let events: FeedEvent[] | null = null;
    const out = {
      tasks: tasks.data || [], meals: meals.data || [], countdowns: countdowns.data || [], calendars: calendars.data || [],
      async events() {
        if (events) return events;
        events = [];
        const from = new Date(now.getTime() - 36 * 3600e3);
        const to = new Date(now.getTime() + 36 * 3600e3);
        await Promise.all(out.calendars.map(async (cal: Row) => {
          try { events!.push(...eventsFromIcs(await fetchFeed(cal.ical_url), from, to)); } catch (e) { console.error('calendar', e); }
        }));
        return events;
      },
    };
    cache.set(fid, out);
    return out;
  };
  for (const fid of fams) await familyData(fid);

  for (const d of due) {
    const f = await familyData(d.sub.family_id);
    const me = memberOf(d.sub.member_id);
    const patch: Row = {};
    if (d.morning) {
      const today = d.local.date;
      const note = morningNote({
        zone: d.local.zone, today, member: me,
        events: await f.events(),
        tasks: f.tasks.filter((t: Row) => !t.due_date || t.due_date <= today),
        dinner: f.meals.find((x: Row) => x.plan_date === today && x.slot === 'dinner')?.title,
      });
      if (await deliver(d.sub, note, 4 * 3600) === 'gone') continue;
      report.morning++;
      patch.last_morning = today;
    }
    if (d.reminder) {
      const note = reminderNote({ tomorrow: addDays(d.local.date, 1), me, members: (members || []).filter((m: Member) => m.family_id === d.sub.family_id), countdowns: f.countdowns });
      if (note) {
        if (await deliver(d.sub, note, 12 * 3600) === 'gone') continue;
        report.reminders++;
      }
      patch.last_reminder = d.local.date;
    }
    await db.from('push_subscriptions').update(patch).eq('id', d.sub.id);
  }
  return report;
}

// ================= Keys and settings kept in the database =================

async function getConfig(db: any, url: string) {
  const functionUrl = `${url}/functions/v1/notify`;
  const { data } = await db.from('push_config').select('*').eq('id', 1).maybeSingle();
  if (data?.public_key) {
    if (data.function_url !== functionUrl) await db.from('push_config').update({ function_url: functionUrl }).eq('id', 1);
    return { ...data, subject: url };
  }
  // First use: create the signing keys (only once, even if two calls race)
  const keys = await makeVapidKeys();
  if (data) await db.from('push_config').update({ ...keys, function_url: functionUrl }).eq('id', 1).is('public_key', null);
  else await db.from('push_config').upsert({ id: 1, ...keys, function_url: functionUrl }, { onConflict: 'id', ignoreDuplicates: true });
  const { data: again, error } = await db.from('push_config').select('*').eq('id', 1).single();
  if (error || !again?.public_key) throw new Error('Run database/setup.sql (Alpha 0.9) first.');
  return { ...again, subject: url };
}

if (typeof Deno !== 'undefined' && !Deno.env.get('NOTIFY_TEST')) {
  Deno.serve(async req => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

    const url = Deno.env.get('SUPABASE_URL')!;
    const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let body: { action?: string; endpoint?: string } = {};
    try { body = await req.json(); } catch { /* empty */ }

    try {
      const cfg = await getConfig(db, url);

      if (body.action === 'key') return json({ publicKey: cfg.public_key });

      if (body.action === 'run') {
        if (!cfg.cron_secret || req.headers.get('x-cron-secret') !== cfg.cron_secret) return json({ error: 'Not allowed.' }, 403);
        return json(await runOnce(db, cfg));
      }

      if (body.action === 'test') {
        const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
        const { data: userData } = await db.auth.getUser(token);
        if (!userData?.user) return json({ error: 'Please sign in again.' }, 401);
        const { data: me } = await db.from('family_members').select('id').eq('user_id', userData.user.id).maybeSingle();
        let q = db.from('push_subscriptions').select('*').eq('member_id', me?.id ?? '00000000-0000-0000-0000-000000000000');
        if (body.endpoint) q = q.eq('endpoint', body.endpoint);
        const { data: subs } = await q;
        let sent = 0;
        for (const sub of subs || []) {
          const r = await sendPush(sub, { title: '🔔 Family Hub', body: 'Notifications are working on this device.', url: '#/settings', tag: 'test' }, cfg, 600);
          if (r === 'gone') await db.from('push_subscriptions').delete().eq('id', sub.id);
          if (r === 'sent') sent++;
        }
        return json({ sent, devices: subs?.length || 0 });
      }

      return json({ error: 'Unknown action.' }, 400);
    } catch (e) {
      console.error(e);
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });
}
