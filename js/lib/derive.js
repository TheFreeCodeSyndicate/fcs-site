/*
 * js/lib/derive.js
 * ------------------------------------------------------------------
 * Turns an event's timestamps into what a visitor should actually
 * see. Deliberately independent of the browser so it can be unit
 * tested directly.
 * ------------------------------------------------------------------
 */

/** Minutes before the start at which an event is considered live. */
export const LIVE_LEAD_MINUTES = 15;

const MINUTE_MS = 60 * 1000;

/**
 * @param {string|Date} now
 * @param {string} startsAt        ISO timestamp
 * @param {number} durationMinutes
 * @param {string} stage           "draft" | "scheduled" | "live" | "done"
 * @returns {"upcoming"|"live"|"finished"}
 */
export function deriveEventState(now, startsAt, durationMinutes = 60, stage = "scheduled") {
  if (stage === "done") return "finished";

  const start = new Date(startsAt).getTime();
  if (Number.isNaN(start)) return "upcoming";

  const end = start + (durationMinutes || 60) * MINUTE_MS;
  const liveFrom = start - LIVE_LEAD_MINUTES * MINUTE_MS;
  const t = new Date(now).getTime();
  if (Number.isNaN(t)) return "upcoming";

  if (t < liveFrom) return "upcoming";
  if (t < end) return "live";
  return "finished";
}
