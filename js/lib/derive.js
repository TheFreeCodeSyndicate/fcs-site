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
 * The single definition of "how long is this event". Shared so the
 * public page and the generated calendar can never disagree.
 * @param {*} value
 * @returns {number} a positive number of minutes, defaulting to 60
 */
export function resolveDurationMinutes(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 60;
}

/**
 * @param {string} startsAt        ISO timestamp
 * @param {number} durationMinutes
 * @param {string} stage           "draft" | "scheduled" | "live" | "done";
 *   only "done" overrides the clock, every other value is judged by it
 * @param {string|Date} now
 * @returns {"upcoming"|"live"|"finished"}
 */
export function deriveEventState(startsAt, durationMinutes = 60, stage = "scheduled", now = new Date()) {
  if (stage === "done") return "finished";

  const start = new Date(startsAt).getTime();
  if (Number.isNaN(start)) return "upcoming";

  const end = start + resolveDurationMinutes(durationMinutes) * MINUTE_MS;
  const liveFrom = start - LIVE_LEAD_MINUTES * MINUTE_MS;
  const t = new Date(now).getTime();
  if (Number.isNaN(t)) return "upcoming";

  if (t < liveFrom) return "upcoming";
  if (t < end) return "live";
  return "finished";
}
