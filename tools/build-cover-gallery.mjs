/*
 * tools/build-cover-gallery.mjs
 * ------------------------------------------------------------------
 * The cover picker's Gallery (js/blog-editor.js), as in Notion: colours
 * and gradients, textures, and public-domain art and space photography.
 * Run by hand when the gallery should change; the output is committed:
 *
 *   node tools/build-cover-gallery.mjs
 *
 * Writes assets/covers/*.svg (colours, gradients and textures, drawn
 * here) and assets/cover-gallery.json (every category, with each image's
 * credit). Museum and NASA images are public domain and stay on their
 * own servers: The Met's Open Access collection (CC0) and NASA's Image
 * and Video Library. No keys needed.
 * ------------------------------------------------------------------
 */
import { mkdirSync, writeFileSync } from "node:fs";

const W = 1600;
const H = 640;
const svg = (body, defs = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"><defs>${defs}</defs>${body}</svg>\n`;

/* ---- colours and gradients (Notion's set, plus the brand's yellow and ink) */
const solid = (c) => svg(`<rect width="${W}" height="${H}" fill="${c}"/>`);
const linear = (stops, angle = 0) => svg(`<rect width="${W}" height="${H}" fill="url(#g)"/>`,
  `<linearGradient id="g" gradientTransform="rotate(${angle} .5 .5)">${stops.map((c, i) => `<stop offset="${i / (stops.length - 1)}" stop-color="${c}"/>`).join("")}</linearGradient>`);
const mesh = (base, blobs) => svg(`<rect width="${W}" height="${H}" fill="${base}"/>${blobs.map((b, i) => `<rect width="${W}" height="${H}" fill="url(#r${i})"/>`).join("")}`,
  blobs.map(([c, x, y, r], i) => `<radialGradient id="r${i}" cx="${x}" cy="${y}" r="${r}"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`).join(""));

const COLORS = [
  ["Red", solid("#e16259")],
  ["Yellow", solid("#fcce37")],
  ["Blue", solid("#1fa0d8")],
  ["Cream", solid("#fff1e6")],
  ["Ink", solid("#0f0e0b")],
  ["Lagoon", linear(["#3ec6c6", "#e8d3b0"], 90)],
  ["Pink", linear(["#ff3e9a", "#ff2d7a"], 45)],
  ["Ember", linear(["#e55c3c", "#ff1d00"], 20)],
  ["Pastel", mesh("#f3d9cf", [["#f29c8b", 0.2, 0.25, 0.6], ["#9bdbe4", 0.85, 0.8, 0.7]])],
  ["Dusk", mesh("#3b4fa3", [["#1e86c8", 0.15, 0.1, 0.6], ["#e2402b", 0.85, 0.85, 0.7], ["#f2a6d2", 0.05, 0.95, 0.5]])],
  ["Orchid", linear(["#7a3ad8", "#ee3d7a"], 30)],
  ["Harbour", linear(["#2d4f7c", "#e3a98a"], 70)],
  ["Syndicate", mesh("#fcce37", [["#fff7e4", 0.2, 0.2, 0.7], ["#d9730d", 0.9, 0.9, 0.6]])],
];

/* ---- textures: SVG noise (feTurbulence), tinted ---------------------------- */
const texture = (base, ink, { freq = 0.9, octaves = 3, opacity = 0.35, seed = 1, type = "fractalNoise" } = {}) =>
  svg(`<rect width="${W}" height="${H}" fill="${base}"/><rect width="${W}" height="${H}" filter="url(#n)" opacity="${opacity}"/>`,
    `<filter id="n" x="0" y="0" width="100%" height="100%"><feTurbulence type="${type}" baseFrequency="${freq}" numOctaves="${octaves}" seed="${seed}" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 ${ink[0]} 0 0 0 0 ${ink[1]} 0 0 0 0 ${ink[2]} 0 0 0 1.2 -0.25"/></filter>`);
const dots = (base, dot) => svg(`<rect width="${W}" height="${H}" fill="${base}"/><rect width="${W}" height="${H}" fill="url(#d)"/>`,
  `<pattern id="d" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="11" cy="11" r="1.6" fill="${dot}"/></pattern>`);

const TEXTURES = [
  ["Paper", texture("#f4ecd8", [0.35, 0.28, 0.18], { freq: 0.75, opacity: 0.45 })],
  ["Sand", texture("#c9a77a", [0.35, 0.24, 0.14], { freq: 0.55, seed: 4, opacity: 0.55 })],
  ["Concrete", texture("#8f9192", [0.15, 0.15, 0.16], { freq: 0.35, octaves: 5, seed: 7, opacity: 0.6 })],
  ["Slate", texture("#3d4b5c", [0.05, 0.08, 0.12], { freq: 0.25, octaves: 5, seed: 9, opacity: 0.7 })],
  ["Rust", texture("#8c4a2f", [0.25, 0.1, 0.04], { freq: 0.12, octaves: 6, seed: 3, opacity: 0.75 })],
  ["Moss", texture("#59684a", [0.12, 0.18, 0.08], { freq: 0.18, octaves: 6, seed: 12, opacity: 0.65 })],
  ["Marble", texture("#ecebe7", [0.45, 0.45, 0.5], { freq: 0.012, octaves: 5, seed: 21, opacity: 0.5, type: "turbulence" })],
  ["Icarus sky", dots("#0f0e0b", "#fcce37")],
];

mkdirSync("assets/covers", { recursive: true });
const local = (prefix, list) => list.map(([title, body]) => {
  const file = `assets/covers/${prefix}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.svg`;
  writeFileSync(file, body);
  return { title, url: file, thumb: file };
});

/* ---- public-domain photography and art ----------------------------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The Met's API turns away bursts (403): one request at a time, paced, retried after a pause.
async function getJSON(url, tries = 4) {
  for (let i = 0; ; i++) {
    await sleep(250);
    const res = await fetch(url, { headers: { "User-Agent": "fcs-site cover gallery (github.com/TheFreeCodeSyndicate/fcs-site)" } });
    if (res.ok) return res.json();
    if (i >= tries || ![403, 429, 503].includes(res.status)) throw new Error(`${url} -> ${res.status}`);
    await sleep(8000 * (i + 1));
  }
}

async function met(q, keep, n = 12) {
  const { objectIDs = [] } = await getJSON(`https://collectionapi.metmuseum.org/public/collection/v1.1/search?hasImages=true&q=${encodeURIComponent(q)}&limit=120`);
  const items = [];
  for (const id of objectIDs) {
    if (items.length >= n) break;
    const o = await getJSON(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`).catch(() => null);
    if (!o || !o.isPublicDomain || !o.primaryImageSmall || !keep(o)) continue;
    items.push({
      title: `${o.title}${o.artistDisplayName ? `, ${o.artistDisplayName}` : ""}${o.objectDate ? ` (${o.objectDate})` : ""}`,
      url: o.primaryImageSmall,
      thumb: o.primaryImageSmall.replace("/web-large/", "/mobile-large/"),
      link: o.objectURL,
    });
  }
  return items;
}

const NOT_PHOTOS = /poster|logo|graphic|infographic|chart|diagram|illustration|patch|insignia|artist'?s concept|rendering|spectrum|graph|town hall|panel|portrait|briefing|conference|press|memorial|visit|wind tunnel|test subject|stereo|experiment|deployment|rollout|prelaunch|mirror|hangout|anniversary|visualization|KSC-\d/i;

/** NASA photographs for several searches, kept when the title reads like an image worth a cover, one per title. */
async function nasa(queries, include, n = 12) {
  const items = [];
  const seen = new Set();
  for (const q of queries) {
    const data = await getJSON(`https://images-api.nasa.gov/search?q=${encodeURIComponent(q)}&media_type=image`);
    for (const it of data.collection.items) {
      if (items.length >= n) return items;
      const d = it.data[0];
      const thumb = it.links && it.links[0] && it.links[0].href;
      const key = d.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 28);
      if (!thumb || seen.has(key) || NOT_PHOTOS.test(d.title) || !include.test(d.title)) continue;
      seen.add(key);
      const large = thumb.replace(/~(thumb|small|medium)\./, "~large.");
      const ok = await fetch(large, { method: "HEAD" }).then((r) => r.ok).catch(() => false);
      items.push({ title: d.title, url: ok ? large : thumb, thumb, link: `https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id)}` });
    }
  }
  return items;
}

