// Family Hub — calendar-feed (Supabase Edge Function)
// ------------------------------------------------------------------
// Reads each of the family's calendars from its private iCal address
// (Google Calendar → "Secret address in iCal format") and returns the
// events in a date range as one combined list.
//
// Why a server function: Google doesn't let web pages read those
// addresses directly, so the app asks this function to do it.
//
// Security: the caller must be signed in, and the calendars are read
// with the caller's own login, so the database security rules only
// ever return that person's family calendars.
// ------------------------------------------------------------------

import ICAL from 'npm:ical.js@2.2.1';
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_RANGE_DAYS = 120;
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
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

if (typeof Deno !== 'undefined') {
  Deno.serve(async req => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

    const auth = req.headers.get('Authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '');
    const key = Deno.env.get('SUPABASE_ANON_KEY') || req.headers.get('apikey') || '';
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, key, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData } = await sb.auth.getUser(token);
    if (!userData?.user) return json({ error: 'Please sign in again.' }, 401);

    let body: { from?: string; to?: string } = {};
    try { body = await req.json(); } catch { /* use defaults */ }
    const from = new Date(body.from || Date.now());
    const to = new Date(body.to || Date.now() + 14 * 86400e3);
    if (isNaN(+from) || isNaN(+to) || to <= from || (+to - +from) > MAX_RANGE_DAYS * 86400e3) {
      return json({ error: `Pick a date range of up to ${MAX_RANGE_DAYS} days.` }, 400);
    }

    // The security rules limit this to the caller's own family.
    const { data: calendars, error } = await sb.from('calendars').select('id, ical_url');
    if (error) return json({ error: error.message }, 500);

    const events: (FeedEvent & { calendar_id: string })[] = [];
    const errors: { calendar_id: string; message: string }[] = [];
    await Promise.all((calendars || []).map(async cal => {
      try {
        const text = await fetchFeed(cal.ical_url);
        for (const ev of eventsFromIcs(text, from, to)) events.push({ ...ev, calendar_id: cal.id });
      } catch (e) {
        const message = e instanceof Error
          ? (e.name === 'TimeoutError' ? 'The calendar took too long to answer.' : e.message)
          : String(e);
        errors.push({ calendar_id: cal.id, message });
      }
    }));

    events.sort((a, b) => a.start.localeCompare(b.start));
    return json({ events, errors, from: from.toISOString(), to: to.toISOString() });
  });
}
