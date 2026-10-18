/*
 * js/lib/attribution.js
 * ------------------------------------------------------------------
 * The attribution line inside a body: written there as a quote, and read back
 * when an older import wrote it as a paragraph. Pure: no DOM, no network, no
 * stored state; the only import is the sibling ./markdown.js, used to
 * re-serialise a body that changes. What the line looks like, and how its
 * address is made carryable, is the leaf ./attribution-line.js - the markdown
 * renderer reads that too, to style the line - re-exported here so callers
 * keep one import.
 * ------------------------------------------------------------------
 */

import { isAttributionLine } from "./attribution-line.js";
import { parseBlocks, serializeBlocks } from "./markdown.js";

export { attributionLine, isAttributionLine, isSourceURL, lineAddress } from "./attribution-line.js";

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