/* Webb's science images are published by ESA/Webb (CC BY 4.0, credit kept below);
 * NASA's library holds few of them. Picked by hand from esawebb.org releases. */
const WEBB = [
  ["weic2205a", "Cosmic Cliffs in Carina"], ["weic2216a", "Pillars of Creation"], ["weic2208a", "Stephan’s Quintet"],
  ["weic2209a", "Webb’s First Deep Field"], ["weic2211a", "Cartwheel Galaxy"], ["weic2212a", "Tarantula Nebula"],
  ["weic2214a", "Neptune"], ["weic2219a", "Protostar L1527"], ["weic2301a", "NGC 346"],
  ["weic2305a", "Pandora’s Cluster"], ["weic2316a", "Rho Ophiuchi"], ["weic2425a", "NGC 602"],
].map(([id, title]) => ({
  title: `${title} (ESA/Webb, NASA & CSA)`,
  url: `https://cdn.esawebb.org/archives/images/large/${id}.jpg`,
  thumb: `https://cdn.esawebb.org/archives/images/thumb300y/${id}.jpg`,
  link: `https://esawebb.org/images/${id}/`,
}));

const painting = (o) => /painting/i.test(o.objectName || "") || /paintings/i.test(o.classification || "");
const categories = [
  { name: "Color & Gradient", items: local("color", COLORS) },
  { name: "Textures", items: local("texture", TEXTURES) },
  { name: "James Webb Space Telescope", credit: "ESA/Webb, NASA & CSA (CC BY 4.0)", items: WEBB },
  { name: "NASA: Artemis", credit: "NASA (public domain)", items: await nasa(["Artemis Orion Earth", "Artemis I Moon", "Orion Moon flyby", "Artemis I launch", "Earthset Orion"], /earth|moon|orion|launch|lunar|crescent|home/i) },
  { name: "NASA Archives", credit: "NASA (public domain)", items: await nasa(["Earthrise Apollo 8", "Apollo 17 Blue Marble", "Apollo lunar surface", "Apollo 11 Earth", "Saturn V launch Apollo", "Gemini Earth"], /^(?!.*(artemis|orion|crew|astronaut|drill|map|plans|program)).*(apollo|gemini|saturn v|earthrise|blue marble)/i) },
  { name: "The Met: Hudson River School", credit: "The Metropolitan Museum of Art, Open Access (CC0)", items: await met("Hudson River School", painting) },
  { name: "The Met: Japanese Prints", credit: "The Metropolitan Museum of Art, Open Access (CC0)", items: await met("Hiroshige landscape", (o) => /print/i.test(`${o.objectName} ${o.classification}`)) },
  { name: "The Met: Asian Art", credit: "The Metropolitan Museum of Art, Open Access (CC0)", items: await met("landscape scroll", (o) => o.department === "Asian Art") },
];

writeFileSync("assets/cover-gallery.json", `${JSON.stringify(categories, null, 1)}\n`);
console.log(categories.map((c) => `${c.name}: ${c.items.length}`).join("\n"));
