/*
 * js/lib/attribution.js
 * ------------------------------------------------------------------
 * Recognition, generation and normalisation of the Medium attribution
 * line. Pure: no DOM, no network, no stored state; the only import is the
 * sibling ./markdown.js, used to re-serialise a body that changes.
 * ------------------------------------------------------------------
 */

import { parseBlocks, serializeBlocks } from "./markdown.js";

/** The line's text on its own, as a block holds it: no "> " marker. */
const LINE = /^Originally published on \[Medium\]\((https:\/\/[^\s)]+)\)$/;

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
