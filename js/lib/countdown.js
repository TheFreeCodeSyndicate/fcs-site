/*
 * js/lib/countdown.js
 * ------------------------------------------------------------------
 * Human-readable time remaining. Pure, so the exact string the page
 * shows is unit tested rather than eyeballed.
 * ------------------------------------------------------------------
 */

const SECOND_MS = 1000;

const pad = (n) => String(n).padStart(2, "0");

/**
 * @param {number} ms Milliseconds remaining. Negative is treated as zero.
 * @returns {string} e.g. "2d 04h 13m", "5h 07m", or "0m 45s"
 */
export function formatCountdown(ms) {
  const numeric = Number(ms);
  const total = Math.max(0, Math.floor((Number.isFinite(numeric) ? numeric : 0) / SECOND_MS));

  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (days > 0) return `${days}d ${pad(hours)}h ${pad(minutes)}m`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  return `${minutes}m ${pad(seconds)}s`;
}
