/*
 * js/lib/events-view.js
 * ------------------------------------------------------------------
 * Turns a flat list of event rows into what the Events section
 * renders: an ascending Upcoming list, a descending Past list, and
 * the set of group names to build filter chips from.
 *
 * Drafts are dropped here, not in derive.js: deriving a state is a
 * question about the clock, and a draft is a question about whether
 * the row is finished being written. Only this module knows the
 * answer may not be published yet.
 * ------------------------------------------------------------------
 */

import { deriveEventState } from "./derive.js";

/** A row whose timestamp cannot be parsed sorts after every parseable row. */
function startMs(item) {
  const t = new Date(item && item.starts_at).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * @param {number} sign 1 for ascending, -1 for descending
 */
function compareByStart(a, b, sign) {
  const ta = startMs(a);
  const tb = startMs(b);
  if (ta === null || tb === null) {
    // An unparseable date has no place in a time order, so it goes last
    // in both lists rather than wherever the engine leaves NaN. Two
    // unparseable rows compare equal and keep their input order.
    if (ta === null && tb === null) return 0;
    return ta === null ? 1 : -1;
  }
  return sign * (ta - tb);
}

/**
 * @param {object[]} events
 * @param {string|Date} now
 * @returns {{upcoming: object[], past: object[]}} each item gains
 *   `display_state` of "upcoming" | "live" | "finished". `past` means
 *   finished, not merely started: an event cancelled by an admin with
 *   `stage: "done"` lands there even though its start is in the future.
 */
export function partitionEvents(events = [], now = new Date()) {
  const upcoming = [];
  const past = [];

  for (const event of events || []) {
    if (!event) continue;
    // A draft is still being written and is hidden from the public site.
    if (event.stage === "draft") continue;
    const item = {
      ...event,
      display_state: deriveEventState(event.starts_at, event.duration_minutes, event.stage, now),
    };
    if (item.display_state === "finished") past.push(item);
    else upcoming.push(item);
  }

  upcoming.sort((a, b) => compareByStart(a, b, 1));
  past.sort((a, b) => compareByStart(a, b, -1));

  return { upcoming, past };
}

/** Distinct, non-blank group names, alphabetically sorted. */
export function groupNames(items = []) {
  const names = (items || [])
    .map((item) => item && item.group_name)
    .filter((name) => name && String(name).trim())
    .map((name) => String(name).trim());
  return [...new Set(names)].sort();
}

/**
 * @param {string} group "All" or an exact group name. Group names are
 *   trimmed on both sides, so a name stored with stray whitespace still
 *   matches the chip groupNames built from.
 */
export function filterByGroup(items = [], group) {
  const list = items || [];
  const wanted = group == null ? "" : String(group).trim();
  if (wanted === "" || wanted === "All") return list;
  return list.filter(
    (item) => item && item.group_name != null && String(item.group_name).trim() === wanted
  );
}
