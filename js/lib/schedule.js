/*
 * js/lib/schedule.js
 * ------------------------------------------------------------------
 * Weekly class schedule and "what is next" resolution.
 *
 * `weekday` uses the same convention as JavaScript's Date.getDay():
 * 0 = Sunday ... 6 = Saturday, so no conversion is needed anywhere
 * in the client or the admin panel.
 *
 * TIMEZONE: the candidate is built in the *viewer's* local zone, so a
 * recurring 21:00 session shows as 21:00 to whoever looks at it. That
 * is the right behaviour for a community that spans zones, but it does
 * mean the `class_sessions.timezone` column records intent rather than
 * converting the time. Do not add a timezone conversion here without
 * also changing what the public page displays — a visitor in Berlin
 * should not see a 21:00 IST session silently become 18:00.
 * ------------------------------------------------------------------
 */

/**
 * The next wall-clock time a recurring session runs, strictly after `now`.
 * @param {{weekday:number, start_time:string, is_active?:boolean}} session
 * @param {string|Date} now
 * @returns {Date|null} null when the session is inactive or malformed
 */
export function nextOccurrence(session, now = new Date()) {
  if (!session || session.is_active === false) return null;

  const m = /^(\d{1,2}):(\d{2})/.exec(String(session.start_time || ""));
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;

  const nowMs = new Date(now).getTime();
  if (Number.isNaN(nowMs)) return null;

  // Eight days covers a full week plus today, so a slot that already
  // passed today still finds its next occurrence.
  for (let offset = 0; offset < 8; offset++) {
    const day = new Date(now);
    day.setDate(day.getDate() + offset);
    if (day.getDay() !== session.weekday) continue;

    const candidate = new Date(day);
    candidate.setHours(hours, minutes, 0, 0);
    if (candidate.getTime() > nowMs) return candidate;
  }
  return null;
}

/**
 * The soonest thing happening next, across one-off events and the
 * recurring class schedule.
 * @param {{events?:object[], classSessions?:object[]}} data
 * @param {string|Date} now
 * @returns {{kind:"event"|"class", title:string, group:string|null, at:Date}|null}
 */
export function resolveNextSession({ events = [], classSessions = [] } = {}, now = new Date()) {
  const candidates = [];
  const nowMs = new Date(now).getTime();
  // Without this guard every `at <= nowMs` is false, so a past event
  // would be handed back as the next session.
  if (Number.isNaN(nowMs)) return null;

  for (const event of events || []) {
    if (!event || event.stage === "done") continue;
    const at = new Date(event.starts_at).getTime();
    if (Number.isNaN(at) || at <= nowMs) continue;
    candidates.push({
      kind: "event",
      title: event.title,
      group: event.group_name || null,
      at: new Date(at),
    });
  }

  for (const session of classSessions || []) {
    const at = nextOccurrence(session, now);
    if (at) {
      candidates.push({
        kind: "class",
        title: session.title,
        group: session.group_name || null,
        at,
      });
    }
  }

  candidates.sort((a, b) => a.at.getTime() - b.at.getTime());
  return candidates[0] || null;
}
