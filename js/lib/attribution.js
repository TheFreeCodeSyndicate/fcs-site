/*
 * js/lib/attribution.js
 * ------------------------------------------------------------------
 * Recognition, generation and normalisation of the Medium attribution
 * line. Pure: no DOM, no network, no stored state; the only import is the
 * sibling ./markdown.js, used to re-serialise a body that changes.
 * ------------------------------------------------------------------
 */

import { parseBlocks, serializeBlocks } from "./markdown.js";

/**
 * The characters the markdown dialect would eat, and the ones that cannot sit
 * raw in a link. Measured, not guessed: see .shots/url-charset-probe.html,
 * which mounts the editor once per character and reads the rendered anchor and
 * the saved body back. A lone "*" is fine, but a pair becomes <em> - inside the
 * href and inside the saved markdown - and a lone ")" cuts the link at that
 * point, leaving the rest of the address loose in the article. "$" opens a math
 * span, "~" a subscript, "^" a superscript, "`" a code span. The rest here
 * cannot sit raw in a URL at all.
 */
const HOSTILE = /[)*`~^$\\[\]<>"{}|]/g;

/**
 * The address as the line carries it: the scheme lowercased, because the
 * dialect only linkifies a lowercase one, and the characters above
 * percent-encoded, so the link comes out whole and the body is unchanged by
 * every save. Lossless for the reader: %29 and ")" are the same octet to any
 * server.
 * @param {string|null|undefined} url
 * @returns {string}
 */
export function lineAddress(url) {
  const raw = String(url == null ? "" : url).trim();
  const scheme = raw.replace(/^[A-Za-z][A-Za-z0-9+.-]*:/, (s) => s.toLowerCase());
  return scheme.replace(HOSTILE, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

/** The line's text on its own, as a block holds it: no "> " marker. The address
 *  inside it has been through lineAddress, so it holds no ")" for this to trip
 *  over - and so a line whose address the dialect would cut in two is not
 *  recognised, and is never offered a box or rewritten into a quote. The scheme
 *  is the lowercase one the dialect makes a link of: a line with a shouty one
 *  is read back as literal brackets and spaces, not as our line. */
const LINE = /^Originally published on \[Medium\]\((https:\/\/[^\s)]+)\)$/;

/**
 * Checks whether a value is an address a line can be built from. Any https
 * address will do, whatever it holds and whatever case its scheme is in:
 * lineAddress makes it carryable, and the line it builds is one the body reads
 * back. The database's own check on source_url (033) is case-insensitive too.
 * @param {string|null|undefined} url
 * @returns {boolean}
 */
export function isSourceURL(url) {
  return /^https:\/\/\S+$/i.test(String(url == null ? "" : url).trim());
}

/**
 * Checks whether a block's whole text is the attribution line.
 * @param {string|null|undefined} text
 * @returns {boolean}
 */
export function isAttributionLine(text) {
  return LINE.test(String(text == null ? "" : text).trim());
}

/**
 * The line for a story address. The "> " marker belongs to the block, not here.
 * @param {string|null|undefined} url
 * @returns {string}
 */
export function attributionLine(url) {
  return `Originally published on [Medium](${lineAddress(url)})`;
}

/**
 * The body with a paragraph that holds the attribution line written as a
 * quote, which is how the line is written now and how an older import's
 * paragraph is read. A body with no such paragraph comes back exactly as it
 * went in, byte for byte, so this is safe to run on every load. Only top-level
 * paragraphs are rewritten: that is where the importer puts the line.
 * @param {string|null|undefined} md
 * @returns {string}
 */
export function normaliseAttribution(md) {
  const source = String(md == null ? "" : md);
  const asQuote = (b) => (b.type === "p" && isAttributionLine(b.text) ? { ...b, type: "quote" } : b);
  const blocks = parseBlocks(source);
  if (!blocks.some((b) => b.type === "p" && isAttributionLine(b.text))) return source;
  return serializeBlocks(blocks.map(asQuote));
}
