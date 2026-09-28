/*
 * js/lib/ics.js
 * ------------------------------------------------------------------
 * RFC 5545 calendar text, generated in the browser. No server, no
 * account, no tracking pixel. Timestamps are emitted in UTC so the
 * calendar client needs no timezone database of its own.
 * ------------------------------------------------------------------
 */

const SECOND_MS = 1000;

/** UTF-8 byte length. Not Buffer — this module runs in the browser. */
function utf8Len(text) {
  return new TextEncoder().encode(text).length;
}

/** 2026-10-05T18:30:00.000Z -> 20261005T183000Z */
function stamp(date) {
  return new Date(date).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeText(value) {
  return String(value == null ? "" : value)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** RFC 5545 requires content lines no longer than 75 octets. */
function fold(line) {
  if (utf8Len(line) <= 75) return line;

  const chunks = [];
  let current = "";
  let currentBytes = 0;

  for (const ch of line) {
    // Continuation lines lose one octet to their leading space.
    const limit = chunks.length === 0 ? 75 : 74;
    const size = utf8Len(ch);
    if (currentBytes + size > limit) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += ch;
    currentBytes += size;
  }
  if (current) chunks.push(current);

  return chunks.map((chunk, i) => (i === 0 ? chunk : " " + chunk)).join("\r\n");
}

/**
 * @param {object[]} events rows with id, title, details, starts_at,
 *   duration_minutes, group_name, link
 * @param {{calendarName?:string, now?:Date}} options `now` is injectable for tests
 * @returns {string} VCALENDAR text
 */
export function buildICS(events = [], { calendarName = "FCS Events", now = new Date() } = {}) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//The Free Code Syndicate//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];

  for (const event of events || []) {
    if (!event || !event.starts_at) continue;
    const start = new Date(event.starts_at);
    if (Number.isNaN(start.getTime())) continue;

    const parsed = Number(event.duration_minutes);
    const duration = Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
    const end = new Date(start.getTime() + duration * 60 * SECOND_MS);

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${event.id || start.getTime()}@freecodesyndicate`);
    lines.push(`DTSTAMP:${stamp(now)}`);
    lines.push(`DTSTART:${stamp(start)}`);
    lines.push(`DTEND:${stamp(end)}`);
    lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (event.details) lines.push(`DESCRIPTION:${escapeText(event.details)}`);
    if (event.group_name) lines.push(`CATEGORIES:${escapeText(event.group_name)}`);
    if (event.link) lines.push(`URL:${event.link}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n");
}
