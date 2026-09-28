/*
 * js/lib/forms.js
 * ------------------------------------------------------------------
 * Conversion between <input type="datetime-local"> values and the UTC
 * ISO strings stored in Postgres. A datetime-local value carries no
 * timezone, so it is read and written in the browser's local zone —
 * which is what a maintainer typing their own session time expects.
 * ------------------------------------------------------------------
 */

/* `new Date(null)` is the epoch, not Invalid Date, so a missing value
 * must be rejected before it reaches the constructor. */
function parse(value) {
  if (value == null || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** ISO string -> "YYYY-MM-DDTHH:mm" for a datetime-local input */
export function toLocalInputValue(isoString) {
  const date = parse(isoString);
  if (!date) return "";

  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** "YYYY-MM-DDTHH:mm" -> ISO string in UTC, or null if unusable */
export function fromLocalInputValue(value) {
  const date = parse(value);
  return date ? date.toISOString() : null;
}

/** ISO string -> readable text for list rows */
export function formatDateTimeLocal(isoString) {
  const date = parse(isoString);
  if (!date) return "—";
  return date.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
