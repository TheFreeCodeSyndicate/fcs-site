/* ------------------------------------------------------------------
 * Footer sky: a dotted Icarus scene under the footer. Daedalus's
 * tower on a cliff, a striped sun setting into a dotted sea, drifting
 * clouds, and the club's bird in his glasses, who flies in bursts of
 * wingbeats and glides, and drifts over to the pointer. One canvas;
 * it stops drawing while off screen and holds a single still frame
 * under prefers-reduced-motion.
 * ---------------------------------------------------------------- */
import { pose, compose, shade, STROKE, GRID_W, GRID_H } from "./lib/bird.js";

(() => {
  const canvas = document.getElementById("footer-sky");
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  const still = matchMedia("(prefers-reduced-motion: reduce)");

  const Y = "#fcce37", O = "#f0972a", C = "#fff7e4";
  const S = 9; // dot grid pitch, CSS px
  const GULL = [[[-6, 0], [-4, -2], [-2, -2], [0, 0], [2, -2], [4, -2], [6, 0]],
                [[-6, -2], [-4, -2], [-2, 0], [0, 0], [2, 0], [4, -2], [6, -2]]];

  const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  const bayer = (i, j) => (BAYER[j & 3][i & 3] + 0.5) / 16;
  const hash = (a, b, c = 0) => {
    let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const noise = (x, y) =>
    (Math.sin(x * 0.013 + y * 0.021) + Math.sin(x * 0.031 - y * 0.017 + 2) + Math.sin(x * 0.007 + y * 0.043 + 4)) / 6 + 0.5;

  let w = 0, h = 0, dpr = 1, horizon = 0, sun, cliffW, tower, px, sc;
  let base, stars = [], clouds = [], gulls = [];
  // pos/vel: a damped spring chasing `aim`, which itself eases toward the
  // pointer (or a slow wander), so he never starts or stops abruptly.
  let smileAt = -1e9;
  const smileAge = () => (performance.now() - smileAt) / 1000;
  const smiling = () => smileAge() < 1.62;
  const mood = () => {
    const s = smileAge();
    return s < 0.12 || (s > 1.5 && s < 1.62) ? "squint" : s < 1.5 ? "smile" : null;
  };
  const hitBird = (x, y) => Math.abs(x - bird.x) < 10 * px && Math.abs(y - bird.y) < 12 * px;
  const sprite = Object.assign(document.createElement("canvas"), { width: GRID_W, height: GRID_H });
  const bird = { x: 0, y: 0, vx: 0, vy: 0, aim: null, rest: null, beat: 0, beats: 4, glideUntil: 0, alt: 0, blinkAt: 2, yaw: 0, pitch: 0, view: "front" };
  let pointer = null, t = 0, last = 0, raf = 0, visible = false;

  function dot(g, x, y, s, color, a = 1) {
    g.globalAlpha = a;
    g.fillStyle = color;
    g.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
  }

  // Every grid point in a box; odd rows sit half a step over (hex dots).
  function eachCell(x0, y0, x1, y1, fn) {
    for (let j = Math.max(0, Math.floor(y0 / S)); j * S < Math.min(y1, h); j++) {
      const off = j & 1 ? S / 2 : 0;
      for (let i = Math.max(0, Math.floor((x0 - off) / S)); i * S + off < Math.min(x1, w); i++) {
        fn(i * S + off + S / 2, j * S + S / 2, i, j);
      }
    }
  }

  const cliffTop = (x) =>
    x > cliffW ? Infinity : horizon - h * 0.08 - h * 0.31 * Math.max(0, 1 - (x / cliffW) ** 1.6) + 10 * Math.sin(x * 0.05);

  function inTower(x, y) {
    if (x < tower.x0 || x > tower.x1 || y < tower.top || y > tower.base) return false;
    return y > tower.top + 14 || Math.floor((x - tower.x0) / 12) % 2 === 0; // crenellations
  }

  function islandTop(x) {
    if (x > w * 0.35 && x < w * 0.53) return horizon - 18 * sc * Math.max(0, Math.sin(((x - w * 0.35) / (w * 0.18)) * Math.PI));
    if (x > w * 0.87) return horizon - 26 * sc * Math.max(0, Math.sin(((x - w * 0.87) / (w * 0.2)) * Math.PI));
    return horizon;
  }

  // Everything that never moves, drawn once per resize.
  function buildBase() {
    base = document.createElement("canvas");
    base.width = canvas.width;
    base.height = canvas.height;
    const g = base.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bands = Array.from({ length: 7 }, (_, i) =>
      [sun.y - sun.r * 0.5 + i * sun.r * (0.106 + i * 0.03), sun.r * (0.012 + i * 0.012)]);

    eachCell(0, 0, w, horizon, (x, y, i, j) => {
      const ct = cliffTop(x);
      if (inTower(x, y)) {
        const win = Math.abs(x - tower.cx) < 10 && y > tower.top + tower.hgt * 0.27 && y < tower.top + tower.hgt * 0.43;
        if (win) dot(g, x, y, 4, Y);
        else if (bayer(i, j) < 0.8) dot(g, x, y, 3, C, 0.3);
        return;
      }
      if (y >= ct) {
        const n = noise(x, y);
        if (y - ct < 14) dot(g, x, y, 3, O, 0.75); // sunlit rim
        else if (bayer(i, j) < 0.55 + 0.3 * n) dot(g, x, y, 3, C, 0.16 + 0.12 * n);
        return;
      }
      if (y >= islandTop(x)) {
        if (bayer(i, j) < 0.6) dot(g, x, y, 2, C, 0.22);
        return;
      }
      const ds = Math.hypot(x - sun.x, y - sun.y);
      if (ds < sun.r) {
        if (bands.some(([by, bt]) => Math.abs(y - by) <= bt)) return;
        dot(g, x, y, ds < sun.r - 6 ? 5 : 3, y < sun.y - sun.r * 0.35 ? Y : O);
      } else if (ds < sun.r * 1.5) {
        const ring = (ds - sun.r) / (sun.r * 0.5);
        if (bayer(i, j) < 0.3 * (1 - ring) ** 2) dot(g, x, y, 2, Y, 0.85 - ring * 0.55);
      }
    });
  }

  function layout() {
    const box = canvas.getBoundingClientRect();
    w = box.width;
    h = box.height;
    if (!w || !h) return false;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    sc = h / 490;
    px = w < 700 ? 3 : 4;
    horizon = Math.round((h * 0.76) / S) * S;
    sun = { x: w * 0.74, y: horizon - h * 0.04, r: Math.min(h * 0.35, w * 0.16) };
    cliffW = Math.min(w * 0.33, 540);
    const tcx = cliffW * 0.32, tb = cliffTop(tcx);
    tower = { cx: tcx, x0: tcx - 30 * Math.min(1, sc), x1: tcx + 30 * Math.min(1, sc), base: tb, hgt: h * 0.3, top: tb - h * 0.3 };
    buildBase();

    stars = [];
    eachCell(0, 0, w, horizon, (x, y, i, j) => {
      if (y >= cliffTop(x) || inTower(x, y) || Math.hypot(x - sun.x, y - sun.y) < sun.r * 1.5) return;
      if (hash(i, j) < 0.035 * (1 - y / horizon) ** 1.5) {
        stars.push({ x, y, s: hash(i, j, 1) < 0.25 ? 3 : 2, a: [0.25, 0.4, 0.6][Math.floor(hash(i, j, 2) * 3)], ph: hash(i, j, 3) * 6.28 });
      }
    });
    for (const [fx, fy] of [[0.26, 0.07], [0.47, 0.04], [0.94, 0.49], [0.06, 0.1], [0.63, 0.08]]) {
      stars.push({ x: fx * w, y: fy * h + 8, s: 3, a: 1, ph: fx * 9, bright: true });
    }

    const parts = [
      [[0, 0, 80], [80, 10, 60], [-70, 15, 50], [150, 25, 40]],
      [[0, 0, 70], [90, -5, 60], [170, 10, 45], [-60, 10, 40]],
      [[0, 0, 35], [45, 5, 28], [-35, 8, 22]],
      [[0, 0, 40], [50, 8, 30]],
    ];
    clouds = [[0.2, 0.18, 6], [0.66, 0.35, 4], [0.39, 0.14, 9], [0.91, 0.14, 7]].map(([cx, cy, v], k) =>
      ({ x: cx * w, y: cy * h, v, parts: parts[k].map(([dx, dy, r]) => [dx * sc, dy * sc, r * sc]) }));

    gulls = [[0.52, 0.25, 14], [0.54, 0.22, 14], [0.86, 0.02, 10]].map(([gx, gy, v], k) => ({ x: gx * w, y: gy * h + 12, v, ph: k }));
    if (!bird.aim) {
      Object.assign(bird, home());
      bird.aim = home();
      bird.rest = home();
    }
    return true;
  }

  const home = () => ({ x: w * 0.47, y: h * 0.33 });

  function cloudValue(c, x, y) {
    let v = 0;
    for (const [dx, dy, r] of c.parts) {
      const d = Math.hypot(x - c.x - dx, (y - c.y - dy) * (y < c.y + dy ? 1.6 : 4)); // flat bottoms
      v = Math.max(v, 1 - d / r);
    }
    return v;
  }

  function drawBird(cx, cy, wing, blink, mood) {
    const p = pose(bird.yaw, bird.pitch, bird.view);
    bird.view = p.view;
    // Sunlight: from the bird toward the sun, stronger the closer he flies.
    const dx = sun.x - cx, dy = sun.y - cy, d = Math.hypot(dx, dy) || 1;
    const heat = Math.max(0, 1 - d / (w * 0.7));
    const colors = shade(compose(p, wing, blink, p.view === "front" ? mood : null), dx / d, dy / d, heat);
    // Paint one pixel per cell, then scale up once in device pixels. Cell
    // by cell at a fractional devicePixelRatio (125% scaling) leaves
    // anti-aliased seams that let the sky show through his body.
    const sg = sprite.getContext("2d");
    sg.clearRect(0, 0, GRID_W, GRID_H);
    colors.forEach((row, j) => row.forEach((c, i) => {
      if (c) { sg.fillStyle = c; sg.fillRect(i, j, 1, 1); }
    }));
    const x0 = Math.round((cx - (GRID_W / 2) * px) * dpr), y0 = Math.round((cy - (GRID_H / 2) * px) * dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprite, x0, y0, Math.round(GRID_W * px * dpr), Math.round(GRID_H * px * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function step(dt) {
    t += dt;
    for (const c of clouds) {
      c.x += c.v * dt;
      if (c.x - 150 * sc > w) c.x = -250 * sc;
    }
    for (const g of gulls) {
      g.x += g.v * dt;
      if (g.x > w + 20) g.x = -20;
    }
    // Aim eases toward the pointer, or toward a slow wander around the
    // spot where he was left, which itself drifts back home.
    const ease = (rate) => 1 - Math.exp(-dt * rate);
    const hm = home();
    bird.rest.x += (hm.x - bird.rest.x) * ease(0.15);
    bird.rest.y += (hm.y - bird.rest.y) * ease(0.15);
    const want = pointer
      ? { x: pointer.x, y: pointer.y - 12 * px }
      : { x: bird.rest.x + Math.sin(t * 0.27) * w * 0.03, y: bird.rest.y + Math.sin(t * 0.41) * h * 0.03 };
    want.x = Math.min(Math.max(want.x, 20 * px), w - 20 * px);
    want.y = Math.min(Math.max(want.y, 14 * px), horizon - 12 * px);
    bird.aim.x += (want.x - bird.aim.x) * ease(0.55);
    bird.aim.y += (want.y - bird.aim.y) * ease(0.55);
    bird.vx += ((bird.aim.x - bird.x) * 1.2 - bird.vx * 2) * dt;
    bird.vy += ((bird.aim.y - bird.y) * 1.2 - bird.vy * 2) * dt;
    const speed = Math.hypot(bird.vx, bird.vy);
    if (speed > 110) { bird.vx *= 110 / speed; bird.vy *= 110 / speed; }
    bird.x += bird.vx * dt;
    bird.y += bird.vy * dt;

    // He turns to face where he's heading, gradually; nearly still means
    // facing the reader.
    // While smiling he turns to face you.
    const turn = (v) => (speed < 12 || smiling() ? 0 : Math.max(-1, Math.min(1, v / 80)));
    bird.yaw += (turn(bird.vx) - bird.yaw) * ease(2.5);
    bird.pitch += (turn(bird.vy) - bird.pitch) * ease(2.5);

    // Wingbeats come in bursts, then a glide. Faster flight or climbing
    // keeps him flapping; gliding lets him sink a little.
    const working = speed > 50 || bird.vy < -30;
    if (t < bird.glideUntil && !working) {
      bird.alt = Math.min(6, bird.alt + 5 * dt);
    } else {
      bird.beat += dt * (working ? 3.6 : 2.8);
      bird.alt = Math.max(-4, bird.alt - 9 * dt);
      if (bird.beat >= bird.beats && !working) {
        bird.beat = 0;
        bird.beats = 3 + Math.floor(Math.random() * 3);
        bird.glideUntil = t + 0.8 + Math.random() * 1.4;
      }
    }
    if (t > bird.blinkAt + 0.14) bird.blinkAt = t + 2.5 + Math.random() * 3;
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    for (const s of stars) {
      const a = s.a * (0.65 + 0.35 * Math.sin(t * 1.3 + s.ph));
      dot(ctx, s.x, s.y, s.s, C, a);
      if (s.bright) for (const [dx, dy] of [[-4, 0], [4, 0], [0, -4], [0, 4]]) dot(ctx, s.x + dx, s.y + dy, 1, C, a * 0.6);
    }

    for (const c of clouds) {
      const xs = c.parts.flatMap(([dx, , r]) => [c.x + dx - r, c.x + dx + r]);
      const ys = c.parts.flatMap(([, dy, r]) => [c.y + dy - r, c.y + dy + r]);
      eachCell(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.min(Math.max(...ys), horizon), (x, y, i, j) => {
        const v = cloudValue(c, x, y);
        if (v <= 0 || bayer(i, j) >= v * 2.4) return;
        ctx.clearRect(x - S / 2, y - S / 2, S, S); // hide the sun behind it
        dot(ctx, x, y, v > 0.25 ? 3 : 2, C, 0.55 + 0.45 * v);
      });
    }

    // Sea: rolling rows, with the sun's broken reflection.
    const shimmer = Math.floor(t * 5);
    eachCell(0, horizon, w, h, (x, y, i, j) => {
      const wave = Math.sin(x * 0.035 + y * 0.4 - t * 1.2) * 0.5 + 0.5;
      const refl = Math.max(0, 1 - Math.abs(x - sun.x) / (sun.r * 0.55 + (y - horizon) * 1.2));
      if (refl > 0.15 && wave > 0.35 && hash(i, j, shimmer) < 0.7) dot(ctx, x, y, 2 + Math.round(refl * 3), refl > 0.5 ? Y : O);
      else if (wave > 0.72) dot(ctx, x, y, 2, C, 0.22 + (0.25 * (y - horizon)) / (h - horizon));
    });

    for (const g of gulls) {
      const frame = GULL[Math.floor(t * 3 + g.ph) % 2];
      for (const [a, b] of frame) dot(ctx, g.x + a + 1, g.y + b + 1, 2, C, 0.7);
    }

    const gliding = still.matches || (t < bird.glideUntil && bird.beat === 0);
    const stroke = gliding ? "mid" : STROKE[Math.floor((bird.beat % 1) * 4)];
    const lift = gliding ? Math.sin(t * 1.2) * 2 : { up: 2, mid: 0, down: -2 }[stroke];
    drawBird(bird.x, bird.y + bird.alt + lift, stroke, t > bird.blinkAt, mood());
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    if (now - last >= 33) { // about 30fps is plenty for dots
      last = now;
      step(dt);
      draw();
    }
    if (visible && !still.matches) raf = requestAnimationFrame(frame);
  }

  function restart() {
    if (!layout()) return;
    draw();
    if (visible && !still.matches && !raf) raf = requestAnimationFrame((now) => { last = now; frame(now); });
  }

  const track = (e) => {
    canvas.style.cursor = hitBird(e.offsetX, e.offsetY) ? "pointer" : "";
    if (!still.matches) pointer = { x: e.offsetX, y: e.offsetY };
  };
  // A tap makes him smile with his eyes (see MOODS in lib/bird.js), with a
  // little hop and a few wingbeats.
  canvas.addEventListener("click", (e) => {
    if (!hitBird(e.offsetX, e.offsetY)) return;
    smileAt = performance.now();
    if (still.matches) {
      for (const ms of [0, 120, 1500, 1620]) setTimeout(draw, ms);
      return;
    }
    bird.vy = Math.min(bird.vy, -70);
    bird.glideUntil = 0;
    bird.beat = 0;
    bird.beats = 2;
  });
  canvas.addEventListener("pointermove", track);
  canvas.addEventListener("pointerdown", track);
  canvas.addEventListener("pointerleave", () => {
    pointer = null;
    bird.rest = { x: bird.x, y: bird.y };
  });

  new ResizeObserver(restart).observe(canvas);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; restart(); }).observe(canvas);
  }
  still.addEventListener("change", restart);
})();
