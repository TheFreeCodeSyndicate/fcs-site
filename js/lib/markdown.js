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
 * trust: false, and code is escaped by highlight.js.
 *
 * Blocks and their syntax:
 *   # / ## / ###        headings (rendered h2-h4: the title is the h1)
 *   - item  1. item     lists; two spaces of indent per nesting level
 *   - [ ] / - [x]       to-dos
 *   > text              quote          > [!💡] then > text   callout
 *   +++ summary ... +++ toggle (holds blocks)
 *   ```lang ... ```     code           $$ ... $$             math
 *   ---                 divider        [[toc]]               table of contents
 *   ![caption](https://...)            image
 *   @[video](https://youtube...)       YouTube video
 *   @[bookmark](https://...)           link card
 *   | a | b |           table (first row is the header)
 * Inline: **bold** *italic* ~~strike~~ ==highlight== `code` $math$
 *         [link](https://...) and \ escapes.
 * ------------------------------------------------------------------
 */
import katex from "../vendor/katex/katex.mjs";
import hljs from "../vendor/hljs/highlight.min.js";

export const escapeHTML = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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

const INLINE_TOKEN = /\\([\\`*_{}\[\]()#+\-.!|~=$>"])|(`+)([\s\S]*?[^`])\2(?!`)|\$([^\s$](?:[^$]*?[^\s$])?)\$(?!\d)/g;

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
    .replace(/!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1" loading="lazy" />')
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noopener">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/~~(.+?)~~/g, "<s>$1</s>")
    .replace(/==(.+?)==/g, "<mark>$1</mark>")
    .replace(/\n/g, "<br />");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => held[i]);
}

/** Inline Markdown -> plain text (titles, summaries, heading anchors). */
export function inlineText(text) {
  return String(text || "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\\(.)/g, "$1")
    .replace(/\*\*|~~|==|[*`$]/g, "");
}

/* ---- blocks ---------------------------------------------------------- */

const LIST = /^( *)(?:([-*])\s+\[( |x|X)\]|([-*])|(\d+)[.)])\s+(.*)$/;
const IMAGE = /^!\[((?:\\.|[^\]\\])*)\]\((https:\/\/[^\s)]+)\)\s*$/;
const EMBED = /^@\[(video|bookmark)\]\((https:\/\/[^\s)]+)\)\s*$/;
const TABLE_SEP = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/** Does this line start a block other than a paragraph? (Paragraph lines
 * that would, are written with a leading backslash.) */
export function startsBlock(line) {
  return /^(#{1,3}\s|>|\+\+\+|```|\$\$|---+\s*$|\[\[toc\]\]\s*$|\|)/.test(line) ||
    LIST.test(line) || IMAGE.test(line) || EMBED.test(line);
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

export function parseBlocks(source) {
  const lines = String(source || "").replace(/\r\n?/g, "\n").split("\n");
  const root = [];
  const stack = [root];
  const out = () => stack[stack.length - 1];
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
    } else if ((m = /^\+\+\+\s*(.*)$/.exec(line))) {
      if (m[1].trim()) {
        const toggle = { type: "toggle", text: m[1].trim(), children: [] };
        out().push(toggle);
        stack.push(toggle.children);
      } else if (stack.length > 1) {
        stack.pop();
      }
      i++;
    } else if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) {
      out().push({ type: `h${m[1].length}`, text: m[2].trim() });
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
      const callout = /^\[!([^\]]{1,16})\]\s*(.*)$/.exec(quote[0]);
      if (callout) {
        const rest = [callout[2], ...quote.slice(1)].filter((l, n) => n > 0 || l);
        out().push({ type: "callout", icon: callout[1], text: rest.join("\n") });
      } else {
        out().push({ type: "quote", text: quote.join("\n") });
      }
    } else if ((m = IMAGE.exec(line))) {
      out().push({ type: "image", caption: m[1].replace(/\\(.)/g, "$1"), url: m[2] });
      i++;
    } else if ((m = EMBED.exec(line))) {
      out().push({ type: m[1], url: m[2] });
      i++;
    } else if (/^\|/.test(line) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const rows = [splitRow(line)];
      for (i += 2; i < lines.length && /^\|/.test(lines[i]); i++) rows.push(splitRow(lines[i]));
      const width = Math.max(...rows.map((r) => r.length));
      out().push({ type: "table", rows: rows.map((r) => [...r, ...Array(width - r.length).fill("")]) });
    } else if ((m = LIST.exec(line))) {
      const indent = Math.min(Math.floor(m[1].length / 2), 6);
      if (m[3] != null) out().push({ type: "todo", indent, checked: m[3] !== " ", text: m[6] });
      else if (m[4]) out().push({ type: "bullet", indent, text: m[6] });
      else out().push({ type: "number", indent, text: m[6] });
      i++;
    } else {
      const para = [];
      for (; i < lines.length && lines[i].trim() && !(para.length && startsBlock(lines[i])); i++) para.push(lines[i]);
      out().push({ type: "p", text: para.join("\n") });
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
    if (isList(b)) {
      const indent = Math.max(0, Math.min(b.indent || 0, 6));
      counters.length = indent + 1;
      counters[indent] = b.type === "number" && prev && prev.type === "number" && (prev.indent || 0) >= indent ? (counters[indent] || 0) + 1 : b.type === "number" ? 1 : 0;
      const pad = "  ".repeat(indent);
      const marker = b.type === "todo" ? `- [${b.checked ? "x" : " "}]` : b.type === "number" ? `${counters[indent]}.` : "-";
      text = `${pad}${marker} ${oneLine(b.text)}`;
    } else {
      counters.length = 0;
      switch (b.type) {
        case "h1": case "h2": case "h3":
          text = `${"#".repeat(Number(b.type[1]))} ${oneLine(b.text)}`; break;
        case "quote":
          text = String(b.text || "").split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n"); break;
        case "callout":
          text = [`> [!${b.icon || "💡"}]`, ...(b.text ? String(b.text).split("\n").map((l) => (l ? `> ${l}` : ">")) : [])].join("\n"); break;
        case "toggle":
          text = `+++ ${oneLine(b.text) || "Toggle"}\n${serializeBlocks(b.children || [])}${(b.children || []).length ? "\n" : ""}+++`; break;
        case "code": {
          const longest = Math.max(2, ...(String(b.code || "").match(/^`+/gm) || []).map((f) => f.length));
          const fence = "`".repeat(longest + 1);
          text = `${fence}${b.lang || ""}\n${b.code || ""}\n${fence}`; break;
        }
        case "math": text = `$$\n${String(b.tex || "").trim()}\n$$`; break;
        case "divider": text = "---"; break;
        case "toc": text = "[[toc]]"; break;
        case "image": text = b.url ? `![${oneLine(b.caption).replace(/([\\\]\[])/g, "\\$1")}](${b.url})` : ""; break;
        case "video": case "bookmark": text = b.url ? `@[${b.type}](${b.url})` : ""; break;
        case "table":
          text = (b.rows || []).map((r, n) => {
            const row = `| ${r.map((c) => oneLine(c).replace(/(?<!\\)\|/g, "\\|") || " ").join(" | ")} |`;
            return n === 0 ? `${row}\n| ${r.map(() => "---").join(" | ")} |` : row;
          }).join("\n"); break;
        default:
          text = String(b.text || "").split("\n").map(guard).join("\n");
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
      html += `<${tag}${cls ? ` class="${cls}"` : ""}>`;
      stack.push({ tag, cls, indent });
    }
    html += it.type === "todo"
      ? `<li class="todo${it.checked ? " is-done" : ""}"><input type="checkbox" disabled${it.checked ? " checked" : ""} aria-label="${it.checked ? "Done" : "Not done"}" /> <span>${inline(it.text)}</span>`
      : `<li>${inline(it.text)}`;
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
    switch (b.type) {
      case "h1": case "h2": case "h3": {
        const level = Number(b.type[1]) + 1;
        const id = anchor(b.text, ctx.ids);
        ctx.headings.push({ level, id, text: b.text });
        out.push(`<h${level} id="${id}">${inline(b.text)}</h${level}>`);
        break;
      }
      case "p": out.push(`<p>${inline(b.text)}</p>`); break;
      case "quote": out.push(`<blockquote><p>${inline(b.text)}</p></blockquote>`); break;
      case "callout":
        out.push(`<aside class="callout"><span class="callout-icon" aria-hidden="true">${emojiHTML(b.icon || "💡")}</span><div>${inline(b.text)}</div></aside>`);
        break;
      case "toggle":
        out.push(`<details class="toggle"><summary>${inline(b.text)}</summary><div class="toggle-body">${renderBlocks(b.children || [], ctx)}</div></details>`);
        break;
      case "code":
        out.push(`<figure class="code-block">${b.lang ? `<figcaption>${escapeHTML(b.lang)}</figcaption>` : ""}<pre><code class="hljs">${highlightCode(b.code || "", b.lang)}</code></pre></figure>`);
        break;
      case "math": out.push(`<div class="math-block" data-tex="${escapeHTML(b.tex)}">${renderMath(b.tex, true)}</div>`); break;
      case "divider": out.push("<hr />"); break;
      case "toc": out.push("\u0000toc\u0000"); break;
      case "image":
        out.push(`<figure class="image"><img src="${escapeHTML(b.url)}" alt="${escapeHTML(b.caption || "")}" loading="lazy" />${b.caption ? `<figcaption>${escapeHTML(b.caption)}</figcaption>` : ""}</figure>`);
        break;
      case "video": {
        const id = youtubeId(b.url);
        out.push(id
          ? `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${id}" title="YouTube video" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`
          : `<p><a href="${escapeHTML(b.url)}" rel="noopener">${escapeHTML(b.url)}</a></p>`);
        break;
      }
      case "bookmark": {
        const host = (() => { try { return new URL(b.url).hostname.replace(/^www\./, ""); } catch { return b.url; } })();
        out.push(`<a class="bookmark" href="${escapeHTML(b.url)}" rel="noopener"><strong>${escapeHTML(host)}</strong><span>${escapeHTML(b.url)}</span></a>`);
        break;
      }
      case "table": {
        const [head = [], ...rows] = b.rows || [];
        out.push(`<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
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

export function renderMarkdown(source) {
  const ctx = { ids: new Set(), headings: [] };
  const html = renderBlocks(parseBlocks(source), ctx);
  return html.replace(/\u0000toc\u0000/g, () => tocHTML(ctx.headings));
}

/** Does this post need KaTeX's stylesheet? */
export const hasMath = (source) => /\$/.test(String(source || "")) && /class="math/.test(renderMarkdown(source));

/** Plain text of a post's opening, for descriptions when no summary is set. */
export function plainSummary(source, max = 160) {
  const texts = [];
  const walk = (blocks) => blocks.forEach((b) => {
    if (b.text && b.type !== "toggle") texts.push(inlineText(b.text));
    if (b.children) walk(b.children);
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
