/*
 * js/lib/attribution.js
 * ------------------------------------------------------------------
 * Recognition, generation and normalisation of the Medium attribution
 * line. Pure: no DOM, no network, no stored state; the only import is the
 * sibling ./markdown.js, used to re-serialise a body that changes.
 * ------------------------------------------------------------------
 */

import { parseBlocks, serializeBlocks } from "./markdown.js";

/** The address shape a post can carry: a lowercase https address with nothing
 *  blank in it. Matches blog_posts.source_url (033), and the markdown dialect's
 *  own links, which only linkify a lowercase scheme - an address outside this
 *  shape is not offered a box, because the body could not read the line back. */
const URL = /^https:\/\/\S+$/;

/** The line's text on its own, as a block holds it: no "> " marker. Greedy to
 *  the last ")" so an address that contains one still reads back, and built
 *  from URL's own pattern, so any address a box is offered for is an address
 *  the line recognises. Those two drifting apart is a one-way door: the box
 *  can be ticked, but the row that offers the way back never goes away. */
const LINE = new RegExp(`^Originally published on \\[Medium\\]\\((${URL.source.slice(1, -1)})\\)$`);

/**
 * Checks whether a value is an address the line can be built from and read
 * back. The editor asks this of a post's source_url before offering its box,
 * so the accepted address and the recognised line can never disagree.
 * @param {string|null|undefined} url
 * @returns {boolean}
 */
export function isSourceURL(url) {
  return URL.test(String(url == null ? "" : url).trim());
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
  return `Originally published on [Medium](${String(url == null ? "" : url).trim()})`;
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
