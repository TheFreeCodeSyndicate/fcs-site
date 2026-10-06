/** Guess which core-member card belongs to a login from its email:
 * "jyotimoydascse@…" → Jyotirmoy Das, "bhairabm1908@…" → Bhairab Mahanta.
 * Only a suggestion; each person confirms their own card. */

const letters = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");

/** Longest common subsequence length; it tolerates typos and dropped letters. */
function lcs(a, b) {
  let prev = new Array(b.length + 1).fill(0);
  for (const ch of a) {
    const row = [0];
    for (let j = 1; j <= b.length; j++) row[j] = ch === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1]);
    prev = row;
  }
  return prev[b.length];
}

/** How well an email matches a name, 0..1: share of the name's letters found in order. */
export function matchScore(email, name) {
  const local = letters(String(email || "").split("@")[0]);
  const full = letters(name);
  if (!local || !full || local[0] !== full[0]) return 0;
  return lcs(local, full) / full.length;
}

/** The best card for this email, or null when nothing is close. `taken`: ids of cards linked to someone else. */
export function guessMember(email, members, taken = new Set()) {
  let best = null;
  let top = 0.5;
  for (const m of members) {
    if (taken.has(m.id)) continue;
    const s = matchScore(email, m.name);
    if (s > top) { best = m; top = s; }
  }
  return best;
}
