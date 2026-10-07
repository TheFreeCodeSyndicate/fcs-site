/*
 * tools/og.mjs
 * ------------------------------------------------------------------
 * Link-preview images (Open Graph cards), 1200x630 JPEG, drawn at build
 * time by tools/blog-build.mjs: one per blog post, one for the blog and
 * one for the home page. satori lays the card out (flexbox, our fonts,
 * text as paths); sharp rasterises it and keeps it under ~300 KB, the
 * size WhatsApp still shows.
 *
 * The card is the site's own look: cream paper, black borders, hard
 * yellow shadows. A post's card puts its title, summary, authors and
 * date on the left and its cover on the right with the icon overlapping
 * it, as on the page. Without a cover, the post's tint and icon, large;
 * the home page's card has the club's mark on yellow.
 * ------------------------------------------------------------------
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import satori from "satori";
import sharp from "sharp";
import { twemojiURL, isEmoji } from "../js/lib/markdown.js";
import { SITE } from "../js/lib/blog-pages.js";

const require = createRequire(import.meta.url);
const font = (pkg, file) => readFileSync(require.resolve(`${pkg}/files/${file}`));
const FONTS = [
  ...[500, 600, 800].map((weight) => ({ name: "Archivo", weight, style: "normal", data: font("@fontsource/archivo", `archivo-latin-${weight}-normal.woff`) })),
  { name: "Fira Code", weight: 500, style: "normal", data: font("@fontsource/fira-code", "fira-code-latin-500-normal.woff") },
];

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
const C = { paper: "#FFF7E4", raised: "#FFFFFF", ink: "#000000", muted: "#5b5446", accent: "#fcce37" };
// The editor's icon colours and the cards' tints (style.css, light theme).
const ICON = { default: C.ink, gray: "#8b8a86", brown: "#9f6b53", orange: "#d9730d", yellow: "#cb912f", green: "#448361", blue: "#337ea9", purple: "#9065b0", pink: "#c14c8a", red: "#d44c47" };
const TINT = { yellow: "#fbf3db", orange: "#fbecdd", green: "#edf3ec", blue: "#e7f3f8", purple: "#f6f3f9", pink: "#faf1f5", red: "#fdebec", brown: "#f4eeee" };
const TINTS = Object.keys(TINT);

/** satori's element tree, without JSX. */
// One child goes in bare: satori treats any array as several children,
// which only a flex box may have.
const h = (type, style, ...children) => {
  const kids = children.flat().filter((c) => c !== null && c !== false && c !== "");
  return { type, props: { style, children: kids.length === 1 ? kids[0] : kids } };
};
const img = (src, style) => ({ type: "img", props: { src, width: style.width, height: style.height, style } });

