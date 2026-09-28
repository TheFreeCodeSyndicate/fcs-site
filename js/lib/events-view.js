/*
 * js/lib/events-view.js
 * ------------------------------------------------------------------
 * Turns a flat list of event rows into what the Events section
 * renders: an ascending Upcoming list, a descending Past list, and
 * the set of group names to build filter chips from.
 * ------------------------------------------------------------------
 */

import { deriveEventState } from "./derive.js";

/**
 * @returns {{upcoming: object[], past: object[]}} each item gains
 *   `display_state` of "upcoming" | "live" | "finished"
 */
export function partitionEvents(events = [], now = new Date()) {
  const upcoming = [];
  const past = [];

  for (const event of events || []) {
    if (!event) continue;
    const item = {
      ...event,
      display_state: deriveEventState(now, event.starts_at, event.duration_minutes, event.stage),
    };
    if (item.display_state === "finished") past.push(item);
    else upcoming.push(item);
  }

  const byStart = (a, b) => new Date(a.starts_at) - new Date(b.starts_at);
  upcoming.sort(byStart);
  past.sort((a, b) => -byStart(a, b));

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

/** @param {string} group "All" or an exact group name */
export function filterByGroup(items = [], group) {
  if (!group || group === "All") return items || [];
  return (items || []).filter((item) => item && item.group_name === group);
}
