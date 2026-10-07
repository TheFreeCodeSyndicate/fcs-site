/*
 * js/lib/markdown.js
 * ------------------------------------------------------------------
 * The blog's Markdown: parsed into blocks, written back from blocks,
 * and rendered to safe HTML. Shared by the admin's block editor (which
 * loads and saves posts through parseBlocks / serializeBlocks) and the
 * deploy-time page builder (renderMarkdown).
 *
 * Safety: text is always escaped, raw HTML never passes through, links
 * and images must be https://, math goes through KaTeX with its default
 * trust: false, code is escaped by highlight.js, and every attribute
 * value is checked against a fixed list before it reaches a class name.
 *
 * Blocks:
 *   # .. ####            headings (rendered h2-h5: the title is the h1)
 *   - item  1. item      lists; two spaces of indent per nesting level
 *   - [ ] / - [x]        to-dos
 *   > text               quote          > [!💡] then > text   callout
 *   +++ summary ... +++  toggle (holds blocks)
 *   ::: columns / ::: column / :::      columns (each holds blocks)
 *   ```lang ... ```      code           $$ ... $$             math
 *   ---                  divider        [[toc]]               table of contents
 *   ![caption](https://...)             image
 *   @[video](https://youtube...)        YouTube video
 *   @[bookmark](https://...)            link card
 *   | a | b |            table (first row is the header; :--: aligns)
 * Block attributes, at the end of a block's last line:
 *   {: align=center color=red bg=yellow}   text blocks
 *   {: list=a}  numbered lists   {: h=2}  toggle headings
 *   {: width=60 align=left}                images
 * Inline: **bold** *italic* ++underline++ ~~strike~~ ==highlight==
 *         `code` $math$ ^sup^ ~sub~ [link](https://...)
 *         {color=red}text{/}  {bg=yellow}text{/}  @[Name](https://...)
 *         @{2026-10-06} (a date), and \ escapes.
 * ------------------------------------------------------------------
 */
import katex from "../vendor/katex/katex.mjs";
import hljs from "../vendor/hljs/highlight.min.js";

export const escapeHTML = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* Notion's palette. Text colours and backgrounds share the names. */
export const COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];
const COLOR_RE = new RegExp(`^(${COLORS.join("|")})$`);

/* Emoji used as icons are drawn with Twemoji (CC-BY 4.0) from jsDelivr,
 * so they look the same on every system. The file name is the emoji's
 * code points; U+FE0F is dropped unless the emoji is a ZWJ sequence. */
const TWEMOJI = "https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/svg/";
export const isEmoji = (s) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(String(s || ""));
export function twemojiURL(emoji) {
  const s = String(emoji);
  const points = [...(s.includes("‍") ? s : s.replace(/️/g, ""))].map((c) => c.codePointAt(0).toString(16));
  return `${TWEMOJI}${points.join("-")}.svg`;
}
export const emojiHTML = (emoji, cls = "emoji") =>
  isEmoji(emoji)
    ? `<img class="${cls}" src="${twemojiURL(emoji)}" alt="${escapeHTML(emoji)}" draggable="false" />`
    : `<span class="${cls}">${escapeHTML(emoji)}</span>`;

/* ---- inline ---------------------------------------------------------- */

export function renderMath(tex, displayMode = false) {
  return katex.renderToString(String(tex), { displayMode, throwOnError: false, output: "htmlAndMathml" });
}

/* ---- mentions and bookmarks, as in Notion -------------------------------------
 * A person: a small avatar (their GitHub picture when the link is a GitHub
 * profile, else initials) and their name. Shared by the renderer and the
 * editor, so both draw the same pill. */
