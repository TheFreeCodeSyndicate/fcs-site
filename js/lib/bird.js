/* ------------------------------------------------------------------
 * The club's bird, as pixel grids. compose() builds one frame as a
 * 40x30 grid of palette keys, centred on the bird, for a given facing:
 *   front  face slides toward the heading (a turned head), far wing shortened
 *   side   profile for fast sideways flight, mirrored for the left
 *   back   climbing away: no face, tail fan
 * r is his outline; shade() lights it from wherever the sun is.
 * ---------------------------------------------------------------- */
export const PAL = {
  r: "#4a463e", H: "#3d3832", B: "#221f1b", D: "#36312b",
  S: "#c9c9c9", L: "#050505", G: "#d9a441", F: "#3a362f", W: "#2a2622", w: "#58524a",
};

const FRONT = [
  "......rrrrrr......",
  "....rrHHHHHHrr....",
  "...rHHHHHHHHHHr...",
  "..rHHHHHHHHHHHHr..",
  ".SSSSSSSSSSSSSSSS.",
  ".rSLLGLSHHSLGLLSr.",
  ".rSLLGLSHHSLGLLSr.",
  "..rHSSHHGGHHSSHr..",
  "..rBBBBBBBBBBBBr..",
  ".rBBBBGGBBGGBBBBr.",
  ".rBBBBGGGGGGBBBBr.",
  "rBBBBBBGGGGBBBBBBr",
  "rBBBBBBBGGBBBBDBBr",
  "rBBBBBBBBBBBBDDDBr",
  "rBBBBBBBBBBBBDDDBr",
  "rBBBBBBBBBBBBDDDDr",
  ".rBBBBBBBBBBBDDDr.",
  ".rBBBBBBBBBBBBDBr.",
  "..rBBBBBBBBBBBBr..",
  "...rrBBBBBBBBrr...",
  "....FFFF..FFFF....",
  "...F.F.F..F.F.F...",
];

// Front with the face painted out; the face and band go back on with an offset.
const SIL = FRONT.map((row, j) => {
  if (j === 4) return FRONT[3];
  if (j > 4 && j < 8) return row.replace(/[SLG]/g, "H");
  if (j >= 8 && j <= 12) return row.replace(/G/g, "B");
  return row;
});
SIL[7] = "..rHHHHHHHHHHHHo..";
const FACE = [];
FRONT.forEach((row, j) => {
  if (j < 5 || j > 12) return;
  for (let i = 0; i < row.length; i++) if ("SLG".includes(row[i])) FACE.push([i, j, row[i]]);
});

const BACK = SIL.map((row, j) => {
  if (j === 4) return FRONT[4];
  if (j === 20) return ".......WWWW.......";
  if (j === 21) return "......WwWwWw......";
  return row;
});

const SIDE = [
  "........rrrrrr........",
  "......rrHHHHHHrr......",
  ".....rHHHHHHHHHHr.....",
  "....rHHHHHHHHHHHHr....",
  "...rSSSSSSSSSSSSSSr...",
  "...rHHHHHHHHHSLLLSr...",
  "...rHHHHHHHHHSLGLSGG..",
  "...rHHHHHHHHHHSSSHGr..",
  "...rBBBBBBBBBBBBBBGr..",
  "..rBBBBBBBBBBBBBBGGr..",
  "..rBBBBBBBBBBBBBBGGr..",
  ".rBBBBBBBBBBBBBBBBGr..",
  ".rBBBBBBBBBBBBBBBDDr..",
  "rBBBBBBBBBBBBBBBDDDr..",
  "rBBBBBBBBBBBBBBBDDDr..",
  "rBBBBBBBBBBBBBBDDDr...",
  ".rBBBBBBBBBBBBBDDr....",
  "wrBBBBBBBBBBBBBBr.....",
  "WWrBBBBBBBBBBBBr......",
  "WWWrrBBBBBBBBrr.......",
  ".ww...FFFF.FFFF.......",
  ".......F.F..F.F.......",
];

// Left wings; the right one is mirrored. `at` is the wing row at the shoulder.
const WINGS = {
  up: { at: 7, rows: [".w.w.....", "wWwWw....", "WWWWWr...", ".WWWWWr..", "..WWWWWr.", "...WWWWWW", "....WWWWW", ".....WWWW"] },
  mid: { at: 2, rows: [".....rrrrW", "..rrWWWWWW", "rWWWWWWWWW", "wWwWwWWWWW", ".w.w.wwWWW"] },
  down: { at: 0, rows: [".....WWWW", "....WWWWW", "...WWWWWr", "..wWWWWr.", ".wWwWWr..", "wWwWw....", ".w.w....."] },
};
export const STROKE = ["up", "mid", "down", "mid"];

// A tap makes him smile with his eyes alone: the lids drop halfway
// ("squint"), then close into crescents lifted at the inner corners, as
// if his cheeks pushed them up ("smile"). Rows are [left lens, right lens]
// interiors in FRONT coordinates.
const lens = (l, r) => [[3, l], [11, r]].flatMap(([x0, rows]) => rows.flatMap((row, j) => [...row].map((c, i) => [x0 + i, 5 + j, c])));
const MOODS = {
  squint: lens(["LLLL", "LGGL"], ["LLLL", "LGGL"]),
  smile: lens(["LLLG", "GGGL"], ["GLLL", "LGGG"]),
};