const dataURI = (buf, type) => `data:${type};base64,${buf.toString("base64")}`;
const MARK = dataURI(await sharp("assets/fcs-mark.png").resize(160, 160, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(), "image/png");
const MARK_LARGE = dataURI(await sharp("assets/fcs-mark-large.png").resize(680, 680, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(), "image/png");
const SPRITE = readFileSync("assets/pixel-icons.svg", "utf8");

/** A remote image as a JPEG/PNG data URI at the size it is drawn, or null. */
async function fetchImage(url, width, height, { round = false } = {}) {
  try {
    // The site's own covers (assets/covers) are read from this checkout.
    const own = url.startsWith(SITE) ? readFileSync(url.slice(SITE.length)) : null;
    const res = own ? null : await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (res && !res.ok) return null;
    let pipe = sharp(own || Buffer.from(await res.arrayBuffer())).resize(width * 2, height * 2, { fit: "cover" });
    return round ? dataURI(await pipe.png().toBuffer(), "image/png") : dataURI(await pipe.jpeg({ quality: 82 }).toBuffer(), "image/jpeg");
  } catch {
    return null;
  }
}

/** A post's icon as an image source: a pixel icon from our sprite, a Twemoji, or an uploaded picture. */
async function iconSource(icon, size) {
  if (!icon) return null;
  const named = /^icon:([a-z0-9-]+)(?::([a-z]+))?$/.exec(icon);
  if (named) {
    const symbol = new RegExp(`<symbol id="p-${named[1]}" viewBox="([^"]+)">([\\s\\S]*?)</symbol>`).exec(SPRITE);
    if (!symbol) return null;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${symbol[1]}" fill="${ICON[named[2]] || ICON.default}">${symbol[2]}</svg>`;
    return dataURI(Buffer.from(svg), "image/svg+xml");
  }
  if (/^https:\/\//i.test(icon)) return fetchImage(icon, size, size, { round: true });
  if (isEmoji(icon)) {
    try {
      const res = await fetch(twemojiURL(icon), { signal: AbortSignal.timeout(15000) });
      return res.ok ? dataURI(Buffer.from(await res.arrayBuffer()), "image/svg+xml") : null;
    } catch {
      return null;
    }
  }
  return null;
}

const tintOf = (key) => {
  let hash = 0;
  for (const c of String(key || "")) hash = (hash * 31 + c.codePointAt(0)) >>> 0;
  return TINT[TINTS[hash % TINTS.length]];
};

/* ---- the pieces ------------------------------------------------------------ */

const brand = (section) =>
  h("div", { display: "flex", alignItems: "center", gap: 14 },
    img(MARK, { width: 56, height: 56 }),
    h("div", { display: "flex", fontFamily: "Fira Code", fontSize: 22, letterSpacing: 1, color: C.ink },
      "THE FREE CODE SYNDICATE",
      section ? h("span", { color: C.muted, marginLeft: 10 }, `/ ${section}`) : null));

/** Long titles get smaller type so three lines still fit. */
const titleSize = (text) => (text.length <= 34 ? 76 : text.length <= 60 ? 64 : 54);

const clamp = (lines) => ({ display: "block", lineClamp: lines, overflow: "hidden" });

/** Overlapping round avatars and the authors' names. */
function people(authors, avatars) {
  if (!authors.length) return null;
  const names = authors.length === 1 ? authors[0].name : authors.length === 2 ? `${authors[0].name} and ${authors[1].name}` : `${authors[0].name} and ${authors.length - 1} others`;
  return h("div", { display: "flex", alignItems: "center", gap: 16 },
    h("div", { display: "flex" },
      ...authors.slice(0, 3).map((a, i) =>
        avatars[i]
          ? img(avatars[i], { width: 56, height: 56, borderRadius: 28, border: `3px solid ${C.ink}`, marginLeft: i ? -12 : 0, objectFit: "cover" })
          : h("div", { display: "flex", alignItems: "center", justifyContent: "center", width: 56, height: 56, borderRadius: 28, border: `3px solid ${C.ink}`, marginLeft: i ? -12 : 0, background: C.accent, fontFamily: "Archivo", fontWeight: 800, fontSize: 18 },
              a.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase()))),
    h("div", { display: "flex", fontFamily: "Archivo", fontWeight: 600, fontSize: 28, color: C.ink, maxWidth: 420 }, names));
}

/** The right-hand panel: the cover with the icon over its corner, or the tint with the icon large. */
function panel({ cover, icon, tint, mark = false }) {
  const frame = { display: "flex", position: "relative", width: 420, height: 518, border: `4px solid ${C.ink}`, boxShadow: `14px 14px 0 ${C.accent}`, background: tint || C.raised };
  if (cover) {
    return h("div", frame,
      img(cover, { width: 412, height: 510, objectFit: "cover" }),
      icon ? h("div", { display: "flex", alignItems: "center", justifyContent: "center", position: "absolute", left: -34, bottom: 34, width: 112, height: 112, background: C.paper, border: `4px solid ${C.ink}`, boxShadow: `6px 6px 0 ${C.ink}` },
        img(icon, { width: 72, height: 72 })) : null);
  }
  if (mark) {
    return h("div", { ...frame, alignItems: "center", justifyContent: "center", background: C.accent, boxShadow: `14px 14px 0 ${C.ink}` },
      img(MARK_LARGE, { width: 340, height: 340 }));
  }
  return h("div", { ...frame, alignItems: "center", justifyContent: "center" },
    img(icon || MARK, { width: icon ? 200 : 240, height: icon ? 200 : 240 }));
}

const page = (...children) =>
  h("div", { display: "flex", width: OG_WIDTH, height: OG_HEIGHT, padding: "56px 72px 56px 64px", gap: 64, background: C.paper, fontFamily: "Archivo", color: C.ink }, ...children);

async function render(tree) {
  const svg = await satori(tree, { width: OG_WIDTH, height: OG_HEIGHT, fonts: FONTS });
  return sharp(Buffer.from(svg)).jpeg({ quality: 86, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer();
}

/* ---- the cards ------------------------------------------------------------- */

/** A post: { title, summary, authors: [{name, avatar}], date, minutes, cover, icon, slug }. */
export async function postCard(post) {
  const [cover, icon, ...avatars] = await Promise.all([
    post.cover ? fetchImage(post.cover, 412, 510) : null,
    iconSource(post.icon, 200),
    ...post.authors.slice(0, 3).map((a) => (a.avatar ? fetchImage(a.avatar, 56, 56, { round: true }) : null)),
  ]);
  const meta = [post.date, `${post.minutes} min read`].filter(Boolean).join("  ·  ");
  return render(page(
    h("div", { display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1, minWidth: 0 },
      brand("BLOG"),
      h("div", { display: "flex", flexDirection: "column", gap: 18 },
        h("div", { ...clamp(3), fontWeight: 800, fontSize: titleSize(post.title), lineHeight: 1.08, letterSpacing: -1.5 }, post.title),
        post.summary ? h("div", { ...clamp(2), fontWeight: 500, fontSize: 28, lineHeight: 1.35, color: C.muted }, post.summary) : null),
      h("div", { display: "flex", flexDirection: "column", gap: 14 },
        people(post.authors, avatars),
        h("div", { display: "flex", fontFamily: "Fira Code", fontSize: 24, color: C.muted }, meta))),
    panel({ cover, icon, tint: cover ? null : tintOf(post.slug) })));
}

/** The blog index and the home page: a headline, a line under it, a footer line, and the newest post's panel. */
export async function siteCard({ section, headline, accent, line, foot, latest, mark = false }) {
  const [cover, icon] = latest && !mark ? await Promise.all([latest.cover ? fetchImage(latest.cover, 412, 510) : null, iconSource(latest.icon, 200)]) : [null, null];
  return render(page(
    h("div", { display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1, minWidth: 0 },
      brand(section),
      h("div", { display: "flex", flexDirection: "column", gap: 20 },
        h("div", { display: "flex", flexDirection: "column", fontWeight: 800, fontSize: 70, lineHeight: 1.04, letterSpacing: -2 },
          h("div", { display: "flex" }, headline),
          accent ? h("div", { display: "flex", alignSelf: "flex-start", background: C.accent, padding: "0 12px", marginLeft: -12, marginTop: 6 }, accent) : null),
        line ? h("div", { ...clamp(2), fontWeight: 500, fontSize: 28, lineHeight: 1.35, color: C.muted }, line) : null),
      foot ? h("div", { display: "flex", fontFamily: "Fira Code", fontSize: 24, color: C.ink }, foot) : null),
    panel({ cover, icon, mark, tint: latest && !cover ? tintOf(latest.slug) : null })));
}