const MENTION_TINTS = ["#c78b1d", "#d9730d", "#448361", "#337ea9", "#9065b0", "#c14c8a", "#d44c47", "#9f6b53"];
const githubUser = (url) => (/^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/?$/.exec(url || "") || [])[1];
function mentionAvatar(name, url) {
  const user = githubUser(url);
  if (user) return `<img class="mention-avatar" src="https://github.com/${user}.png?size=40" alt="" loading="lazy" />`;
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.codePointAt(0)) >>> 0;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]).join("").toUpperCase() || "?";
  return `<span class="mention-avatar mention-initials" style="background: ${MENTION_TINTS[hash % MENTION_TINTS.length]}" aria-hidden="true">${escapeHTML(initials)}</span>`;
}
/** `name` arrives already HTML-escaped (it comes out of inline()). */
export function mentionHTML(name, url = "") {
  const inner = `${mentionAvatar(name, url)}<span class="mention-name">${name}</span>`;
  return /^https:\/\/\S+$/.test(url)
    ? `<a class="mention" href="${url}" target="_blank" rel="noopener">${inner}</a>`
    : `<span class="mention">${inner}</span>`;
}
export const dateMentionHTML = (iso) => `<time class="mention-date" datetime="${iso}"><span class="mention-at" aria-hidden="true">@</span>${dateText(iso)}</time>`;

/** A web bookmark card: title, description, favicon and address, and the
 * page's image on the right. `meta` ({ title, description, image }) comes
 * from the deploy (tools/link-meta.mjs) or, in the editor, from microlink;
 * without it the card shows the site's name. */
export function bookmarkHTML(url, meta = null) {
  let host = url;
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* keep the address */ }
  const m = meta || {};
  const safeImg = (u) => (/^https:\/\/\S+$/i.test(u || "") ? escapeHTML(u) : "");
  const image = safeImg(m.image);
  return `<a class="bookmark${image ? " has-image" : ""}" href="${escapeHTML(url)}" target="_blank" rel="noopener">
      <span class="bookmark-body">
        <strong class="bookmark-title">${escapeHTML(m.title || host)}</strong>
        ${m.description ? `<span class="bookmark-desc">${escapeHTML(m.description)}</span>` : ""}
        <span class="bookmark-url"><img class="bookmark-favicon" src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&amp;sz=32" alt="" width="16" height="16" loading="lazy" referrerpolicy="no-referrer" /><span>${escapeHTML(url)}</span></span>
      </span>
      ${image ? `<span class="bookmark-thumb"><img src="${image}" alt="" loading="lazy" referrerpolicy="no-referrer" /></span>` : ""}
    </a>`;
}

/** Every bookmark address in a post (inside toggles and columns too). */
export function bookmarkURLs(source) {
  const out = new Set();
  const walk = (blocks) => blocks.forEach((b) => {
    if (b.type === "bookmark" && b.url) out.add(b.url);
    if (b.children) walk(b.children);
    if (b.cols) b.cols.forEach(walk);
  });
  walk(parseBlocks(source || ""));
  return [...out];
}

export const dateText = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
};

