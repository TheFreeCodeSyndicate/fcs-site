import { plainSummary } from "./markdown.js";

/**
 * Collapses whitespace, trims, and returns at most `max` code points,
 * never splitting a surrogate pair. Returns "" for empty or whitespace-only input.
 *
 * @param {string|null|undefined} text
 * @param {number} [max=160]
 * @returns {string}
 */
export function clipTitle(text, max = 160) {
  if (text == null) return "";
  const clean = String(text).replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const chars = [...clean];
  if (chars.length <= max) return clean;
  return chars.slice(0, max).join("");
}

/**
 * Derives a plain-text excerpt of at most 300 characters from the story markdown.
 * Single home for the migration 022 300-char excerpt limit (Ruling R18).
 *
 * @param {string} markdown
 * @returns {string}
 */
export function excerptFor(markdown) {
  return plainSummary(markdown, 300);
}

/**
 * Returns section IDs in original order for the requested selection shortcut.
 *
 * @param {"all"|"none"|"text"|"images"|string} name
 * @param {Array<{ id: string, kind?: string }>} sections
 * @returns {Array<string>}
 */
export function applyShortcut(name, sections) {
  const list = Array.isArray(sections) ? sections : [];
  if (name === "all") return list.map((s) => s.id);
  if (name === "none") return [];
  if (name === "text") return list.filter((s) => s.kind !== "image").map((s) => s.id);
  if (name === "images") return list.filter((s) => s.kind === "image").map((s) => s.id);
  return list.map((s) => s.id);
}

/**
 * Summarises import results into a single-sentence toast message and tone.
 *
 * @param {Array<string>} [warnings=[]]
 * @param {{ copied?: number, left?: Array<{ url: string, why?: string }> }} [images={}]
 * @returns {{ message: string, tone: "success"|"info"|"error", text: string, toString: () => string }}
 */
export function summarise(warnings = [], images = {}) {
  const warnList = Array.isArray(warnings) ? warnings.filter(Boolean) : [];
  const leftList = Array.isArray(images?.left) ? images.left : [];
  const copied = Number(images?.copied || 0);

  let tone = "success";
  let message = "";

  if (copied === 0 && leftList.length > 0 && warnList.length === 0) {
    tone = "error";
    message = leftList.length === 1
      ? `Could not copy image: ${leftList[0].why || "image could not be fetched"}.`
      : "None of the images could be copied.";
  } else if (leftList.length > 0 || warnList.length > 0) {
    tone = "info";
    if (leftList.length > 0 && warnList.length > 0) {
      message = `Imported with warnings and ${leftList.length} image${leftList.length === 1 ? "" : "s"} left out.`;
    } else if (leftList.length > 0) {
      message = `Imported, but ${leftList.length} image${leftList.length === 1 ? "" : "s"} could not be copied.`;
    } else {
      message = warnList.length === 1 ? warnList[0] : `Imported with ${warnList.length} warnings.`;
    }
  } else {
    tone = "success";
    message = copied > 0
      ? `Imported story with ${copied} image${copied === 1 ? "" : "s"}.`
      : "Imported story successfully.";
  }

  const res = { message, tone, text: message };
  res.toString = () => message;
  return res;
}

/**
 * Finds the first post in existing whose source_url equals url exactly, else null.
 *
 * @param {Array<{ id?: string, title?: string, source_url?: string }>} existing
 * @param {string} url
 * @returns {object|null}
 */
export function findDuplicate(existing, url) {
  if (!Array.isArray(existing) || !url) return null;
  return existing.find((p) => p && p.source_url === url) || null;
}

/**
 * Returns the story address to send to the server as an absolute https URL,
 * or null when the input is not a story address.
 *
 * @param {string|null|undefined} input
 * @returns {string|null}
 */
export function storyAddress(input) {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s || /\s/.test(s)) return null;

  const hasStoryId = /\/p\/[0-9a-f]{12}(?:[?#]|$)/i.test(s) || /-[0-9a-f]{12}(?:[?#]|$)/i.test(s);
  if (!hasStoryId) return null;

  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      if (!u.hostname.includes(".")) return null;
      return s;
    } catch {
      return null;
    }
  }

  if (s.startsWith("@")) return null;

  try {
    const candidate = `https://${s}`;
    const u = new URL(candidate);
    if (!u.hostname.includes(".")) return null;
    return candidate;
  } catch {
    return null;
  }
}
