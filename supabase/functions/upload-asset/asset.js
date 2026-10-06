// supabase/functions/upload-asset/asset.js
// Pure helpers for the upload-asset function, kept free of Deno APIs so
// `npm test` can import them (js/lib/asset.test.js).

export const REPO = "TheFreeCodeSyndicate/fcs-assets";
export const MAX_BYTES = 2 * 1024 * 1024;

const startsWith = (bytes, sig, at = 0) => sig.every((b, i) => bytes[at + i] === b);

/** The image type from the file's own first bytes, never from the
 * client's say-so. SVG is deliberately absent: it can carry scripts.
 * @returns {"image/png"|"image/jpeg"|"image/webp"|null} */
export function sniffType(bytes) {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** @returns {string|null} why this upload is refused, or null if fine */
export function refusal(bytes) {
  if (!bytes.length) return "No image was sent.";
  if (bytes.length > MAX_BYTES) return `That image is over ${MAX_BYTES / 1024 / 1024} MB. Shrink it and try again.`;
  if (!sniffType(bytes)) return "Use a JPG, PNG or WebP image.";
  return null;
}

/** blog/2026/10/<id>.webp, dated so the repo stays browsable. */
export function assetPath(bytes, now, id) {
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `blog/${now.getUTCFullYear()}/${month}/${id}.${EXT[sniffType(bytes)]}`;
}

/** Pinned to the commit, so the address never changes and never needs a
 * cache purge: a branch address can be served stale for hours. */
export const cdnURL = (sha, path) => `https://cdn.jsdelivr.net/gh/${REPO}@${sha}/${path}`;