const INLINE_TOKEN = /\\([\\`*_{}\[\]()#+\-.!|~=$>"^@:])|(`+)([\s\S]*?[^`])\2(?!`)|\$([^\s$](?:[^$]*?[^\s$])?)\$(?!\d)/g;
const SPAN_ATTRS = /\{((?:color|bg)=[a-z]+(?: (?:color|bg)=[a-z]+)?)\}([\s\S]+?)\{\/\}/g;

function spanClasses(attrs) {
  return attrs.split(" ").map((kv) => {
    const [k, v] = kv.split("=");
    return COLOR_RE.test(v) ? (k === "bg" ? `bg-${v}` : `c-${v}`) : "";
  }).filter(Boolean).join(" ");
}

/** One line (or a few, joined by \n) of inline Markdown -> HTML. */
export function inline(text) {
  const held = [];
  const hold = (html) => `\u0000${held.push(html) - 1}\u0000`;
  const raw = String(text || "").replace(/\u0000/g, "");
  let s = "";
  let last = 0;
  for (const m of raw.matchAll(INLINE_TOKEN)) {
    s += escapeHTML(raw.slice(last, m.index));
    if (m[1] != null) s += hold(escapeHTML(m[1]));
    else if (m[2] != null) s += hold(`<code>${escapeHTML(m[3].replace(/^ (.*) $/, "$1"))}</code>`);
    else s += hold(`<span class="math" data-tex="${escapeHTML(m[4])}">${renderMath(m[4])}</span>`);
    last = m.index + m[0].length;
  }
  s += escapeHTML(raw.slice(last));
  s = s
    .replace(/@\{(\d{4}-\d{2}-\d{2})\}/g, (_, d) => hold(dateMentionHTML(d)))
    .replace(/@\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, (_, name, url) => hold(mentionHTML(name, url)))
    .replace(/@\[([^\]]+)\](?!\()/g, (_, name) => hold(mentionHTML(name)))
    .replace(/!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1" loading="lazy" />')
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, (_, text, url) => `<a class="link" href="${url}" target="_blank" rel="noopener">${linkIconHTML(url)}${text}</a>`)
    .replace(SPAN_ATTRS, (_, attrs, inner) => {
      const cls = spanClasses(attrs);
      return cls ? `<span class="${cls}">${inner}</span>` : inner;
    })
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\+\+(.+?)\+\+/g, "<u>$1</u>")
    .replace(/~~(.+?)~~/g, "<s>$1</s>")
    .replace(/==(.+?)==/g, "<mark>$1</mark>")
    .replace(/\^([^\s^]+)\^/g, "<sup>$1</sup>")
    .replace(/~([^\s~]+)~/g, "<sub>$1</sub>")
    .replace(/\n/g, "<br />")
    // The icon and the link's first letter never part at a line break.
    .replace(/(<span class="link-icon" aria-hidden="true">(?:<img [^>]*>|<svg[\s\S]*?<\/svg>)<\/span>)(&[a-z0-9#]+;|[^<\s\u0000])/g, '<span class="link-lead">$1$2</span>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => held[i]);
}

const GITHUB_MARK = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17 5 18 5.3 18 5.3c.7 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3"/></svg>';

/** The site's icon before a link's text: GitHub's mark, else the site's
 * favicon (Google's favicon service; only the host name is sent).
 * `url` arrives HTML-escaped. */
export function linkIconHTML(url) {
  let host = "";
  try { host = new URL(url.replace(/&amp;/g, "&")).hostname.toLowerCase(); } catch { return ""; }
  const glyph = host === "github.com" || host.endsWith(".github.com")
    ? GITHUB_MARK
    : `<img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&amp;sz=32" alt="" width="16" height="16" loading="lazy" referrerpolicy="no-referrer" draggable="false" />`;
  return `<span class="link-icon" aria-hidden="true">${glyph}</span>`;
}

/** Inline Markdown -> plain text (titles, summaries, heading anchors). */
export function inlineText(text) {
  return String(text || "")
    .replace(/@\{(\d{4}-\d{2}-\d{2})\}/g, (_, d) => dateText(d))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\{(?:color|bg)=[a-z]+(?: (?:color|bg)=[a-z]+)?\}|\{\/\}/g, "")
    .replace(/\\(.)/g, "$1")
    .replace(/\*\*|~~|==|\+\+|[*`$^~]/g, "");
}

/* ---- block attributes ------------------------------------------------ */

const ATTR_OK = {
  align: /^(left|center|right|justify)$/,
  color: COLOR_RE,
  bg: COLOR_RE,
  list: /^(1|a|i)$/,
  h: /^[123]$/,
  width: /^(100|[1-9]\d)$/,
};
const ATTR_TAIL = /\s*(?<!\\)\{:([^{}]*)\}\s*$/;

/** "text {: align=center}" -> ["text", {align: "center"}] (unknown keys dropped). */
export function takeAttrs(line) {
  const m = ATTR_TAIL.exec(line);
  if (!m) return [line, null];
  const attrs = {};
  for (const kv of m[1].trim().split(/\s+/)) {
    const [k, v] = kv.split("=");
    if (ATTR_OK[k] && ATTR_OK[k].test(v || "")) attrs[k] = v;
  }
  return [line.slice(0, m.index), Object.keys(attrs).length ? attrs : null];
}

/* Defaults are left out: text aligns left, images centre, lists count 1, 2, 3. */
const attrsTail = (attrs, type) => {
  const plain = type === "image" ? "center" : "left";
  const kv = Object.entries(attrs || {}).filter(([k, v]) => v && ATTR_OK[k] && ATTR_OK[k].test(v) && !(k === "align" && v === plain) && !(k === "list" && v === "1"));
  return kv.length ? ` {: ${kv.map(([k, v]) => `${k}=${v}`).join(" ")}}` : "";
};

/** Classes and style for a rendered block's attributes. */
const blockAttrs = (attrs) => {
  if (!attrs) return "";
  const cls = [attrs.color && `c-${attrs.color}`, attrs.bg && `bg-${attrs.bg} has-bg`, attrs.align && attrs.align !== "left" && `align-${attrs.align}`].filter(Boolean);
  return cls.length ? ` class="${cls.join(" ")}"` : "";
};

/* ---- blocks ---------------------------------------------------------- */

const LIST = /^( *)(?:([-*])\s+\[( |x|X)\]|([-*])|(\d+)[.)])\s+(.*)$/;
const IMAGE = /^!\[((?:\\.|[^\]\\])*)\]\((https:\/\/[^\s)]+)\)\s*$/;
const EMBED = /^@\[(video|bookmark)\]\((https:\/\/[^\s)]+)\)\s*$/;
const TABLE_SEP = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/** Does this line start a block other than a paragraph? (Paragraph lines
 * that would, are written with a leading backslash.) */
export function startsBlock(line) {
  return /^(#{1,4}\s|>|\+\+\+|:::|```|\$\$|---+\s*$|\[\[toc\]\]\s*$|\|)/.test(line) ||
    LIST.test(line) || IMAGE.test(takeAttrs(line)[0]) || EMBED.test(line);
}

const splitRow = (line) => {
  const cells = [];
  let cell = "";
  const body = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\" && body[i + 1] === "|") { cell += "\\|"; i++; }
    else if (body[i] === "|") { cells.push(cell.trim()); cell = ""; }
    else cell += body[i];
  }
  cells.push(cell.trim());
  return cells;
};

const withAttrs = (block, attrs) => (attrs ? { ...block, attrs } : block);

export function parseBlocks(source) {
  const lines = String(source || "").replace(/\r\n?/g, "\n").split("\n");
  const root = [];
  // Each frame is the list blocks go into; toggles and columns push one.
  const stack = [{ list: root, kind: "root" }];
  const out = () => stack[stack.length - 1].list;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    let m;

    if (!line.trim()) { i++; continue; }

    if ((m = /^(`{3,})\s*([\w+#.-]*)\s*$/.exec(line))) {
      const fence = m[1];
      const code = [];
      for (i++; i < lines.length && !(lines[i].startsWith(fence) && !lines[i].slice(fence.length).trim()); i++) code.push(lines[i]);
      out().push({ type: "code", lang: m[2] || "", code: code.join("\n") });
      i++;
    } else if (/^\$\$/.test(line)) {
      const one = /^\$\$(.+)\$\$\s*$/.exec(line);
      if (one) { out().push({ type: "math", tex: one[1].trim() }); i++; continue; }
      const tex = [line.slice(2)];
      for (i++; i < lines.length && !/^\$\$\s*$/.test(lines[i]); i++) tex.push(lines[i]);
      out().push({ type: "math", tex: tex.join("\n").trim() });
      i++;
    } else if ((m = /^:::\s*(columns|column)?\s*$/.exec(line))) {
      const top = stack[stack.length - 1];
      if (m[1] === "columns") {
        const block = { type: "columns", cols: [[]] };
        out().push(block);
        stack.push({ list: block.cols[0], kind: "column", block });
      } else if (m[1] === "column" && top.kind === "column") {
        top.block.cols.push([]);
        top.list = top.block.cols[top.block.cols.length - 1];
      } else if (!m[1] && top.kind === "column") {
        stack.pop();
      }
      i++;
    } else if ((m = /^\+\+\+\s*(.*)$/.exec(line))) {
      if (m[1].trim()) {
        const [summary, attrs] = takeAttrs(m[1].trim());
        const toggle = withAttrs({ type: "toggle", text: summary.trim(), children: [] }, attrs);
        out().push(toggle);
        stack.push({ list: toggle.children, kind: "toggle" });
      } else if (stack[stack.length - 1].kind === "toggle") {
        stack.pop();
      }
      i++;
    } else if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
      const [text, attrs] = takeAttrs(m[2]);
      out().push(withAttrs({ type: `h${m[1].length}`, text: text.trim() }, attrs));
      i++;
    } else if (/^---+\s*$/.test(line)) {
      out().push({ type: "divider" });
      i++;
    } else if (/^\[\[toc\]\]\s*$/.test(line)) {
      out().push({ type: "toc" });
      i++;
    } else if (/^>/.test(line)) {
      const quote = [];
      for (; i < lines.length && /^>/.test(lines[i]); i++) quote.push(lines[i].replace(/^>\s?/, ""));
      const [lastLine, attrs] = takeAttrs(quote[quote.length - 1]);
      quote[quote.length - 1] = lastLine;
      const callout = /^\[!([^\]]{1,16})\]\s*(.*)$/.exec(quote[0]);
      if (callout) {
        const rest = [callout[2], ...quote.slice(1)].filter((l, n) => n > 0 || l);
        out().push(withAttrs({ type: "callout", icon: callout[1], text: rest.join("\n") }, attrs));
      } else {
        out().push(withAttrs({ type: "quote", text: quote.join("\n") }, attrs));
      }
    } else if ((m = IMAGE.exec(takeAttrs(line)[0]))) {
      out().push(withAttrs({ type: "image", caption: m[1].replace(/\\(.)/g, "$1"), url: m[2] }, takeAttrs(line)[1]));
      i++;
    } else if ((m = EMBED.exec(line))) {
      out().push({ type: m[1], url: m[2] });
      i++;
    } else if (/^\|/.test(line) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const rows = [splitRow(line)];
      const align = splitRow(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? "center" : /-:$/.test(c) ? "right" : "left"));
      for (i += 2; i < lines.length && /^\|/.test(lines[i]); i++) rows.push(splitRow(lines[i]));
      const width = Math.max(...rows.map((r) => r.length));
      const block = { type: "table", rows: rows.map((r) => [...r, ...Array(width - r.length).fill("")]) };
      if (align.some((a) => a !== "left")) block.align = Array.from({ length: width }, (_, c) => align[c] || "left");
      out().push(block);
    } else if ((m = LIST.exec(line))) {
      const indent = Math.min(Math.floor(m[1].length / 2), 6);
      // Lines indented under an item, not items themselves, continue it (Shift+Enter).
      const lines2 = [m[6]];
      const deeper = m[1].length + 2;
      while (i + 1 < lines.length && lines[i + 1].trim() && /^ +/.test(lines[i + 1])
        && lines[i + 1].match(/^ */)[0].length >= deeper && !LIST.test(lines[i + 1])) lines2.push(lines[++i].trim());
      const [text, attrs] = takeAttrs(lines2.join("\n"));
      if (m[3] != null) out().push(withAttrs({ type: "todo", indent, checked: m[3] !== " ", text }, attrs));
      else if (m[4]) out().push(withAttrs({ type: "bullet", indent, text }, attrs));
      else out().push(withAttrs({ type: "number", indent, text }, attrs));
      i++;
    } else {
      const para = [];
      for (; i < lines.length && lines[i].trim() && !(para.length && startsBlock(lines[i])); i++) para.push(lines[i]);
      const [lastLine, attrs] = takeAttrs(para[para.length - 1]);
      para[para.length - 1] = lastLine;
      out().push(withAttrs({ type: "p", text: para.join("\n") }, attrs));
    }
  }
  return root;
}

const oneLine = (s) => String(s || "").replace(/\s*\n\s*/g, " ").trim();
const guard = (line) => (startsBlock(line) ? `\\${line}` : line);
const isList = (b) => b && (b.type === "bullet" || b.type === "number" || b.type === "todo");

export function serializeBlocks(blocks) {
  const parts = [];
  const counters = [];
  let prev = null;
  for (const b of blocks) {
    let text;
    const tail = attrsTail(b.attrs, b.type);
    if (isList(b)) {
      const indent = Math.max(0, Math.min(b.indent || 0, 6));
      counters.length = indent + 1;
      counters[indent] = b.type === "number" && prev && prev.type === "number" && (prev.indent || 0) >= indent ? (counters[indent] || 0) + 1 : b.type === "number" ? 1 : 0;
      const pad = "  ".repeat(indent);
      const marker = b.type === "todo" ? `- [${b.checked ? "x" : " "}]` : b.type === "number" ? `${counters[indent]}.` : "-";
      // A line break inside an item continues under its text, indented past the marker.
      const lines = String(b.text || "").split(/\n+/).map((l) => l.trim()).filter((l, n) => l || n === 0);
      text = `${pad}${marker} ${lines.join(`\n${pad}${" ".repeat(marker.length + 1)}`)}${tail}`;
    } else {
      counters.length = 0;
      switch (b.type) {
        case "h1": case "h2": case "h3": case "h4":
          text = `${"#".repeat(Number(b.type[1]))} ${oneLine(b.text)}${tail}`; break;
        case "quote":
          text = String(b.text || "").split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n") + tail;
          if (!b.text) text = `>${tail}`;
          break;
        case "callout":
          text = [`> [!${b.icon || "💡"}]`, ...(b.text ? String(b.text).split("\n").map((l) => (l ? `> ${l}` : ">")) : [])].join("\n") + tail; break;
        case "toggle":
          text = `+++ ${oneLine(b.text) || "Toggle"}${tail}\n${serializeBlocks(b.children || [])}${(b.children || []).length ? "\n" : ""}+++`; break;
        case "columns": {
          const cols = (b.cols || []).map((c) => serializeBlocks(c));
          text = `::: columns\n${cols.map((c) => `${c}${c ? "\n" : ""}`).join("::: column\n")}:::`;
          break;
        }
        case "code": {
          const longest = Math.max(2, ...(String(b.code || "").match(/^`+/gm) || []).map((f) => f.length));
          const fence = "`".repeat(longest + 1);
          text = `${fence}${b.lang || ""}\n${b.code || ""}\n${fence}`; break;
        }
        case "math": text = `$$\n${String(b.tex || "").trim()}\n$$`; break;
        case "divider": text = "---"; break;
        case "toc": text = "[[toc]]"; break;
        case "image": text = b.url ? `![${oneLine(b.caption).replace(/([\\\]\[])/g, "\\$1")}](${b.url})${tail}` : ""; break;
        case "video": case "bookmark": text = b.url ? `@[${b.type}](${b.url})` : ""; break;
        case "table": {
          const align = b.align || [];
          const sep = (c) => ({ center: ":---:", right: "---:" }[align[c]] || "---");
          text = (b.rows || []).map((r, n) => {
            const row = `| ${r.map((c) => oneLine(c).replace(/(?<!\\)\|/g, "\\|") || " ").join(" | ")} |`;
            return n === 0 ? `${row}\n| ${r.map((_, c) => sep(c)).join(" | ")} |` : row;
          }).join("\n"); break;
        }
        default:
          text = String(b.text || "").split("\n").map(guard).join("\n") + tail;
      }
    }
    if (text) parts.push((parts.length ? (isList(b) && isList(prev) ? "\n" : "\n\n") : "") + text);
    prev = b;
  }
  return parts.join("");
}

