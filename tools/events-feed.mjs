/*
 * tools/events-feed.mjs
 * ------------------------------------------------------------------
 * Writes events.ics, the calendar feed people subscribe to from the
 * events section ("Add to your calendar"). Run by the deploy workflow
 * every 30 minutes, so subscribed calendars see new and changed events.
 *
 * Reads events with the public anon key, so it only ever sees what a
 * visitor sees (no drafts). Keeps the last 60 days and everything ahead.
 * If Supabase is unreachable the committed file is kept.
 *
 *   node tools/events-feed.mjs
 * ------------------------------------------------------------------
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildICS } from "../js/lib/ics.js";

const config = readFileSync("js/config.js", "utf8");
const url = /supabaseUrl:\s*"([^"]+)"/.exec(config)?.[1];
const key = /supabaseAnonKey:\s*"([^"]+)"/.exec(config)?.[1];

try {
  if (!url || !key) throw new Error("Supabase is not configured in js/config.js");
  const since = new Date(Date.now() - 60 * 864e5).toISOString();
  const res = await fetch(
    `${url}/rest/v1/events?select=id,title,group_name,details,starts_at,duration_minutes,link&starts_at=gte.${since}&order=starts_at`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  if (!res.ok) throw new Error(`events -> ${res.status}`);
  const events = await res.json();
  // Ask calendar apps to check hourly (Apple and Outlook honour it; Google sets its own pace).
  const ics = buildICS(events, { calendarName: "FCS Events" }).replace(
    "X-WR-CALNAME:",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H\r\nX-PUBLISHED-TTL:PT1H\r\nX-WR-CALNAME:"
  );
  writeFileSync("events.ics", ics);
  console.log(`Feed: ${events.length} events`);
} catch (err) {
  console.warn(`Feed skipped, keeping the existing events.ics: ${err.message}`);
}