export const GRID_W = 40, GRID_H = 30;
const BX = 11, BY = 4; // the 18-wide body's top-left inside the grid

function stamp(g, rows, x, y, mirror = false, swap = {}) {
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      let c = mirror ? row[row.length - 1 - i] : row[i];
      c = swap[c] || c;
      if (c !== "." && g[y + j] && x + i >= 0 && x + i < GRID_W) g[y + j][x + i] = c;
    }
  });
}

// Facing from a smoothed heading; yaw and pitch run -1..1 (pitch < 0 is up).
// `prev` gives the side and back views a little hysteresis.
export function pose(yaw, pitch, prev = "front") {
  const ay = Math.abs(yaw);
  let view = "front";
  if (ay > 0.75 || (prev === "side" && ay > 0.55)) view = "side";
  else if ((pitch < -0.6 && ay < 0.35) || (prev === "back" && pitch < -0.4 && ay < 0.5)) view = "back";
  const clamp = (v, n) => Math.max(-n, Math.min(n, Math.round(v)));
  return {
    view,
    dx: view === "front" ? clamp(yaw * 3, 3) : 0,
    dy: view === "front" ? clamp(pitch * 1.5, 1) : 0,
    mirror: yaw < 0,
    trim: view === "front" ? Math.round(ay * 3) : 0,
  };
}

export function compose({ view, dx, dy, mirror, trim }, wing, blink, mood = null) {
  const g = Array.from({ length: GRID_H }, () => Array(GRID_W).fill("."));
  const { at, rows } = WINGS[wing];
  const wy = BY + 10 - at;

  if (view === "side") {
    // Built facing right, then mirrored whole for the left.
    stamp(g, SIDE, BX - 2, BY);
    if (blink) g[BY + 6][BX - 2 + 15] = "L";
    // The near wing, a shade lighter so it reads against his body.
    stamp(g, rows, BX - 2 + 8 - rows[0].length, wy - 1, false, { W: "D" });
    return mirror ? g.map((row) => row.reverse()) : g;
  }

  // The wing on the side he turns toward is the far one, so it's shorter.
  const cut = (far) => (far ? rows.map((r) => r.slice(trim)) : rows);
  const left = cut(trim && dx < 0), right = cut(trim && dx > 0);
  stamp(g, left, BX + 1 - left[0].length, wy);
  stamp(g, right, BX + 17, wy, true);

  if (view === "back") {
    stamp(g, BACK, BX, BY);
    return g;
  }
  stamp(g, SIL, BX, BY);
  for (let i = 1; i <= 16; i++) g[BY + 4 + dy][BX + i] = "S"; // the band wraps the head
  for (const [i, j, c] of FACE) {
    const x = BX + i + dx, y = BY + j + dy;
    if ("HBD".includes(g[y][x])) g[y][x] = blink && !mood && c === "G" && j === 5 ? "L" : c;
  }
  for (const [i, j, c] of MOODS[mood] || []) {
    const x = BX + i + dx, y = BY + j + dy;
    if ("HBDLGS".includes(g[y][x])) g[y][x] = c;
  }
  return g;
}

/* Light one composed frame. sx, sy point from the bird toward the sun
 * (unit vector); heat (0..1) is how close he is to it. Each outline
 * pixel catches sun by how much it faces the sun, cooler sky light from
 * above, and the pixels just inside a lit edge pick up a little warmth.
 * Returns a grid of CSS colours ("" for empty). */
const hex = (c) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
const RGB = Object.fromEntries(Object.entries(PAL).map(([k, v]) => [k, hex(v)]));
const SUN = hex("#f0972a"), HOT = hex("#fcce37"), SKY = hex("#8f8a7c");
const mix = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
const css = ([r, g, b]) => `rgb(${r | 0},${g | 0},${b | 0})`;

export function shade(g, sx, sy, heat) {
  const cx = GRID_W / 2, cy = GRID_H / 2;
  const glow = g.map(() => Array(GRID_W).fill(0));
  const out = g.map((row, j) => row.map((c, i) => {
    if (!RGB[c]) return "";
    if (c !== "r") return null;
    const nx = i + 0.5 - cx, ny = j + 0.5 - cy, len = Math.hypot(nx, ny) || 1;
    const facing = Math.max(0, (nx * sx + ny * sy) / len);
    const sun = facing ** 1.5 * (0.35 + 0.65 * heat);
    const sky = Math.max(0, -ny / len) * 0.25;
    glow[j][i] = sun;
    const lit = mix(mix(RGB.r, SKY, sky), mix(SUN, HOT, heat * facing), sun);
    return css(lit);
  }));
  return out.map((row, j) => row.map((v, i) => {
    if (v !== null) return v;
    const near = Math.max(glow[j - 1]?.[i] || 0, glow[j + 1]?.[i] || 0, glow[j][i - 1] || 0, glow[j][i + 1] || 0);
    return css(near ? mix(RGB[g[j][i]], SUN, near * 0.18) : RGB[g[j][i]]);
  }));
}