/* ---- rendering ------------------------------------------------------- */

const anchor = (text, used) => {
  const base = inlineText(text).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  return id;
};

/** A YouTube address -> its video id, or null. */
export function youtubeId(url) {
  const m = /^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/.exec(String(url || ""));
  return m ? m[1] : null;
}

export function highlightCode(code, lang) {
  const language = lang && hljs.getLanguage(lang) ? lang : null;
  return language ? hljs.highlight(code, { language, ignoreIllegals: true }).value : escapeHTML(code);
}

/** List markers in a numbering format: 1, a, i. */
export function listMarker(n, format) {
  if (format === "a") {
    let s = "";
    for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(97 + ((k - 1) % 26)) + s;
    return s;
  }
  if (format === "i") {
    const table = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
    let s = "";
    let k = n;
    for (const [v, r] of table) while (k >= v) { s += r; k -= v; }
    return s;
  }
  return String(n);
}

function renderList(items) {
  let html = "";
  const stack = [];
  for (const it of items) {
    const tag = it.type === "number" ? "ol" : "ul";
    const cls = it.type === "todo" ? "todo-list" : "";
    const top = stack[stack.length - 1];
    const indent = Math.min(it.indent || 0, top ? top.indent + 1 : 0);
    while (stack.length && stack[stack.length - 1].indent > indent) html += `</li></${stack.pop().tag}>`;
    const same = stack[stack.length - 1];
    if (same && same.indent === indent) {
      if (same.tag !== tag || same.cls !== cls) html += `</li></${stack.pop().tag}>`;
      else html += "</li>";
    }
    const now = stack[stack.length - 1];
    if (!now || now.indent < indent) {
      const format = tag === "ol" && it.attrs && it.attrs.list;
      html += `<${tag}${cls ? ` class="${cls}"` : ""}${format ? ` type="${format}"` : ""}>`;
      stack.push({ tag, cls, indent });
    }
    const li = blockAttrs(it.attrs);
    html += it.type === "todo"
      ? `<li class="todo${it.checked ? " is-done" : ""}${li ? ` ${li.slice(8, -1)}` : ""}"><input type="checkbox" disabled${it.checked ? " checked" : ""} aria-label="${it.checked ? "Done" : "Not done"}" /> <span>${inline(it.text)}</span>`
      : `<li${li}>${inline(it.text)}`;
  }
  while (stack.length) html += `</li></${stack.pop().tag}>`;
  return html;
}

