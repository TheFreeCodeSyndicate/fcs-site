/**
 * js/lib/block-diff.js
 * ------------------------------------------------------------------
 * What changed between two versions of a post, block by block, for the
 * editor's version history (as in Notion): blocks added, removed and
 * edited, and a one-line summary ("Edited 2 blocks, added 1 · title").
 * ------------------------------------------------------------------
 */
import { parseBlocks, serializeBlocks } from "./markdown.js";

const split = (body) => parseBlocks(body || "").map((b) => serializeBlocks([b]));

/** Blocks' Markdown joined again as one body, so lists keep their numbers. */
export const joinBlocks = (mds) => serializeBlocks(mds.flatMap((md) => parseBlocks(md)));

/**
 * The new body's blocks in order, each "same", "add" or "edit" (with what it
 * replaced), plus "del" for blocks that are gone. Longest common subsequence;
 * a removal followed by an addition at the same place counts as an edit.
 */
export function diffBlocks(oldBody, newBody) {
  const a = split(oldBody);
  const b = split(newBody);
  const lcs = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }
  const raw = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { raw.push({ op: "same", md: b[j] }); i++; j++; }
    else if (j < b.length && (i >= a.length || lcs[i][j + 1] >= lcs[i + 1][j])) { raw.push({ op: "add", md: b[j] }); j++; }
    else { raw.push({ op: "del", md: a[i] }); i++; }
  }
  // In each run of changed blocks, pair removals with additions: those are edits.
  const out = [];
  for (let k = 0; k < raw.length; k++) {
    if (raw[k].op === "same") { out.push(raw[k]); continue; }
    const run = [];
    while (k < raw.length && raw[k].op !== "same") run.push(raw[k++]);
    k--;
    const dels = run.filter((o) => o.op === "del");
    const adds = run.filter((o) => o.op === "add");
    const pairs = Math.min(dels.length, adds.length);
    for (let n = 0; n < pairs; n++) out.push({ op: "edit", md: adds[n].md, was: dels[n].md });
    for (let n = pairs; n < adds.length; n++) out.push(adds[n]);
    for (let n = pairs; n < dels.length; n++) out.push(dels[n]);
  }
  return out;
}

const FIELDS = [["title", "title"], ["icon", "icon"], ["cover_url", "cover"], ["excerpt", "summary"], ["authors", "authors"], ["font", "font"]];

/** "Edited 2 blocks, added 1 · title, cover", or "No changes". */
export function changeSummary(older, newer) {
  if (!older) return "First version";
  const ops = diffBlocks(older.body, newer.body);
  const count = (op) => ops.filter((o) => o.op === op).length;
  const parts = [];
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const blocks = [["edit", "Edited"], ["add", "Added"], ["del", "Removed"]]
    .filter(([op]) => count(op))
    .map(([op, verb], n) => `${n ? verb.toLowerCase() : verb} ${n ? count(op) : plural(count(op), "block")}`);
  if (blocks.length) parts.push(blocks.join(", "));
  // A field counts only when both versions have it (old versions may lack newer fields).
  const fields = FIELDS.filter(([k]) => k in older && k in newer && JSON.stringify(older[k]) !== JSON.stringify(newer[k])).map(([, name]) => name);
  if (fields.length) parts.push(`${parts.length ? "" : "Changed "}${fields.join(", ")}`);
  return parts.join(" · ") || "No changes";
}