function renderBlocks(blocks, ctx) {
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (isList(b)) {
      const items = [];
      for (; i < blocks.length && isList(blocks[i]); i++) items.push(blocks[i]);
      i--;
      out.push(renderList(items));
      continue;
    }
    const at = blockAttrs(b.attrs);
    switch (b.type) {
      case "h1": case "h2": case "h3": case "h4": {
        const level = Number(b.type[1]) + 1;
        const id = anchor(b.text, ctx.ids);
        ctx.headings.push({ level, id, text: b.text });
        out.push(`<h${level} id="${id}"${at}>${inline(b.text)}</h${level}>`);
        break;
      }
      case "p": out.push(`<p${at}>${inline(b.text)}</p>`); break;
      case "quote": out.push(`<blockquote${at}><p>${inline(b.text)}</p></blockquote>`); break;
      case "callout":
        out.push(`<aside class="callout${b.attrs && b.attrs.bg ? ` bg-${b.attrs.bg}` : ""}${b.attrs && b.attrs.color ? ` c-${b.attrs.color}` : ""}${b.attrs && b.attrs.align && b.attrs.align !== "left" ? ` align-${b.attrs.align}` : ""}"><span class="callout-icon" aria-hidden="true">${emojiHTML(b.icon || "💡")}</span><div>${inline(b.text)}</div></aside>`);
        break;
      case "toggle": {
        const level = b.attrs && b.attrs.h ? Number(b.attrs.h) + 1 : 0;
        const summary = level ? `<h${level} class="toggle-heading">${inline(b.text)}</h${level}>` : inline(b.text);
        out.push(`<details class="toggle"><summary${at}>${summary}</summary><div class="toggle-body">${renderBlocks(b.children || [], ctx)}</div></details>`);
        break;
      }
      case "columns":
        out.push(`<div class="columns" style="--cols: ${(b.cols || []).length}">${(b.cols || []).map((c) => `<div class="column">${renderBlocks(c, ctx)}</div>`).join("")}</div>`);
        break;
      case "code":
        out.push(`<figure class="code-block">${b.lang ? `<figcaption>${escapeHTML(b.lang)}</figcaption>` : ""}<pre><code class="hljs">${highlightCode(b.code || "", b.lang)}</code></pre></figure>`);
        break;
      case "math": out.push(`<div class="math-block" data-tex="${escapeHTML(b.tex)}">${renderMath(b.tex, true)}</div>`); break;
      case "divider": out.push("<hr />"); break;
      case "toc": out.push("\u0000toc\u0000"); break;
      case "image": {
        const a = b.attrs || {};
        const style = a.width ? ` style="width: ${a.width}%"` : "";
        out.push(`<figure class="image align-${a.align || "center"}"${style}><img src="${escapeHTML(b.url)}" alt="${escapeHTML(b.caption || "")}" loading="lazy" />${b.caption ? `<figcaption>${escapeHTML(b.caption)}</figcaption>` : ""}</figure>`);
        break;
      }
      case "video": {
        const id = youtubeId(b.url);
        out.push(id
          ? `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${id}" title="YouTube video" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`
          : `<p><a href="${escapeHTML(b.url)}" target="_blank" rel="noopener">${escapeHTML(b.url)}</a></p>`);
        break;
      }
      case "bookmark": {
        out.push(bookmarkHTML(b.url, ctx.links && ctx.links[b.url]));
        break;
      }
      case "table": {
        const [head = [], ...rows] = b.rows || [];
        const al = (c) => (b.align && b.align[c] && b.align[c] !== "left" ? ` class="align-${b.align[c]}"` : "");
        out.push(`<div class="table-wrap"><table><thead><tr>${head.map((c, n) => `<th${al(n)}>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c, n) => `<td${al(n)}>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
        break;
      }
    }
  }
  return out.join("\n");
}

/** The table of contents for a list of {level, id, text} headings. */
export function tocHTML(headings) {
  if (!headings.length) return '<nav class="toc"><p>Add headings to fill the table of contents.</p></nav>';
  return `<nav class="toc" aria-label="Contents">${headings
    .map((h) => `<a class="toc-${h.level}" href="#${h.id}">${escapeHTML(inlineText(h.text))}</a>`).join("")}</nav>`;
}

/** `links`: bookmark details by address ({ title, description, image }). */
export function renderMarkdown(source, { links = null } = {}) {
  const ctx = { ids: new Set(), headings: [], links };
  const html = renderBlocks(parseBlocks(source), ctx);
  return html.replace(/\u0000toc\u0000/g, () => tocHTML(ctx.headings));
}

/** Plain text of a post's opening, for descriptions when no summary is set. */
export function plainSummary(source, max = 160) {
  const texts = [];
  const walk = (blocks) => blocks.forEach((b) => {
    if (b.text && b.type !== "toggle") texts.push(inlineText(b.text));
    if (b.children) walk(b.children);
    if (b.cols) b.cols.forEach(walk);
  });
  walk(parseBlocks(source));
  const text = texts.join(" ").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Words and minutes to read, at 220 words a minute. */
export function readingTime(source) {
  const words = (plainSummary(source, Infinity).match(/\S+/g) || []).length;
  return { words, minutes: Math.max(1, Math.round(words / 220)) };
}
