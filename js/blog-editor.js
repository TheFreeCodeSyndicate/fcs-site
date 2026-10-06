/*
 * js/blog-editor.js
 * ------------------------------------------------------------------
 * The admin's post editor: a full-screen, Notion-style page.
 *
 *   cover (upload, link, drag to reposition) . icon (emoji, pixel icon
 *   in a colour, upload) . title . properties . blocks
 *
 * Blocks are edited in place (WYSIWYG). "/" opens the block menu, ":"
 * suggests emoji and "@" mentions people and dates. Markdown shortcuts
 * work at the start of a line ("# ", "- ", "[] ", "> ", "```", "---",
 * "$$ ", ...) and inline (**bold**, *italic*, `code`, ~~strike~~,
 * ==highlight==, $math$). Selecting text shows a formatting bar (turn
 * into, marks, link, colours). Each block has a "+" and a grip: drag to
 * move, click for its menu (turn into, colour, align, duplicate, ...).
 * Tables have row and column handles. Ctrl+F finds and replaces.
 *
 * The page's DOM is the editing state. Loading parses the post's
 * Markdown (js/lib/markdown.js) into blocks; saving walks the DOM back
 * into blocks and serialises them, so the stored format stays plain
 * Markdown that the deploy renders.
 *
 * Drafts save themselves a moment after you stop typing; a published
 * post changes only when you press Update (each update redeploys).
 * ------------------------------------------------------------------
 */
import {
  parseBlocks, serializeBlocks, inline, renderMath, highlightCode, youtubeId, readingTime,
  tocHTML, inlineText, twemojiURL, emojiHTML, COLORS, listMarker, dateText as isoDateText,
} from "./lib/markdown.js";
import { iconHTML, postArticleHTML, ICON_COLORS, SITE, postAuthors, authorNames, avatarHTML, avatarGroupHTML } from "./lib/blog-pages.js";
import { slugify } from "./lib/forms.js";
import { escapeHTML, escapeAttr, icon } from "./render.js";
import "./link-preview.js";

/* ==================================================================
 * Catalogue
 * ================================================================== */

const TEXT_TYPES = new Set(["p", "h1", "h2", "h3", "h4", "bullet", "number", "todo", "quote", "callout", "toggle"]);
const LIST_TYPES = new Set(["bullet", "number", "todo"]);
const MULTILINE = new Set(["p", "quote", "callout"]);
const TYPE_NAMES = {
  p: "Text", h1: "Heading 1", h2: "Heading 2", h3: "Heading 3", h4: "Heading 4", bullet: "Bulleted list",
  number: "Numbered list", todo: "To-do list", quote: "Quote", callout: "Callout", toggle: "Toggle list",
  code: "Code", math: "Equation", divider: "Divider", toc: "Table of contents", image: "Image", video: "Video",
  bookmark: "Web bookmark", table: "Table", columns: "Columns",
};

const PLACEHOLDERS = {
  p: "Type '/' for commands", h1: "Heading 1", h2: "Heading 2", h3: "Heading 3", h4: "Heading 4",
  bullet: "List", number: "List", todo: "To-do", quote: "Empty quote",
  callout: "Type something…", toggle: "Toggle",
};

// The "/" menu: [id, label, pixel icon, search words, section, shortcut hint]
const COMMANDS = [
  ["p", "Text", "text-start-t", "text paragraph plain", "Basic blocks", ""],
  ["h1", "Heading 1", "heading-1", "heading title big h1", "Basic blocks", "#"],
  ["h2", "Heading 2", "heading-2", "heading subtitle medium h2", "Basic blocks", "##"],
  ["h3", "Heading 3", "heading-3", "heading small h3", "Basic blocks", "###"],
  ["h4", "Heading 4", "heading-4", "heading smallest h4", "Basic blocks", "####"],
  ["bullet", "Bulleted list", "bulletlist", "bullet list unordered ul", "Basic blocks", "-"],
  ["number", "Numbered list", "list-box", "number list ordered ol", "Basic blocks", "1."],
  ["todo", "To-do list", "checkbox-on", "todo task check checkbox", "Basic blocks", "[]"],
  ["toggle", "Toggle list", "chevron-right", "toggle collapse details dropdown", "Basic blocks", ">"],
  ["toggle-h1", "Toggle heading 1", "chevron-right", "toggle heading collapse h1", "Basic blocks", ""],
  ["toggle-h2", "Toggle heading 2", "chevron-right", "toggle heading collapse h2", "Basic blocks", ""],
  ["toggle-h3", "Toggle heading 3", "chevron-right", "toggle heading collapse h3", "Basic blocks", ""],
  ["quote", "Quote", "quote-text-inline", "quote blockquote citation", "Basic blocks", "\""],
  ["callout", "Callout", "info-box", "callout note tip warning info box aside", "Basic blocks", ""],
  ["divider", "Divider", "minus", "divider line separator hr rule", "Basic blocks", "---"],
  ["table", "Table", "grid-3x3", "table grid rows columns spreadsheet", "Basic blocks", ""],
  ["toc", "Table of contents", "section", "toc table of contents outline headings", "Basic blocks", ""],
  ["columns-2", "2 columns", "text-colums", "columns layout side by side two", "Layout", ""],
  ["columns-3", "3 columns", "text-colums", "columns layout side by side three", "Layout", ""],
  ["columns-4", "4 columns", "text-colums", "columns layout side by side four", "Layout", ""],
  ["image", "Image", "image", "image picture photo upload media", "Media", ""],
  ["video", "Video", "youtube", "video youtube embed media", "Media", ""],
  ["bookmark", "Web bookmark", "bookmark", "bookmark link card url web", "Media", ""],
  ["code", "Code", "code", "code snippet program syntax", "Advanced", "```"],
  ["math", "Block equation", "calculator", "math equation latex tex formula katex", "Advanced", "$$"],
  ["inline-math", "Inline equation", "calculator", "inline math equation latex tex", "Inline", "$x$"],
  ["mention", "Mention a person", "at-sign", "mention person people member user", "Inline", "@"],
  ["date", "Date", "calendar", "date today tomorrow mention time", "Inline", "@today"],
  ["emoji", "Emoji", "smile", "emoji smiley icon", "Inline", ":"],
];
const TURN_INTO = ["p", "h1", "h2", "h3", "h4", "bullet", "number", "todo", "toggle", "quote", "callout"];

const LANGS = ["", "bash", "c", "cpp", "csharp", "css", "diff", "go", "java", "javascript", "json", "kotlin", "markdown", "php", "python", "ruby", "rust", "sql", "swift", "typescript", "xml", "yaml"];

const FONTS = [
  ["default", "Default", "A readable sans for long reading"],
  ["mono", "Mono", "Archivo Mono, the brand's voice"],
  ["technical", "Technical", "Latin Modern Mono, for technical posts"],
  ["garet", "Garet", "Garet, the brand's digital and social face"],
];

/* The picker's catalogues load the first time they are needed: every
 * Unicode emoji in Notion's nine groups (js/vendor/emoji, drawn with
 * Twemoji) and every pixelarticons icon (assets/pixel-icons.svg). */
let emojiGroups = null;
let emojiFlat = null;
const loadEmoji = () => (emojiGroups ||= fetch("js/vendor/emoji/emoji-groups.json").then((r) => r.json())
  .then((groups) => { emojiFlat = groups.flatMap(([, list]) => list); return groups; }));
let pixelNames = null;
const loadIcons = () => (pixelNames ||= fetch("assets/pixel-icons.svg").then((r) => r.text())
  .then((svg) => [...svg.matchAll(/id="p-([a-z0-9-]+)"/g)].map((m) => m[1])));
const GROUP_GLYPHS = ["😀", "👋", "🐻", "🍔", "✈️", "⚽", "💡", "❤️", "🏳️"];
const pixelIcon = (name, cls = "") => `<svg class="pixel-icon ${cls}" aria-hidden="true" focusable="false"><use href="assets/pixel-icons.svg#p-${name}"></use></svg>`;

/* Recently picked, newest first, shared across posts in this browser. */
const recent = (kind) => { try { return JSON.parse(localStorage.getItem(`fcs-recent-${kind}`)) || []; } catch { return []; } };
const remember = (kind, value) => {
  try { localStorage.setItem(`fcs-recent-${kind}`, JSON.stringify([value, ...recent(kind).filter((v) => v !== value)].slice(0, 24))); } catch { /* private mode */ }
};

const GUTTER_PLUS = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7.25 2.5h1.5v4.75h4.75v1.5H8.75v4.75h-1.5V8.75H2.5v-1.5h4.75z"/></svg>';
const GUTTER_GRIP = '<svg viewBox="0 0 10 16" aria-hidden="true"><circle cx="2.5" cy="3" r="1.4"/><circle cx="7.5" cy="3" r="1.4"/><circle cx="2.5" cy="8" r="1.4"/><circle cx="7.5" cy="8" r="1.4"/><circle cx="2.5" cy="13" r="1.4"/><circle cx="7.5" cy="13" r="1.4"/></svg>';
const GRIP_ROW = '<svg viewBox="0 0 8 14" aria-hidden="true"><circle cx="2" cy="2.5" r="1.2"/><circle cx="6" cy="2.5" r="1.2"/><circle cx="2" cy="7" r="1.2"/><circle cx="6" cy="7" r="1.2"/><circle cx="2" cy="11.5" r="1.2"/><circle cx="6" cy="11.5" r="1.2"/></svg>';
const GRIP_COL = '<svg viewBox="0 0 14 8" aria-hidden="true"><circle cx="2.5" cy="2" r="1.2"/><circle cx="7" cy="2" r="1.2"/><circle cx="11.5" cy="2" r="1.2"/><circle cx="2.5" cy="6" r="1.2"/><circle cx="7" cy="6" r="1.2"/><circle cx="11.5" cy="6" r="1.2"/></svg>';

/* ==================================================================
 * Small DOM helpers
 * ================================================================== */

const h = (html) => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
const sel = () => window.getSelection();
const rangeNow = () => (sel().rangeCount ? sel().getRangeAt(0) : null);
const isoToday = (delta = 0) => new Date(Date.now() + delta * 864e5 - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

function placeCaret(el, atEnd = true) {
  if (!el) return;
  el.focus({ preventScroll: true });
  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
    const at = atEnd ? el.value.length : 0;
    el.setSelectionRange(at, at);
  } else {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(!atEnd);
    sel().removeAllRanges();
    sel().addRange(r);
  }
  el.scrollIntoView({ block: "nearest" });
}

/** Is the caret at the very start (or end) of this editable? */
function caretAt(el, end) {
  const r = rangeNow();
  if (!r || !r.collapsed || !el.contains(r.startContainer)) return false;
  const probe = document.createRange();
  probe.selectNodeContents(el);
  if (end) probe.setStart(r.endContainer, r.endOffset);
  else probe.setEnd(r.startContainer, r.startOffset);
  const frag = probe.cloneContents();
  return !frag.textContent.replace(/\u200b/g, "") && !frag.querySelector("br, .math, img, .mention, .mention-date");
}

/** Is the caret on the first (or last) visual line of this editable? */
function caretOnEdgeLine(el, last) {
  const r = rangeNow();
  if (!r || !el.contains(r.startContainer)) return false;
  const rect = r.getClientRects()[0] || (r.startContainer.nodeType === 1 ? r.startContainer.getBoundingClientRect() : null);
  if (!rect || !rect.height) return true;
  const box = el.getBoundingClientRect();
  const line = parseFloat(getComputedStyle(el).lineHeight) || 24;
  return last ? box.bottom - rect.bottom < line * 0.75 : rect.top - box.top < line * 0.75;
}

const isEmptyText = (el) => !el || (!el.textContent.replace(/\u200b/g, "").trim() && !el.querySelector(".math, img, .mention, .mention-date"));

/* Editable HTML -> inline Markdown. Only formatting this editor creates
 * survives; anything else (a stray span a browser added) keeps its text.
 * Characters that mean something in our Markdown are escaped. */
const escText = (s) => s.replace(/[\\`*$\[\]{}^~]/g, "\\$&").replace(/([=+])(?=\1)/g, "\\$1").replace(/@(?=[\[{])/g, "\\@");
const hug = (inner, mark, close = mark) => {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  return m[2] ? `${m[1]}${mark}${m[2]}${close}${m[3]}` : inner;
};
const codeSpan = (text) => (text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``);
const colorOf = (el, prefix) => {
  const c = [...el.classList].find((k) => k.startsWith(prefix) && COLORS.includes(k.slice(prefix.length)));
  return c ? c.slice(prefix.length) : null;
};

function toInline(node) {
  let out = "";
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { out += escText(n.nodeValue.replace(/\u00a0/g, " ").replace(/\u200b/g, "")); continue; }
    if (n.nodeType !== 1) continue;
    const tag = n.tagName;
    if (n.classList.contains("math")) { out += `$${n.dataset.tex}$`; continue; }
    if (n.classList.contains("mention-date") && /^\d{4}-\d{2}-\d{2}$/.test(n.getAttribute("datetime") || "")) { out += `@{${n.getAttribute("datetime")}}`; continue; }
    if (n.classList.contains("mention")) {
      const who = escText(n.textContent.replace(/^@/, "").trim());
      const href = n.getAttribute("href") || "";
      out += /^https:\/\/\S+$/.test(href) ? `@[${who}](${href})` : `@[${who}]`;
      continue;
    }
    if (n.classList.contains("nb-anchor") || n.classList.contains("nb-hint") || n.classList.contains("link-icon")) continue;
    if (tag === "IMG" && n.classList.contains("emoji")) { out += n.getAttribute("alt") || ""; continue; }
    if (tag === "BR") { out += "\n"; continue; }
    if (tag === "CODE") { if (n.textContent) out += codeSpan(n.textContent.replace(/\u200b/g, "")); continue; }
    const inner = toInline(n);
    const weight = n.style && (n.style.fontWeight === "bold" || Number(n.style.fontWeight) >= 600);
    const color = tag === "SPAN" && colorOf(n, "c-");
    const bg = tag === "SPAN" && colorOf(n, "bg-");
    if (color || bg) out += hug(inner, `{${[color && `color=${color}`, bg && `bg=${bg}`].filter(Boolean).join(" ")}}`, "{/}");
    else if (tag === "B" || tag === "STRONG" || weight) out += hug(inner, "**");
    else if (tag === "I" || tag === "EM") out += hug(inner, "*");
    else if (tag === "U") out += hug(inner, "++");
    else if (tag === "S" || tag === "STRIKE" || tag === "DEL") out += hug(inner, "~~");
    else if (tag === "MARK") out += hug(inner, "==");
    else if (tag === "SUP") out += /\s/.test(inner.trim()) || !inner.trim() ? inner : `^${inner.trim()}^`;
    else if (tag === "SUB") out += /\s/.test(inner.trim()) || !inner.trim() ? inner : `~${inner.trim()}~`;
    else if (tag === "A" && /^https:\/\/\S+$/.test(n.getAttribute("href") || "") && inner.trim()) out += `[${inner}](${n.getAttribute("href")})`;
    else if ((tag === "DIV" || tag === "P") && out && !out.endsWith("\n")) out += `\n${inner}`;
    else out += inner;
  }
  return out;
}
const textOf = (el, multiline) => {
  const md = toInline(el).replace(/\n+$/, "");
  return multiline ? md : md.replace(/\n/g, " ");
};

function fillInline(el, md) {
  el.innerHTML = inline(md || "");
  el.querySelectorAll(".math, .mention, .mention-date, .link-icon").forEach((m) => m.setAttribute("contenteditable", "false"));
  el.querySelectorAll("a").forEach((a) => a.setAttribute("rel", "noopener"));
}

function downloadFile(name, type, text) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ==================================================================
 * The editor
 * ================================================================== */

/**
 * @param {object} opts
 * @param {object|null} opts.row          the post, or null for a new one
 * @param {boolean} opts.isAdmin          admins may delete
 * @param {(values, {id, wasLive}) => Promise<object>} opts.save  create or update; returns the saved row
 * @param {(id, wasLive) => Promise<void>} opts.remove
 * @param {(file: File) => Promise<string>} opts.uploadImage      returns the image's address
 * @param {(values) => Promise<void>} [opts.duplicate]           saves a copy as a new draft
 * @param {(id) => Promise<Array>} [opts.history]                 this post's activity log
 * @param {Array<{name, url}>} [opts.people]                      who "@" can mention
 * @param {(msg, tone?) => void} opts.toast
 * @param {() => void} opts.onClose
 */
export function openBlogEditor(opts) {
  const post = {
    id: null, title: "", slug: "", status: "draft", author_name: "", excerpt: "",
    cover_url: "", cover_position: 50, icon: "", body: "", published_at: null, updated_at: null,
    font: "default", small_text: false, full_width: false, locked: false,
    ...(opts.row || {}),
  };
  post.cover_position = Number.isFinite(post.cover_position) ? post.cover_position : 50;
  // Authors: whoever starts a post is its first author; more can be added.
  const team = opts.team || [];
  const authorOf = (a) => ({ ...(a.id ? { id: a.id } : {}), name: a.name, ...(a.avatar ? { avatar: a.avatar } : {}), ...(a.url ? { url: a.url } : {}) });
  post.authors = postAuthors(post).map((a) => {
    // Refresh club members' names and pictures from the team list.
    const now = a.id && team.find((t) => t.id === a.id);
    return authorOf(now || a);
  });
  if (!post.id && !post.authors.length && opts.me) post.authors = [authorOf(opts.me)];

  let dirty = false;
  let saving = null;
  let autosaveTimer = 0;
  let historyTimer = 0;
  const history = [];
  let historyAt = -1;
  let selectedBlock = null;
  let menu = null; // the "/", ":" or "@" menu while one is open
  let popover = null;
  let zoom = Number(localStorage.getItem("fcs-editor-zoom")) || 100;
  const sortables = [];

  const ed = h(`
    <div class="nb" role="dialog" aria-modal="true" aria-label="Post editor">
      <header class="nb-top">
        <button type="button" class="nb-ghost" data-close>${icon("arrow-up", "nb-back-icon")}<span>Posts</span></button>
        <span class="nb-crumb"><span>Blog</span><span aria-hidden="true">/</span><span data-crumb></span></span>
        <span class="nb-spacer"></span>
        <button type="button" class="nb-ghost nb-locked-pill" data-unlock hidden>${pixelIcon("lock")}<span>Locked</span></button>
        <span class="nb-muted" data-words></span>
        <span class="nb-state" data-state role="status"></span>
        <button type="button" class="nb-ghost nb-square" data-undo title="Undo (Ctrl+Z)" aria-label="Undo">${pixelIcon("undo")}</button>
        <button type="button" class="nb-ghost nb-square" data-redo title="Redo (Ctrl+Shift+Z)" aria-label="Redo">${pixelIcon("redo")}</button>
        <button type="button" class="nb-ghost" data-preview>${icon("eye")}<span>Preview</span></button>
        <button type="button" class="nb-primary" data-save></button>
        <button type="button" class="nb-ghost nb-square" data-more aria-label="More actions" aria-haspopup="menu">${pixelIcon("more-horizontal")}</button>
      </header>
      <div class="nb-find" data-find hidden role="search">
        <label class="nb-search">${pixelIcon("search")}<input type="search" placeholder="Find in post" aria-label="Find" data-find-input /></label>
        <span class="nb-muted" data-find-count></span>
        <button type="button" class="nb-tool-btn" data-find-prev title="Previous (Shift+Enter)" aria-label="Previous match">${pixelIcon("chevron-up")}</button>
        <button type="button" class="nb-tool-btn" data-find-next title="Next (Enter)" aria-label="Next match">${pixelIcon("chevron-down")}</button>
        <label class="nb-search">${pixelIcon("repeat")}<input type="text" placeholder="Replace with" aria-label="Replace with" data-replace-input /></label>
        <button type="button" class="nb-ghost nb-boxed" data-replace-one>Replace</button>
        <button type="button" class="nb-ghost nb-boxed" data-replace-all>Replace all</button>
        <label class="nb-check-label"><input type="checkbox" data-find-case /> Aa</label>
        <button type="button" class="nb-tool-btn" data-find-close aria-label="Close find">${pixelIcon("close")}</button>
      </div>
      <div class="nb-scroll" data-scroll>
        <div class="nb-cover" data-cover>
          <img alt="" data-cover-img draggable="false" />
          <div class="nb-cover-tools" data-cover-tools>
            <button type="button" data-cover-change>Change cover</button>
            <button type="button" data-cover-move>Reposition</button>
            <button type="button" data-cover-remove>Remove</button>
          </div>
          <div class="nb-cover-tools nb-cover-moving" data-cover-moving hidden>
            <span>Drag image to reposition</span>
            <button type="button" data-cover-done>Save position</button>
            <button type="button" data-cover-cancel>Cancel</button>
          </div>
        </div>
        <div class="nb-page" data-page>
          <div class="nb-icon" data-icon><button type="button" data-icon-btn aria-label="Change icon"></button></div>
          <div class="nb-adders">
            <button type="button" data-add-icon>${pixelIcon("smile")}<span>Add icon</span></button>
            <button type="button" data-add-cover>${pixelIcon("image")}<span>Add cover</span></button>
          </div>
          <h1 class="nb-title" contenteditable="true" spellcheck="true" data-placeholder="Untitled" data-title aria-label="Title"></h1>
          <div class="nb-props" data-props></div>
          <div class="nb-blocks" data-root></div>
          <div class="nb-tail" data-tail aria-hidden="true"></div>
        </div>
      </div>
      <div class="nb-scroll nb-preview" data-preview-pane hidden></div>
      <div class="nb-toolbar" data-toolbar role="toolbar" aria-label="Formatting" hidden>
        <button type="button" class="nb-tb-turn" data-fmt="turn" title="Turn into"><span data-turn-label>Text</span>${pixelIcon("chevron-down")}</button>
        <span class="nb-tb-sep" aria-hidden="true"></span>
        <button type="button" data-fmt="bold" title="Bold (Ctrl+B)"><b>B</b></button>
        <button type="button" data-fmt="italic" title="Italic (Ctrl+I)"><i>i</i></button>
        <button type="button" data-fmt="underline" title="Underline (Ctrl+U)"><u>U</u></button>
        <button type="button" data-fmt="strike" title="Strikethrough (Ctrl+Shift+S)"><s>S</s></button>
        <button type="button" data-fmt="code" title="Code (Ctrl+E)">${pixelIcon("code")}</button>
        <button type="button" data-fmt="math" title="Equation (Ctrl+Shift+E)">√x</button>
        <button type="button" data-fmt="link" title="Link (Ctrl+K)">${pixelIcon("link")}</button>
        <span class="nb-tb-sep" aria-hidden="true"></span>
        <button type="button" data-fmt="color" title="Text colour and background"><span class="nb-tb-a">A</span>${pixelIcon("chevron-down")}</button>
        <button type="button" data-fmt="more" title="More formatting">${pixelIcon("more-horizontal")}</button>
      </div>
      <input type="file" accept="image/png,image/jpeg,image/webp" data-file hidden />
      <input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" data-import hidden />
    </div>`);

  const $ = (s) => ed.querySelector(s);
  const root = $("[data-root]");
  const page = $("[data-page]");
  const titleEl = $("[data-title]");
  const toolbar = $("[data-toolbar]");
  const fileInput = $("[data-file]");

  /* ---- file picking (one hidden input, many callers) ---------------- */

  let onFile = null;
  const pickFile = (then) => { onFile = then; fileInput.value = ""; fileInput.click(); };
  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    if (file && onFile) onFile(file);
    onFile = null;
  });

  async function upload(file) {
    try {
      return await opts.uploadImage(file);
    } catch (err) {
      opts.toast(err.message || "Could not upload the image.", "error");
      return null;
    }
  }

  /** Notion's upload pane: choose, drop or paste (Ctrl+V) an image or an
   * image link, see it, then Save. `tiles` previews it on dark and light,
   * as a page icon sits on both themes; otherwise one wide preview (covers). */
  function mountUpload(box, { tiles = true, hint = "", onSave, onCancel }) {
    let chosen = null; // { file, src } or { url, src }
    const release = () => { if (chosen && chosen.file) URL.revokeObjectURL(chosen.src); };
    const choose = (next) => { release(); chosen = next; paint(); };
    const fromFile = (file) => {
      if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return opts.toast("Choose a PNG, JPEG or WebP image.", "error");
      choose({ file, src: URL.createObjectURL(file) });
    };
    const fromText = (text) => {
      const url = String(text || "").trim();
      if (/^https:\/\/\S+$/i.test(url)) choose({ url, src: url });
      else opts.toast("Paste an image, or a full image link starting with https://", "error");
    };
    function paint() {
      const img = chosen && `<img src="${escapeAttr(chosen.src)}" alt="" />`;
      box.innerHTML = chosen
        ? `<div class="nb-upload-preview">
             <span class="nb-upload-label">Preview</span>
             ${tiles ? `<div class="nb-upload-tiles"><span class="nb-upload-tile is-dark" title="On a dark page">${img}</span><span class="nb-upload-tile is-light" title="On a light page">${img}</span></div>`
               : `<span class="nb-upload-wide">${img}</span>`}
           </div>
           <div class="nb-upload-foot"><button type="button" class="nb-ghost" data-up-back>Back</button><button type="button" class="nb-primary" data-up-save>Save</button></div>`
        : `<button type="button" class="nb-upload-drop" data-up-choose>${pixelIcon("image")}<span>Upload an image</span></button>
           <p class="nb-upload-hint">or Ctrl+V to paste an image or link${hint ? `<br />${escapeHTML(hint)}` : ""}</p>
           <div class="nb-upload-foot"><button type="button" class="nb-ghost" data-up-cancel>Cancel</button><button type="button" class="nb-primary" data-up-save disabled>Save</button></div>`;
      const img2 = box.querySelector(".nb-upload-preview img");
      if (img2) img2.addEventListener("error", () => { opts.toast("That link is not an image we can show.", "error"); choose(null); }, { once: true });
      (box.querySelector("[data-up-save]:not(:disabled)") || box.querySelector("[data-up-choose]")).focus();
    }
    box.addEventListener("click", async (e) => {
      if (e.target.closest("[data-up-choose]")) return pickFile(fromFile);
      if (e.target.closest("[data-up-cancel]")) return onCancel();
      if (e.target.closest("[data-up-back]")) return choose(null);
      const save = e.target.closest("[data-up-save]");
      if (!save || !chosen) return;
      if (chosen.url) return onSave(chosen.url);
      save.disabled = true;
      save.textContent = "Uploading…";
      const url = await upload(chosen.file);
      if (url) { release(); chosen = null; onSave(url); }
      else if (save.isConnected) { save.disabled = false; save.textContent = "Save"; }
    });
    box.addEventListener("dragover", (e) => { e.preventDefault(); box.classList.add("is-over"); });
    box.addEventListener("dragleave", (e) => { if (!box.contains(e.relatedTarget)) box.classList.remove("is-over"); });
    box.addEventListener("drop", (e) => {
      e.preventDefault();
      box.classList.remove("is-over");
      const file = e.dataTransfer.files[0];
      if (file) fromFile(file);
      else fromText(e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain"));
    });
    // Ctrl+V anywhere while the pane is open; it stops listening once the pane is gone.
    const onPaste = (e) => {
      if (!box.isConnected) return document.removeEventListener("paste", onPaste, true);
      const file = [...e.clipboardData.files].find((f) => /^image\//.test(f.type));
      const text = e.clipboardData.getData("text/plain");
      if (!file && !text) return;
      e.preventDefault();
      e.stopPropagation();
      if (file) fromFile(file);
      else fromText(text);
    };
    document.addEventListener("paste", onPaste, true);
    paint();
  }

  /* ================================================================
   * Building blocks
   * ================================================================ */

  const gutterHTML = `
      <div class="nb-gutter" contenteditable="false">
        <button type="button" class="nb-plus" tabindex="-1" aria-label="Add a block below">${GUTTER_PLUS}<span class="nb-tip" role="tooltip"><b>Click</b> to add below<br /><b>Alt-click</b> to add a block above</span></button>
        <button type="button" class="nb-drag" tabindex="-1" aria-label="Drag to move, click for options">${GUTTER_GRIP}<span class="nb-tip" role="tooltip"><b>Drag</b> to move<br /><b>Click</b> or <b>Ctrl+/</b> to open menu</span></button>
      </div>`;

  function blockEl(b) {
    const el = h(`<div class="nb-block" data-type="${b.type}">${gutterHTML}<div class="nb-content"></div></div>`);
    const content = el.querySelector(".nb-content");
    el._attrs = { ...(b.attrs || {}) };
    // Focusable, so a selected block (Escape) receives the keys: retype, Delete, Ctrl+D, arrows.
    el.tabIndex = -1;
    if (LIST_TYPES.has(b.type)) el.dataset.indent = String(b.indent || 0);

    if (TEXT_TYPES.has(b.type)) {
      const text = h(`<div class="nb-text" contenteditable="true" spellcheck="true" data-placeholder="${escapeAttr(PLACEHOLDERS[b.type])}"></div>`);
      fillInline(text, b.text);
      if (b.type === "todo") {
        const box = h(`<input type="checkbox" class="nb-check" aria-label="Done" />`);
        box.checked = Boolean(b.checked);
        el.classList.toggle("is-done", box.checked);
        content.append(box);
      } else if (b.type === "bullet" || b.type === "number") {
        content.append(h(`<span class="nb-marker" aria-hidden="true"></span>`));
      } else if (b.type === "callout") {
        content.append(h(`<button type="button" class="nb-callout-icon" data-icon="${escapeAttr(b.icon || "💡")}" aria-label="Change callout icon">${emojiHTML(b.icon || "💡")}</button>`));
      } else if (b.type === "toggle") {
        content.append(h(`<button type="button" class="nb-caret" aria-label="Open or close" aria-expanded="true">${pixelIcon("chevron-right")}</button>`));
        el.classList.add("is-open");
      }
      content.append(text);
      if (/^h\d$/.test(b.type)) content.append(h(`<button type="button" class="nb-anchor" contenteditable="false" tabindex="-1" title="Copy link to this heading" aria-label="Copy link to this heading">${pixelIcon("link")}</button>`));
      if (b.type === "toggle") {
        const kids = h(`<div class="nb-blocks nb-children"></div>`);
        (b.children || []).forEach((c) => kids.append(blockEl(c)));
        content.append(kids);
        initSortable(kids);
      }
      applyAttrs(el);
      return el;
    }

    switch (b.type) {
      case "code": {
        const box = h(`<div class="nb-code">
          <div class="nb-code-bar" contenteditable="false">
            <select data-lang aria-label="Language">${LANGS.map((l) => `<option value="${l}">${l || "Plain text"}</option>`).join("")}</select>
            <button type="button" data-copy>${pixelIcon("copy")}<span>Copy</span></button>
          </div>
          <div class="nb-code-area"><pre aria-hidden="true"><code class="hljs"></code></pre><textarea class="nb-code-text" spellcheck="false" aria-label="Code"></textarea></div>
        </div>`);
        const select = box.querySelector("[data-lang]");
        if (b.lang && !LANGS.includes(b.lang)) select.append(new Option(b.lang, b.lang));
        select.value = b.lang || "";
        box.querySelector("textarea").value = b.code || "";
        content.append(box);
        paintCode(el);
        break;
      }
      case "math": {
        content.append(h(`<div class="nb-math">
          <div class="nb-math-view" data-math-view></div>
          <textarea class="nb-math-src" spellcheck="false" placeholder="E = mc^2" aria-label="TeX equation" hidden></textarea>
        </div>`));
        el.querySelector("textarea").value = b.tex || "";
        paintMath(el);
        break;
      }
      case "divider": content.append(h(`<hr />`)); break;
      case "toc": content.append(h(`<div class="nb-toc" data-toc></div>`)); break;
      case "image": case "video": case "bookmark":
        el.dataset.url = b.url || "";
        if (b.type === "image") el.dataset.caption = b.caption || "";
        paintMedia(el);
        break;
      case "table": {
        const rows = b.rows && b.rows.length ? b.rows : [["", ""], ["", ""], ["", ""]];
        el._align = (b.align || []).slice();
        content.append(h(`<div class="nb-table">
          <div class="nb-table-scroll"><table><tbody>${rows.map((r) => `<tr>${r.map(() => '<td class="nb-cell" contenteditable="true"></td>').join("")}</tr>`).join("")}</tbody></table></div>
          <button type="button" class="nb-th nb-th-row" data-row-handle tabindex="-1" aria-label="Row options" hidden>${GRIP_ROW}</button>
          <button type="button" class="nb-th nb-th-col" data-col-handle tabindex="-1" aria-label="Column options" hidden>${GRIP_COL}</button>
          <button type="button" class="nb-table-add nb-add-row" data-add-row title="Add a row" aria-label="Add a row">${GUTTER_PLUS}</button>
          <button type="button" class="nb-table-add nb-add-col" data-add-col title="Add a column" aria-label="Add a column">${GUTTER_PLUS}</button>
        </div>`));
        el.querySelectorAll("tr").forEach((tr, n) => tr.querySelectorAll("td").forEach((td, c) => fillInline(td, rows[n][c])));
        paintTable(el);
        break;
      }
      case "columns": {
        const cols = b.cols && b.cols.length ? b.cols : [[], []];
        const box = h(`<div class="nb-columns" style="--cols: ${cols.length}"></div>`);
        cols.forEach((c) => {
          const col = h(`<div class="nb-blocks nb-col"></div>`);
          (c.length ? c : [{ type: "p", text: "" }]).forEach((child) => col.append(blockEl(child)));
          box.append(col);
          initSortable(col);
        });
        content.append(box);
        break;
      }
    }
    return el;
  }

  /** Colour, background and alignment, plus list format and toggle headings. */
  function applyAttrs(el) {
    const a = el._attrs || {};
    const content = el.querySelector(":scope > .nb-content");
    content.className = "nb-content";
    if (a.color) content.classList.add(`c-${a.color}`);
    if (a.bg) content.classList.add(`bg-${a.bg}`, "has-bg");
    if (a.align && a.align !== "left") content.classList.add(`align-${a.align}`);
    if (typeOf(el) === "toggle") el.dataset.h = a.h || "";
  }

  function paintCode(block) {
    const ta = block.querySelector(".nb-code-text");
    const lang = block.querySelector("[data-lang]").value;
    block.querySelector(".nb-code-area code").innerHTML = `${highlightCode(ta.value, lang)}\n`;
  }

  function paintMath(block) {
    const tex = block.querySelector(".nb-math-src").value.trim();
    block.querySelector("[data-math-view]").innerHTML = tex
      ? renderMath(tex, true)
      : `<span class="nb-empty-hint">${pixelIcon("calculator")} Click to add a TeX equation</span>`;
  }

  function paintMedia(block) {
    const content = block.querySelector(":scope > .nb-content");
    const { type } = block.dataset;
    const url = block.dataset.url;
    if (!url) {
      const label = { image: "Add an image", video: "Embed a YouTube video", bookmark: "Add a web bookmark" }[type];
      const glyph = { image: "image", video: "youtube", bookmark: "bookmark" }[type];
      const placeholder = { image: "Paste an image link…", video: "Paste a YouTube link…", bookmark: "Paste a web address…" }[type];
      content.innerHTML = `<div class="nb-media-empty">
        <span class="nb-media-head">${pixelIcon(glyph)}<strong>${label}</strong></span>
        <div class="nb-media-row">
          ${type === "image" ? `<button type="button" class="nb-primary" data-media-upload>${pixelIcon("upload")}<span>Upload</span></button><span class="nb-muted">or</span>` : ""}
          <input type="url" placeholder="${placeholder}" data-media-url aria-label="${placeholder}" />
          <button type="button" class="nb-ghost nb-boxed" data-media-embed>Embed</button>
        </div>
      </div>`;
      return;
    }
    if (type === "image") {
      content.innerHTML = `<figure class="nb-figure">
        <div class="nb-figure-frame">
          <img src="${escapeAttr(url)}" alt="" draggable="false" />
          <span class="nb-resize nb-resize-l" data-resize="l" aria-hidden="true"></span>
          <span class="nb-resize nb-resize-r" data-resize="r" aria-hidden="true"></span>
          <div class="nb-media-tools" contenteditable="false">
            <button type="button" data-img-align="left" title="Align left">${pixelIcon("float-left")}</button>
            <button type="button" data-img-align="center" title="Centre">${pixelIcon("float-center")}</button>
            <button type="button" data-img-align="right" title="Align right">${pixelIcon("float-right")}</button>
            <button type="button" data-media-replace title="Replace">${pixelIcon("repeat")}</button>
            <a href="${escapeAttr(url)}" target="_blank" rel="noopener" title="Open original">${pixelIcon("external-link")}</a>
            <button type="button" data-media-clear title="Remove">${pixelIcon("trash")}</button>
          </div>
        </div>
        <figcaption class="nb-caption" contenteditable="true" data-placeholder="Write a caption…"></figcaption>
      </figure>`;
      content.querySelector(".nb-caption").textContent = block.dataset.caption || "";
      paintImage(block);
    } else if (type === "video") {
      const id = youtubeId(url);
      content.innerHTML = id
        ? `<div class="nb-video"><iframe src="https://www.youtube-nocookie.com/embed/${id}" title="YouTube video" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe><div class="nb-media-tools" contenteditable="false"><button type="button" data-media-clear title="Remove">${pixelIcon("trash")}</button></div></div>`
        : `<p class="nb-muted">That is not a YouTube link. <button type="button" class="nb-link" data-media-clear>Try another</button></p>`;
    } else {
      let host = url;
      try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* keep the address */ }
      content.innerHTML = `<a class="bookmark" href="${escapeAttr(url)}" target="_blank" rel="noopener"><strong>${escapeHTML(host)}</strong><span>${escapeHTML(url)}</span></a>
        <div class="nb-media-tools" contenteditable="false"><button type="button" data-media-clear title="Remove">${pixelIcon("trash")}</button></div>`;
    }
  }

  function paintImage(block) {
    const fig = block.querySelector(".nb-figure");
    if (!fig) return;
    const a = block._attrs || {};
    fig.style.width = a.width ? `${a.width}%` : "";
    fig.dataset.align = a.align || "center";
    fig.querySelectorAll("[data-img-align]").forEach((b) => b.classList.toggle("is-on", b.dataset.imgAlign === (a.align || "center")));
  }

  /** Header row, column alignment. */
  function paintTable(block) {
    const align = block._align || [];
    block.querySelectorAll("tr").forEach((tr, r) => tr.querySelectorAll("td").forEach((td, c) => {
      td.classList.toggle("is-head", r === 0);
      td.style.textAlign = align[c] && align[c] !== "left" ? align[c] : "";
    }));
  }

  /* ---- reading the DOM back into blocks ----------------------------- */

  const textEl = (block) => block && block.querySelector(":scope > .nb-content > .nb-text");
  const typeOf = (block) => block.dataset.type;

  function attrsFor(el) {
    const a = el._attrs || {};
    const type = typeOf(el);
    const keep = {};
    const pick = (k) => { if (a[k]) keep[k] = a[k]; };
    if (TEXT_TYPES.has(type)) { pick("color"); pick("bg"); pick("align"); }
    if (type === "number") pick("list");
    if (type === "toggle") pick("h");
    if (type === "image") { pick("width"); pick("align"); }
    return Object.keys(keep).length ? keep : undefined;
  }

  function readBlock(el) {
    const type = typeOf(el);
    const attrs = attrsFor(el);
    if (TEXT_TYPES.has(type)) {
      const b = { type, text: textOf(textEl(el), MULTILINE.has(type)) };
      if (attrs) b.attrs = attrs;
      if (LIST_TYPES.has(type)) b.indent = Number(el.dataset.indent || 0);
      if (type === "todo") b.checked = el.querySelector(".nb-check").checked;
      if (type === "callout") b.icon = el.querySelector(".nb-callout-icon").dataset.icon || "💡";
      if (type === "toggle") b.children = readBlocks(el.querySelector(":scope > .nb-content > .nb-children"));
      return b;
    }
    switch (type) {
      case "code": return { type, lang: el.querySelector("[data-lang]").value, code: el.querySelector(".nb-code-text").value };
      case "math": return { type, tex: el.querySelector(".nb-math-src").value };
      case "image": {
        const cap = el.querySelector(".nb-caption");
        return { type, url: el.dataset.url, caption: cap ? cap.textContent.replace(/\s+/g, " ").trim() : "", ...(attrs ? { attrs } : {}) };
      }
      case "video": case "bookmark": return { type, url: el.dataset.url };
      case "table": {
        const rows = [...el.querySelectorAll(":scope .nb-table-scroll tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => textOf(td, false)));
        const align = (el._align || []).slice(0, rows[0] ? rows[0].length : 0);
        return { type, rows, ...(align.some((x) => x && x !== "left") ? { align: rows[0].map((_, c) => align[c] || "left") } : {}) };
      }
      case "columns": return { type, cols: [...el.querySelectorAll(":scope > .nb-content > .nb-columns > .nb-col")].map(readBlocks) };
      default: return { type };
    }
  }
  const readBlocks = (container) => [...container.children].filter((c) => c.classList.contains("nb-block")).map(readBlock);
  const bodyMarkdown = () => serializeBlocks(readBlocks(root));

  /* ---- order, numbering, contents ----------------------------------- */

  /** Every block in reading order, skipping those inside closed toggles. */
  const allBlocks = () => [...root.querySelectorAll(".nb-block")].filter((b) => !b.parentElement.closest(".nb-block[data-type='toggle']:not(.is-open)") && typeOf(b) !== "columns");

  function refreshDerived() {
    root.querySelectorAll(".nb-blocks").forEach((c) => numberIn(c));
    numberIn(root);
    const ids = new Set();
    const headings = [];
    root.querySelectorAll('.nb-block[data-type^="h"]').forEach((b) => {
      const text = textOf(textEl(b), false);
      b._anchor = null;
      if (!text) return;
      const base = inlineText(text).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
      let id = base;
      for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
      ids.add(id);
      b._anchor = id;
      headings.push({ level: Number(typeOf(b)[1]) + 1, id, text, block: b });
    });
    root.querySelectorAll("[data-toc]").forEach((toc) => {
      toc.innerHTML = tocHTML(headings);
      toc.querySelectorAll("a").forEach((a, i) => { a.dataset.jump = String(i); a.removeAttribute("href"); });
      toc._headings = headings;
    });
    const md = bodyMarkdown();
    const { words, minutes } = readingTime(md);
    $("[data-words]").textContent = words ? `${words} words · ${minutes} min read` : "";
  }

  function numberIn(container) {
    const counts = [];
    const formats = [];
    let prevList = false;
    for (const b of container.children) {
      if (!b.classList.contains("nb-block")) continue;
      const type = typeOf(b);
      if (!LIST_TYPES.has(type)) { counts.length = 0; formats.length = 0; prevList = false; continue; }
      const indent = Number(b.dataset.indent || 0);
      counts.length = indent + 1;
      formats.length = indent + 1;
      if (type === "number") {
        const first = !(prevList && counts[indent]);
        if (first) formats[indent] = (b._attrs && b._attrs.list) || "1";
        counts[indent] = first ? 1 : counts[indent] + 1;
        b.querySelector(".nb-marker").textContent = `${listMarker(counts[indent], formats[indent])}.`;
      } else {
        counts[indent] = 0;
        if (type === "bullet") b.querySelector(".nb-marker").textContent = ["•", "◦", "▪"][indent % 3];
      }
      prevList = true;
    }
  }

  /** A column left empty by dragging goes; one column left unwraps. */
  function tidyColumns() {
    root.querySelectorAll(".nb-block[data-type='columns']").forEach((cb) => {
      const box = cb.querySelector(":scope > .nb-content > .nb-columns");
      box.querySelectorAll(":scope > .nb-col").forEach((col) => { if (!col.querySelector(":scope > .nb-block")) col.remove(); });
      const cols = box.querySelectorAll(":scope > .nb-col");
      if (cols.length <= 1) {
        cb.replaceWith(...(cols[0] ? [...cols[0].children] : []));
      } else {
        box.style.setProperty("--cols", cols.length);
      }
    });
    if (!root.querySelector(".nb-block")) root.append(blockEl({ type: "p", text: "" }));
  }

  /* ================================================================
   * Changes, history, saving
   * ================================================================ */

  function snapshot() {
    return { title: titleEl.textContent, body: bodyMarkdown() };
  }

  function commitHistory() {
    clearTimeout(historyTimer);
    const snap = snapshot();
    const last = history[historyAt];
    if (last && last.title === snap.title && last.body === snap.body) return;
    history.splice(historyAt + 1);
    history.push(snap);
    if (history.length > 200) history.shift();
    historyAt = history.length - 1;
  }

  function changed({ structural = false } = {}) {
    if (structural) tidyColumns();
    dirty = true;
    refreshDerived();
    paintState();
    $("[data-crumb]").textContent = titleEl.textContent.trim() || "Untitled";
    if (structural) commitHistory();
    else {
      clearTimeout(historyTimer);
      historyTimer = setTimeout(commitHistory, 600);
    }
    scheduleSave();
    if (findState.open) refreshFind();
  }

  const scheduleSave = () => {
    clearTimeout(autosaveTimer);
    if (post.status === "draft") autosaveTimer = setTimeout(() => save({ quiet: true }), 1400);
  };

  function restore(snap) {
    const order = allBlocks();
    const focusIndex = order.indexOf(document.activeElement && document.activeElement.closest(".nb-block"));
    titleEl.textContent = snap.title;
    loadBody(snap.body);
    dirty = true;
    refreshDerived();
    paintState();
    scheduleSave();
    const target = allBlocks()[Math.max(0, Math.min(focusIndex, allBlocks().length - 1))];
    if (target) focusBlock(target, true);
  }

  function undo(redo = false) {
    commitHistory();
    const next = historyAt + (redo ? 1 : -1);
    if (next < 0 || next >= history.length) return;
    historyAt = next;
    restore(history[historyAt]);
  }

  function values() {
    const title = titleEl.textContent.replace(/\s+/g, " ").trim();
    const slugInput = ed.querySelector("[data-prop=slug]");
    return {
      title,
      slug: post.published_at ? post.slug : slugify(slugInput.value) || slugify(title),
      status: post.status,
      authors: post.authors,
      author_name: authorNames(post.authors) || null,
      excerpt: ed.querySelector("[data-prop=excerpt]").value.trim() || null,
      cover_url: post.cover_url || null,
      cover_position: Math.round(post.cover_position),
      icon: post.icon || null,
      font: post.font || "default",
      small_text: Boolean(post.small_text),
      full_width: Boolean(post.full_width),
      locked: Boolean(post.locked),
      body: bodyMarkdown(),
    };
  }

  function paintState(text) {
    const state = $("[data-state]");
    state.textContent = text || (saving ? "Saving…" : dirty ? (post.status === "published" ? "Unpublished changes" : "Editing") : post.id ? "Saved" : "Not saved yet");
    const button = $("[data-save]");
    button.textContent = post.status === "published" ? "Update" : "Publish";
    button.disabled = post.status === "published" && !dirty;
  }

  async function save({ quiet = false, status } = {}) {
    clearTimeout(autosaveTimer);
    if (saving) { await saving; if (!dirty && !status) return true; }
    const v = values();
    if (status) v.status = status;
    if (!v.title) {
      if (!quiet) {
        opts.toast("Give the post a title first: it becomes its web address.", "error");
        placeCaret(titleEl);
      }
      return false;
    }
    if (!v.slug) {
      if (!quiet) opts.toast("Use some letters or numbers in the title or address.", "error");
      return false;
    }
    const wasLive = post.status === "published";
    const was = dirty;
    dirty = false;
    saving = opts.save(v, { id: post.id, wasLive });
    paintState();
    try {
      const row = await saving;
      Object.assign(post, row || {}, { status: v.status });
      paintProps();
      if (!quiet && !status) opts.toast(post.status === "published" ? "Updated. The site rebuilds in about a minute." : "Saved.", "info");
      return true;
    } catch (err) {
      dirty = dirty || was;
      opts.toast(err.message || "Could not save.", "error");
      paintState("Save failed");
      return false;
    } finally {
      saving = null;
      paintState();
    }
  }

  /* ================================================================
   * Page header: cover, icon, title, properties, page style
   * ================================================================ */

  function paintCover() {
    const cover = $("[data-cover]");
    cover.hidden = !post.cover_url;
    $("[data-cover-img]").src = post.cover_url || "";
    $("[data-cover-img]").style.objectPosition = `50% ${post.cover_position}%`;
    $("[data-add-cover]").hidden = Boolean(post.cover_url);
    ed.classList.toggle("has-cover", Boolean(post.cover_url));
  }

  function paintIcon() {
    $("[data-icon]").hidden = !post.icon;
    $("[data-icon-btn]").innerHTML = iconHTML(post.icon);
    $("[data-add-icon]").hidden = Boolean(post.icon);
    ed.classList.toggle("has-icon", Boolean(post.icon));
  }

  /** Font, small text, full width, lock and zoom. */
  function paintPageStyle() {
    ed.classList.remove("font-mono", "font-technical", "font-garet");
    if (["mono", "technical", "garet"].includes(post.font)) ed.classList.add(`font-${post.font}`);
    ed.classList.toggle("is-small", Boolean(post.small_text));
    ed.classList.toggle("is-wide", Boolean(post.full_width));
    ed.classList.toggle("is-page-locked", Boolean(post.locked));
    page.inert = Boolean(post.locked);
    $("[data-cover]").inert = Boolean(post.locked);
    $("[data-unlock]").hidden = !post.locked;
    page.style.zoom = zoom === 100 ? "" : String(zoom / 100);
  }

  const dateText = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");

  function paintProps() {
    const props = $("[data-props]");
    const keep = props.querySelector(":focus");
    if (keep && props.dataset.built) {
      // Do not rebuild under the cursor; just refresh the read-only rows.
      props.querySelector("[data-status-pill]").outerHTML = statusPill();
      props.querySelector("[data-published]").textContent = post.published_at ? dateText(post.published_at) : "Not yet";
      return;
    }
    const locked = Boolean(post.published_at);
    const current = props.dataset.built ? { excerpt: props.querySelector("[data-prop=excerpt]").value, slug: props.querySelector("[data-prop=slug]").value } : null;
    props.innerHTML = `
      <div class="nb-prop"><span class="nb-prop-label">${pixelIcon("circle-info")}Status</span><span>${statusPill()}</span></div>
      <label class="nb-prop"><span class="nb-prop-label">${pixelIcon("link")}Address</span><span class="nb-prop-slug"><span class="nb-muted">/blog/</span><input data-prop="slug" ${locked ? "readonly title=\"Fixed once published, so shared links keep working\"" : ""} placeholder="made from the title" spellcheck="false" /></span></label>
      <div class="nb-prop"><span class="nb-prop-label">${pixelIcon("users")}Authors</span><span><button type="button" class="nb-authors" data-authors aria-haspopup="dialog"></button></span></div>
      ${whoamiRow()}
      <label class="nb-prop"><span class="nb-prop-label">${pixelIcon("pencil")}Summary</span><textarea data-prop="excerpt" rows="1" maxlength="300" placeholder="Empty: the start of the post is used in link previews"></textarea></label>
      <div class="nb-prop"><span class="nb-prop-label">${pixelIcon("calendar")}Published</span><span data-published>${post.published_at ? escapeHTML(dateText(post.published_at)) : "Not yet"}</span></div>`;
    props.dataset.built = "1";
    props.querySelector("[data-prop=slug]").value = locked ? post.slug : (current && current.slug) || post.slug || "";
    paintAuthors();
    props.querySelector("[data-prop=excerpt]").value = current ? current.excerpt : post.excerpt || "";
    autosize(props.querySelector("[data-prop=excerpt]"));
  }

  /** Until you link your login to your member card, ask (once linked, the Team page changes it). */
  function whoamiRow() {
    if (!opts.whoami || !opts.me || opts.me.linked) return "";
    const guess = opts.meGuess;
    return `<div class="nb-prop"><span class="nb-prop-label">${pixelIcon("user")}You are</span><span><button type="button" class="nb-whoami" data-whoami aria-haspopup="dialog">${guess ? avatarHTML(guess) : ""}<span>${guess ? `${escapeHTML(guess.name)}? Confirm your member card` : "Which member card are you?"}</span></button></span></div>`;
  }

  function onLinked(fresh) {
    team.splice(0, team.length, ...fresh);
    const me = team.find((t) => t.id === opts.me.id);
    if (me) opts.me = me;
    // Your entry in the byline takes the card's name and picture.
    if (post.authors.some((a) => a.id === opts.me.id)) {
      post.authors = post.authors.map((a) => (a.id === opts.me.id ? authorOf(opts.me) : a));
      changed();
    }
    paintProps();
  }

  function paintAuthors() {
    const btn = ed.querySelector("[data-authors]");
    if (!btn) return;
    const list = post.authors;
    btn.innerHTML = list.length
      ? `${avatarGroupHTML(list, 4)}<span class="nb-authors-names">${escapeHTML(authorNames(list))}</span>`
      : '<span class="nb-muted">Add an author</span>';
    btn.title = list.length ? "Change authors" : "Add an author";
  }

  /** Pick authors: the club's admins and editors, plus guests by name. Stays open for several picks. */
  function openAuthorPicker(anchor) {
    const el = openPopover(`
      <div class="nb-list-search"><input type="text" placeholder="Search people, or type a guest's name" aria-label="Search people" data-author-q /></div>
      <div class="nb-list" role="listbox" aria-multiselectable="true" data-author-list></div>
      <div class="nb-menu-foot"><span>Shown under the title, with their pictures</span></div>`, anchor.getBoundingClientRect(), { className: "nb-menu", width: 320 });
    const q = el.querySelector("[data-author-q]");
    const list = el.querySelector("[data-author-list]");
    let rows = [];
    const has = (a) => post.authors.some((x) => (a.id ? x.id === a.id : !x.id && x.name.toLowerCase() === a.name.toLowerCase()));
    const paint = () => {
      const query = q.value.trim();
      const low = query.toLowerCase();
      const members = team.filter((t) => !low || t.name.toLowerCase().includes(low));
      const guests = post.authors.filter((a) => !a.id && (!low || a.name.toLowerCase().includes(low)));
      const exact = [...team, ...post.authors].some((a) => a.name.toLowerCase() === low);
      rows = [
        ...members.map((t) => ({ person: t, section: "Club members", note: t.role === "admin" ? "Admin" : "Editor" })),
        ...guests.map((g) => ({ person: g, section: "Guests", note: "Guest" })),
        ...(query && !exact ? [{ add: query, section: "Guests" }] : []),
      ];
      let section = "";
      list.innerHTML = rows.map((r, i) => {
        const head = r.section !== section ? `<p class="nb-pop-section">${escapeHTML((section = r.section))}</p>` : "";
        if (r.add) return `${head}<button type="button" class="nb-item" data-r="${i}"><span class="nb-item-icon">${pixelIcon("user-plus")}</span><span class="nb-item-label">Add “${escapeHTML(r.add)}” as a guest author</span></button>`;
        const on = has(r.person);
        return `${head}<button type="button" class="nb-item${on ? " is-picked" : ""}" data-r="${i}" role="option" aria-selected="${on}">${avatarHTML(r.person, "avatar nb-item-avatar")}<span class="nb-item-label">${escapeHTML(r.person.name)}<small>${r.note}</small></span>${on ? `<span class="nb-item-check">${pixelIcon("check")}</span>` : ""}</button>`;
      }).join("") || (team.length ? '<p class="nb-pop-empty">No one by that name.</p>' : '<p class="nb-pop-empty">Type a name to add an author.</p>');
    };
    paint();
    placePopover(el, anchor.getBoundingClientRect());
    q.focus();
    q.addEventListener("input", paint);
    q.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const first = list.querySelector("[data-r]");
        if (first) first.click();
      }
    });
    list.addEventListener("click", (e) => {
      // The list redraws below, detaching the clicked row; keep this click
      // from reaching the "click outside closes the menu" check.
      e.stopPropagation();
      const b = e.target.closest("[data-r]");
      if (!b) return;
      const r = rows[Number(b.dataset.r)];
      if (r.add) {
        if (post.authors.length >= 12) return opts.toast("Twelve authors is the most a post can have.", "error");
        post.authors = [...post.authors, { name: r.add.slice(0, 80) }];
        q.value = "";
      } else if (has(r.person)) {
        post.authors = post.authors.filter((x) => !(r.person.id ? x.id === r.person.id : !x.id && x.name === r.person.name));
      } else {
        if (post.authors.length >= 12) return opts.toast("Twelve authors is the most a post can have.", "error");
        post.authors = [...post.authors, authorOf(r.person)];
      }
      paintAuthors();
      paint();
      changed();
      q.focus();
    });
  }

  const statusPill = () => `<span class="nb-pill is-${post.status}" data-status-pill>${post.status === "published" ? "Published" : "Draft"}</span>`;
  const autosize = (ta) => { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight}px`; };

  /* ================================================================
   * Block operations
   * ================================================================ */

  function focusBlock(block, atEnd = true) {
    selectBlock(null);
    const text = textEl(block);
    if (text) return placeCaret(text, atEnd);
    const ta = block.querySelector(".nb-code-text");
    if (ta) return placeCaret(ta, atEnd);
    const cell = block.querySelector(".nb-cell");
    if (cell) return placeCaret(cell, atEnd);
    selectBlock(block);
  }

  function selectBlock(block) {
    if (selectedBlock) selectedBlock.classList.remove("is-selected");
    selectedBlock = block;
    if (block) {
      block.classList.add("is-selected");
      block.focus({ preventScroll: true });
      block.scrollIntoView({ block: "nearest" });
      sel().removeAllRanges();
    }
  }

  function insertAfter(ref, b, container) {
    const el = blockEl(b);
    if (ref) ref.after(el);
    else (container || root).append(el);
    return el;
  }

  function convert(block, type, extra = {}) {
    const b = readBlock(block);
    const attrs = { ...(b.attrs || {}) };
    if (type !== "toggle") delete attrs.h;
    if (type !== "number") delete attrs.list;
    const next = { type, text: b.text || "", indent: LIST_TYPES.has(type) ? b.indent || 0 : 0, attrs, ...extra };
    if (type === "toggle") next.children = [];
    const el = blockEl(next);
    block.replaceWith(el);
    if (b.type === "toggle" && b.children && b.children.length) {
      // Unwrapping a toggle keeps what was inside it, after it.
      let at = el;
      b.children.forEach((c) => { at = insertAfter(at, c); });
    }
    return el;
  }

  function removeBlock(block, { focusPrev = true } = {}) {
    const order = allBlocks();
    const i = order.indexOf(block);
    block.remove();
    changed({ structural: true });
    if (focusPrev) {
      const target = order[i - 1] && order[i - 1].isConnected ? order[i - 1] : allBlocks()[0];
      if (target) focusBlock(target, true);
    }
  }

  function duplicate(block) {
    const copy = blockEl(readBlock(block));
    block.after(copy);
    changed({ structural: true });
    focusBlock(copy);
  }

  function moveBlock(block, delta) {
    const sib = delta < 0 ? block.previousElementSibling : block.nextElementSibling;
    if (!sib || !sib.classList.contains("nb-block")) return;
    if (delta < 0) sib.before(block); else sib.after(block);
    changed({ structural: true });
    focusBlock(block);
  }

  /** Enter: split the text at the caret into a new block below. */
  function splitBlock(block) {
    const type = typeOf(block);
    const text = textEl(block);
    if (sel().rangeCount && !sel().isCollapsed) sel().deleteFromDocument();

    // Enter on an empty list item, to-do, quote or callout ends it.
    if (isEmptyText(text) && type !== "p" && !/^h/.test(type)) {
      if (LIST_TYPES.has(type) && Number(block.dataset.indent) > 0) return indent(block, -1);
      const el = convert(block, "p");
      changed({ structural: true });
      return placeCaret(textEl(el));
    }

    const nextType = LIST_TYPES.has(type) ? type : "p";
    const atStart = caretAt(text, false) && !isEmptyText(text);
    const r = rangeNow();
    const tail = document.createRange();
    tail.selectNodeContents(text);
    if (r && text.contains(r.startContainer)) tail.setStart(r.startContainer, r.startOffset);
    const frag = atStart ? null : tail.extractContents();

    const b = { type: nextType, text: "", indent: Number(block.dataset.indent || 0) };
    let el;
    if (atStart) {
      el = blockEl(b);
      block.before(el);
      changed({ structural: true });
      return placeCaret(text, false);
    }
    if (type === "toggle" && block.classList.contains("is-open")) {
      el = blockEl(b);
      block.querySelector(":scope > .nb-content > .nb-children").prepend(el);
    } else {
      el = insertAfter(block, b);
    }
    const target = textEl(el);
    if (frag && frag.textContent.replace(/\u200b/g, "")) target.append(frag);
    target.normalize();
    if (!text.textContent && !text.querySelector(".math, img, .mention, .mention-date")) text.innerHTML = "";
    changed({ structural: true });
    placeCaret(target, false);
  }

  /** Backspace at the start of a block. */
  function backspaceAtStart(block) {
    const type = typeOf(block);
    if (LIST_TYPES.has(type) && Number(block.dataset.indent) > 0) return indent(block, -1);
    if (type !== "p") {
      const el = convert(block, "p");
      changed({ structural: true });
      return placeCaret(textEl(el), false);
    }
    const prev = block.previousElementSibling;
    const text = textEl(block);
    if (!prev || !prev.classList.contains("nb-block")) {
      // First block inside a toggle: step out of it.
      const parentBlock = block.parentElement.closest(".nb-block");
      if (parentBlock && typeOf(parentBlock) === "toggle" && isEmptyText(text)) {
        block.remove();
        changed({ structural: true });
        return placeCaret(textEl(parentBlock));
      }
      return;
    }
    const prevText = TEXT_TYPES.has(typeOf(prev)) && typeOf(prev) !== "toggle" ? textEl(prev) : null;
    if (!prevText) {
      if (isEmptyText(text)) { block.remove(); changed({ structural: true }); }
      return selectBlock(prev);
    }
    mergeInto(prevText, text);
    block.remove();
    changed({ structural: true });
  }

  function mergeInto(target, source) {
    // Drop a lone <br> the browser leaves in an emptied editable.
    if (isEmptyText(target)) target.innerHTML = "";
    const last = target.lastChild;
    const r = document.createRange();
    if (last && last.nodeType === 3) r.setStart(last, last.length);
    else { r.selectNodeContents(target); r.collapse(false); }
    const first = source.firstChild;
    if (isEmptyText(source)) source.innerHTML = "";
    while (source.firstChild) target.append(source.firstChild);
    if (!(last && last.nodeType === 3) && first && first.isConnected) r.setStartBefore(first);
    target.normalize();
    target.focus({ preventScroll: true });
    try {
      r.collapse(true);
      sel().removeAllRanges();
      sel().addRange(r);
    } catch {
      placeCaret(target);
    }
  }

  function indent(block, delta) {
    if (!LIST_TYPES.has(typeOf(block))) return;
    const prev = block.previousElementSibling;
    const max = prev && LIST_TYPES.has(typeOf(prev)) ? Number(prev.dataset.indent || 0) + 1 : 0;
    const next = Math.max(0, Math.min(Number(block.dataset.indent || 0) + delta, max, 6));
    block.dataset.indent = String(next);
    changed({ structural: true });
  }

  function setAttr(block, key, value) {
    block._attrs = { ...(block._attrs || {}) };
    if (value) block._attrs[key] = value;
    else delete block._attrs[key];
    if (typeOf(block) === "image") paintImage(block);
    else applyAttrs(block);
    changed({ structural: true });
  }

  /* ---- Markdown shortcuts at the start of a paragraph ---------------- */

  const SHORTCUTS = [
    [/^#\s$/, "h1"], [/^##\s$/, "h2"], [/^###\s$/, "h3"], [/^####\s$/, "h4"],
    [/^[-*+]\s$/, "bullet"], [/^1[.)]\s$/, "number"], [/^a[.)]\s$/, "number", { attrs: { list: "a" } }], [/^i[.)]\s$/, "number", { attrs: { list: "i" } }],
    [/^\[\s?\]\s$/, "todo"], [/^\[x\]\s$/i, "todo", { checked: true }],
    [/^["“]\s$/, "quote"], [/^>\s$/, "toggle"], [/^!\s$/, "callout"],
    [/^```$/, "code"], [/^---$/, "divider"], [/^\$\$\s$/, "math"],
  ];

  function tryShortcut(block) {
    if (typeOf(block) !== "p") return false;
    const text = textEl(block);
    const raw = text.textContent.replace(/\u00a0/g, " ");
    const hit = SHORTCUTS.find(([re]) => re.test(raw));
    if (!hit) {
      // Typing the shortcut before existing text: "# " + rest.
      const lead = /^(#{1,4}|[-*+]|1[.)]|\[\s?\]|["“]|>)\s/.exec(raw);
      if (!lead || !caretAfterPrefix(text, lead[0].length)) return false;
      const found = SHORTCUTS.find(([re]) => re.test(lead[0]));
      if (!found || !TEXT_TYPES.has(found[1])) return false;
      stripPrefix(text, lead[0].length);
      const el = convert(block, found[1], found[2]);
      changed({ structural: true });
      placeCaret(textEl(el), false);
      return true;
    }
    const [, type, extra] = hit;
    text.innerHTML = "";
    let el;
    if (TEXT_TYPES.has(type)) {
      el = convert(block, type, { ...extra, text: "" });
      placeCaret(textEl(el));
    } else {
      el = convert(block, type);
      afterInsert(el);
    }
    changed({ structural: true });
    return true;
  }

  function caretAfterPrefix(text, n) {
    const r = rangeNow();
    if (!r) return false;
    const probe = document.createRange();
    probe.selectNodeContents(text);
    probe.setEnd(r.startContainer, r.startOffset);
    return probe.toString().length === n;
  }

  function stripPrefix(text, n) {
    const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    let left = n;
    for (let node = walker.nextNode(); node && left > 0; node = walker.nextNode()) {
      const take = Math.min(left, node.length);
      node.deleteData(0, take);
      left -= take;
    }
  }

  /** After creating a block that is not text, put the user where they type next. */
  function afterInsert(el) {
    const type = typeOf(el);
    if (type === "divider" || type === "toc") {
      const next = el.nextElementSibling;
      const p = next && typeOf(next) === "p" && isEmptyText(textEl(next)) ? next : insertAfter(el, { type: "p", text: "" });
      return placeCaret(textEl(p));
    }
    if (type === "code") return placeCaret(el.querySelector(".nb-code-text"));
    if (type === "math") return openMath(el);
    if (type === "table") return placeCaret(el.querySelector(".nb-cell"));
    if (type === "columns") return placeCaret(textEl(el.querySelector(".nb-col .nb-block")));
    if (type === "image" || type === "video" || type === "bookmark") {
      const input = el.querySelector("[data-media-url]");
      if (input) input.focus();
    }
  }

  /* ---- inline formatting --------------------------------------------- */

  const INLINE_RULES = [
    [/\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, "strong", 2],
    [/(?:^|[^*\\])\*([^*\s](?:[^*]*[^*\s])?)\*$/, "em", 1],
    [/\+\+([^+\s](?:[^+]*[^+\s])?)\+\+$/, "u", 2],
    [/~~([^~\s](?:[^~]*[^~\s])?)~~$/, "s", 2],
    [/==([^=\s](?:[^=]*[^=\s])?)==$/, "mark", 2],
    [/`([^`]+)`$/, "code", 1],
    [/(?:^|[^\\$])\$([^\s$](?:[^$]*[^\s$])?)\$$/, "math", 1],
  ];

  function tryInlineRule() {
    const r = rangeNow();
    if (!r || !r.collapsed || r.startContainer.nodeType !== 3) return false;
    const node = r.startContainer;
    if (node.parentElement.closest("code, .math")) return false;
    const before = node.data.slice(0, r.startOffset);
    for (const [re, tag, markLen] of INLINE_RULES) {
      const m = re.exec(before);
      if (!m) continue;
      const inner = m[1];
      const start = r.startOffset - inner.length - markLen * 2;
      const span = document.createRange();
      span.setStart(node, start);
      span.setEnd(node, r.startOffset);
      span.deleteContents();
      const el = tag === "math" ? mathSpan(inner) : document.createElement(tag);
      if (tag !== "math") el.textContent = inner;
      span.insertNode(el);
      caretAfter(el);
      return true;
    }
    return false;
  }

  function mathSpan(tex) {
    const el = document.createElement("span");
    el.className = "math";
    el.dataset.tex = tex;
    el.contentEditable = "false";
    el.innerHTML = renderMath(tex);
    return el;
  }

  /** Put the caret just after an inline element, outside it. */
  function caretAfter(el) {
    const gap = document.createTextNode("\u200b");
    el.after(gap);
    const r = document.createRange();
    r.setStart(gap, 1);
    r.collapse(true);
    sel().removeAllRanges();
    sel().addRange(r);
  }

  const hostOf = (r) => (r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement);
  const editableOf = (node) => node && node.closest && node.closest(".nb-text, .nb-cell, .nb-caption");

  function wrapSelection(tag, className) {
    const r = rangeNow();
    if (!r || r.collapsed) return;
    const host = hostOf(r);
    if (!className) {
      const existing = host.closest(tag);
      if (existing && editableOf(existing)) {
        existing.replaceWith(...existing.childNodes);
        return;
      }
    }
    const el = document.createElement(tag);
    if (className) el.className = className;
    const frag = r.extractContents();
    if (tag === "code") el.textContent = frag.textContent;
    else el.append(frag);
    r.insertNode(el);
    const after = document.createRange();
    after.selectNodeContents(el);
    sel().removeAllRanges();
    sel().addRange(after);
  }

  /** Text colour or background on the selection; "default" removes it. */
  function colorSelection(kind, color) {
    const r = rangeNow();
    if (!r || r.collapsed) return;
    const prefix = kind === "bg" ? "bg-" : "c-";
    const editable = editableOf(hostOf(r));
    if (!editable) return;
    // Remove that kind of colour inside the selection first.
    const frag = r.extractContents();
    frag.querySelectorAll("span").forEach((s) => {
      [...s.classList].filter((c) => c.startsWith(prefix)).forEach((c) => s.classList.remove(c));
      if (!s.className) s.replaceWith(...s.childNodes);
    });
    let node = frag;
    if (color !== "default") {
      const span = document.createElement("span");
      span.className = `${prefix}${color}`;
      span.append(frag);
      node = span;
    }
    const marker = document.createTextNode("");
    r.insertNode(marker);
    marker.after(node);
    const after = document.createRange();
    if (node.nodeType === 1 && node.tagName === "SPAN") after.selectNodeContents(node);
    else { after.setStartAfter(marker); after.collapse(true); }
    marker.remove();
    sel().removeAllRanges();
    sel().addRange(after);
  }

  function clearFormatting() {
    const r = rangeNow();
    if (!r || r.collapsed) return;
    const text = document.createTextNode(r.toString());
    r.deleteContents();
    r.insertNode(text);
    const after = document.createRange();
    after.selectNodeContents(text);
    sel().removeAllRanges();
    sel().addRange(after);
  }

  function format(kind) {
    const r = rangeNow();
    if (!r) return;
    if (kind === "bold") document.execCommand("bold");
    else if (kind === "italic") document.execCommand("italic");
    else if (kind === "underline") document.execCommand("underline");
    else if (kind === "strike") document.execCommand("strikeThrough");
    else if (kind === "sup") document.execCommand("superscript");
    else if (kind === "sub") document.execCommand("subscript");
    else if (kind === "code") wrapSelection("code");
    else if (kind === "mark") wrapSelection("mark");
    else if (kind === "clear") clearFormatting();
    else if (kind === "link") return openLink();
    else if (kind === "turn") return openTurnInto();
    else if (kind === "color") return openColorMenu();
    else if (kind === "more") return openMoreFormat();
    else if (kind === "math") {
      const tex = r.toString();
      r.deleteContents();
      const el = mathSpan(tex || "x");
      r.insertNode(el);
      caretAfter(el);
      openInlineMath(el);
    }
    changed();
    paintToolbar();
  }

  /* ================================================================
   * Popovers
   * ================================================================ */

  function closePopover() {
    if (!popover) return;
    const { el, onClose } = popover;
    popover = null;
    el.remove();
    ed.classList.remove("is-menu-open");
    if (onClose) onClose();
  }

  /** A floating panel. While one is open the page does not scroll, as in Notion. */
  function openPopover(html, anchorRect, { onClose, className = "", width, keepSelection = false } = {}) {
    closePopover();
    const el = h(`<div class="nb-pop ${className}" role="dialog">${html}</div>`);
    if (width) el.style.width = `${width}px`;
    if (keepSelection) el.addEventListener("mousedown", (e) => { if (!e.target.closest("input, textarea")) e.preventDefault(); });
    ed.append(el);
    ed.classList.add("is-menu-open");
    placePopover(el, anchorRect);
    popover = { el, onClose };
    return el;
  }

  /** Below the anchor if it fits, else above; if neither fits, on the
   * roomier side with its height capped, so every item stays reachable
   * (the page cannot scroll while a menu is open). */
  function placePopover(el, anchorRect) {
    const gap = 6;
    const edge = 8;
    el.style.maxHeight = "";
    const natural = el.getBoundingClientRect().height;
    const below = innerHeight - anchorRect.bottom - gap - edge;
    const above = anchorRect.top - gap - edge;
    let top;
    if (natural <= below) top = anchorRect.bottom + gap;
    else if (natural <= above) top = anchorRect.top - gap - natural;
    else if (below >= above) { el.style.maxHeight = `${below}px`; top = anchorRect.bottom + gap; }
    else { el.style.maxHeight = `${above}px`; top = edge; }
    const box = el.getBoundingClientRect();
    el.style.top = `${Math.max(edge, top)}px`;
    el.style.left = `${Math.max(edge, Math.min(anchorRect.left, innerWidth - box.width - edge))}px`;
  }

  const caretRect = () => {
    const r = rangeNow();
    if (!r) return null;
    const rect = r.getClientRects()[0];
    if (rect) return rect;
    const node = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
    return node.getBoundingClientRect();
  };

  /* ---- a searchable list of actions (block menu, table menus, turn into)
   * items: {id, label, icon?, hint?, section?, current?, danger?, swatch?, run} */

  function itemHTML(it, i, active) {
    const lead = it.swatch
      ? `<span class="nb-item-swatch ${it.swatch}">A</span>`
      : it.icon ? `<span class="nb-item-icon">${pixelIcon(it.icon)}</span>` : "";
    return `<button type="button" class="nb-item${i === active ? " is-active" : ""}${it.danger ? " is-danger" : ""}" data-i="${i}" role="option" aria-selected="${i === active}">
      ${lead}<span class="nb-item-label">${escapeHTML(it.label)}</span>
      ${it.current ? `<span class="nb-item-check">${pixelIcon("check")}</span>` : it.hint ? `<kbd>${escapeHTML(it.hint)}</kbd>` : ""}
    </button>`;
  }

  function listHTML(items, active) {
    let section = null;
    return items.map((it, i) => {
      const head = it.section && it.section !== section ? `<p class="nb-pop-section">${escapeHTML((section = it.section))}</p>` : "";
      return head + itemHTML(it, i, active);
    }).join("") || '<p class="nb-pop-empty">No results</p>';
  }

  function openList(anchorRect, items, { search = true, placeholder = "Search actions…", footer = "", width = 280, keepSelection = false } = {}) {
    let active = 0;
    let shown = items;
    const el = openPopover(`
      ${search ? `<div class="nb-list-search"><input type="text" placeholder="${escapeAttr(placeholder)}" aria-label="${escapeAttr(placeholder)}" data-list-q /></div>` : ""}
      <div class="nb-list" role="listbox" data-list></div>
      ${footer}`, anchorRect, { className: "nb-menu", width, keepSelection });
    const list = el.querySelector("[data-list]");
    const paint = () => {
      active = Math.max(0, Math.min(active, shown.length - 1));
      list.innerHTML = listHTML(shown, active);
      const act = list.querySelector(".is-active");
      if (act) act.scrollIntoView({ block: "nearest" });
    };
    const runAt = (i) => {
      const it = shown[i];
      if (!it) return;
      closePopover();
      it.run();
    };
    paint();
    placePopover(el, anchorRect);
    const q = el.querySelector("[data-list-q]");
    if (q) {
      q.focus();
      q.addEventListener("input", () => {
        const s = q.value.trim().toLowerCase();
        shown = s ? items.filter((it) => `${it.label} ${it.section || ""} ${it.keys || ""}`.toLowerCase().includes(s)) : items;
        active = 0;
        paint();
      });
    }
    el._keys = (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        active = (active + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % Math.max(1, shown.length);
        paint();
        return true;
      }
      if (e.key === "Enter") { e.preventDefault(); runAt(active); return true; }
      return false;
    };
    el.addEventListener("keydown", (e) => { if (el._keys(e)) e.stopPropagation(); });
    list.addEventListener("click", (e) => {
      const b = e.target.closest("[data-i]");
      if (b) runAt(Number(b.dataset.i));
    });
    list.addEventListener("mousemove", (e) => {
      const b = e.target.closest("[data-i]");
      if (b && Number(b.dataset.i) !== active) { active = Number(b.dataset.i); paint(); }
    });
    return el;
  }

  /* ---- "/" ":" "@" menus while typing ------------------------------------ */

  /* The menu remembers where its trigger is as a character offset in the
   * block's text, not as a DOM node: browsers split and merge text nodes
   * while you type, and a node reference goes stale. */
  function caretOffset(el) {
    const r = rangeNow();
    if (!r || !el.contains(r.startContainer)) return -1;
    const probe = document.createRange();
    probe.selectNodeContents(el);
    probe.setEnd(r.startContainer, r.startOffset);
    return probe.toString().length;
  }

  function rangeAt(el, start, end) {
    const r = document.createRange();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let seen = 0;
    let startSet = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const next = seen + node.length;
      if (!startSet && start <= next) { r.setStart(node, start - seen); startSet = true; }
      if (startSet && end <= next) { r.setEnd(node, end - seen); return r; }
      seen = next;
    }
    if (!startSet) { r.selectNodeContents(el); r.collapse(false); }
    else r.setEnd(el, el.childNodes.length);
    return r;
  }

  const TRIGGERS = { "/": "slash", ":": "emoji", "@": "mention" };

  function commandsMatching(q) {
    const query = q.trim().toLowerCase();
    if (!query) return COMMANDS;
    return COMMANDS.filter(([, label, , words]) => `${label} ${words}`.toLowerCase().includes(query));
  }

  function emojiMatching(q) {
    if (!emojiFlat) { loadEmoji().then(() => updateMenu()); return []; }
    const query = q.toLowerCase().replace(/_/g, " ");
    if (!query) return emojiFlat.slice(0, 48);
    const starts = emojiFlat.filter(([, name]) => name.startsWith(query));
    const has = emojiFlat.filter(([, name]) => !name.startsWith(query) && name.includes(query));
    return [...starts, ...has].slice(0, 40);
  }

  function mentionItems(q) {
    const query = q.trim().toLowerCase();
    const dates = [["Today", 0], ["Tomorrow", 1], ["Yesterday", -1]].map(([label, d]) => ({ kind: "date", label, iso: isoToday(d) }));
    const typed = /^\d{4}-\d{2}-\d{2}$/.test(query) ? [{ kind: "date", label: isoDateText(query), iso: query }] : [];
    const seen = new Set();
    const people = [...team, ...(opts.people || [])]
      .filter((p) => p.name && !seen.has(p.name.toLowerCase()) && seen.add(p.name.toLowerCase()))
      .map((p) => ({ kind: "person", label: p.name, url: p.url, avatar: p.avatar }));
    const match = (it) => !query || it.label.toLowerCase().includes(query) || (it.kind === "date" && "date".startsWith(query));
    return [...typed, ...people.filter(match), ...dates.filter(match)].slice(0, 12);
  }

  function menuItemsFor(kind, q) {
    if (kind === "slash") return commandsMatching(q);
    if (kind === "emoji") return emojiMatching(q);
    return mentionItems(q);
  }

  function menuHTML() {
    const { kind, list, active } = menu;
    if (kind === "slash") {
      let section = "";
      const rows = list.map(([id, label, ico, , sec, hint], i) => {
        const head = sec !== section ? `<p class="nb-pop-section">${escapeHTML((section = sec))}</p>` : "";
        return `${head}<button type="button" class="nb-item${i === active ? " is-active" : ""}" data-i="${i}" role="option" aria-selected="${i === active}"><span class="nb-item-icon">${pixelIcon(ico)}</span><span class="nb-item-label">${escapeHTML(label)}</span>${hint ? `<kbd>${escapeHTML(hint)}</kbd>` : ""}</button>`;
      }).join("");
      return rows || '<p class="nb-pop-empty">No results</p>';
    }
    if (kind === "emoji") {
      return list.map(([e, name], i) => `<button type="button" class="nb-item${i === active ? " is-active" : ""}" data-i="${i}" role="option"><img class="nb-item-emoji" src="${twemojiURL(e)}" alt="" /><span class="nb-item-label">:${escapeHTML(name.replace(/ /g, "_"))}:</span></button>`).join("") || '<p class="nb-pop-empty">No emoji found</p>';
    }
    let section = "";
    return list.map((it, i) => {
      const sec = it.kind === "date" ? "Date" : "People";
      const head = sec !== section ? `<p class="nb-pop-section">${(section = sec)}</p>` : "";
      return `${head}<button type="button" class="nb-item${i === active ? " is-active" : ""}" data-i="${i}" role="option">${it.kind === "date" ? `<span class="nb-item-icon">${pixelIcon("calendar")}</span>` : avatarHTML({ name: it.label, avatar: it.avatar }, "avatar nb-item-avatar")}<span class="nb-item-label">${escapeHTML(it.label)}</span>${it.kind === "date" ? `<kbd>${escapeHTML(isoDateText(it.iso))}</kbd>` : ""}</button>`;
    }).join("") || '<p class="nb-pop-empty">No one by that name</p>';
  }

  function openMenu(kind, block, text) {
    closeMenu();
    const at = caretOffset(text) - 1;
    if (at < 0) return;
    menu = { kind, block, text, at, query: "", active: 0, list: [], el: null };
    updateMenu();
  }

  function showMenu() {
    if (!menu) return;
    const rect = caretRect() || menu.text.getBoundingClientRect();
    if (!menu.el || !menu.el.isConnected) {
      const footer = menu.kind === "slash" ? '<div class="nb-menu-foot"><span>Close menu</span><kbd>esc</kbd></div>' : "";
      const el = openPopover(`<div class="nb-list" role="listbox" data-list></div>${footer}`, rect, {
        className: `nb-menu nb-menu-${menu.kind}`,
        width: menu.kind === "slash" ? 320 : 300,
        // Only when this popover goes, and only this menu with it.
        onClose: () => { if (menu && menu.el === el) { menu.el = null; closeMenu(); } },
      });
      el.addEventListener("mousedown", (e) => e.preventDefault());
      el.addEventListener("click", (e) => {
        const b = e.target.closest("[data-i]");
        if (b && menu) applyMenu(Number(b.dataset.i));
      });
      el.addEventListener("mousemove", (e) => {
        const b = e.target.closest("[data-i]");
        if (b && menu && Number(b.dataset.i) !== menu.active) { menu.active = Number(b.dataset.i); paintMenu(); }
      });
      el.querySelector("[data-list]").addEventListener("click", () => {});
      menu.el = el;
    }
    paintMenu();
    placePopover(menu.el, rect);
  }

  function paintMenu() {
    if (!menu || !menu.el) return;
    menu.active = Math.max(0, Math.min(menu.active, menu.list.length - 1));
    const list = menu.el.querySelector("[data-list]");
    list.innerHTML = menuHTML();
    const act = list.querySelector(".is-active");
    if (act) act.scrollIntoView({ block: "nearest" });
    menu.text.classList.toggle("nb-filtering", menu.kind === "slash" && !menu.query && caretOffset(menu.text) === menu.text.textContent.length);
  }

  function closeMenu() {
    if (!menu) return;
    const m = menu;
    menu = null;
    m.text.classList.remove("nb-filtering");
    if (m.synthetic && m.text.isConnected && m.text.textContent === "/") {
      m.text.innerHTML = "";
      changed({ structural: true });
    }
    if (m.el && popover && popover.el === m.el) closePopover();
  }

  /** Re-read what was typed after the trigger; close when it no longer applies. */
  function updateMenu() {
    if (!menu) return;
    const trigger = Object.keys(TRIGGERS).find((k) => TRIGGERS[k] === menu.kind);
    const pos = caretOffset(menu.text);
    const text = menu.text.textContent;
    if (pos <= menu.at || text[menu.at] !== trigger) return closeMenu();
    const q = text.slice(menu.at + 1, pos);
    if (q.length > 30) return closeMenu();
    if (menu.kind === "emoji" && /\s/.test(q)) return closeMenu();
    const list = menuItemsFor(menu.kind, q);
    // Like Notion: a space after a word that matches nothing ends the menu.
    if (/\s$/.test(q) && !list.length) return closeMenu();
    menu.query = q;
    menu.list = list;
    menu.active = 0;
    if (menu.kind === "emoji" && q.length < 2 && !menu.forced) {
      // Wait for two letters (":ro"), keeping the menu's state.
      const el = menu.el;
      menu.el = null;
      if (el && popover && popover.el === el) { popover.onClose = null; closePopover(); }
      return;
    }
    showMenu();
  }

  /** Delete the trigger and query, leaving the caret where they were. */
  function consumeTrigger() {
    const { text, at } = menu;
    const end = Math.max(at + 1, caretOffset(text));
    rangeAt(text, at, end).deleteContents();
    text.normalize();
    text.focus({ preventScroll: true });
    sel().removeAllRanges();
    sel().addRange(rangeAt(text, at, at));
  }

  function applyMenu(i) {
    if (!menu) return;
    const m = menu;
    const item = m.list[i];
    if (!item) return closeMenu();
    consumeTrigger();
    closeMenu();
    if (m.kind === "slash") return runCommand(item[0], m.block);
    if (m.kind === "emoji") {
      remember("emoji", item[0]);
      document.execCommand("insertText", false, item[0]);
      return changed();
    }
    insertMention(item);
  }

  function insertMention(item) {
    const r = rangeNow();
    if (!r) return;
    let el;
    if (item.kind === "date") {
      el = document.createElement("time");
      el.className = "mention-date";
      el.setAttribute("datetime", item.iso);
      el.textContent = `@${isoDateText(item.iso)}`;
    } else {
      el = document.createElement(/^https:\/\/\S+$/.test(item.url || "") ? "a" : "span");
      el.className = "mention";
      if (el.tagName === "A") { el.href = item.url; el.rel = "noopener"; }
      el.textContent = `@${item.label}`;
    }
    el.contentEditable = "false";
    r.insertNode(el);
    caretAfter(el);
    changed();
  }

  function runCommand(id, block) {
    if (id === "inline-math") {
      const el = mathSpan("x");
      rangeNow().insertNode(el);
      caretAfter(el);
      changed();
      return openInlineMath(el);
    }
    if (id === "date") return insertMention({ kind: "date", iso: isoToday() });
    if (id === "emoji" || id === "mention") {
      // Typing the trigger may already open its menu (onInput); open it if not.
      const trigger = id === "emoji" ? ":" : "@";
      const text = textEl(block);
      document.execCommand("insertText", false, trigger);
      if (!menu || menu.text !== text) openMenu(TRIGGERS[trigger], block, text);
      if (menu && id === "emoji") {
        menu.forced = true; // the whole picker, before any letters are typed
        loadEmoji().then(() => updateMenu());
      }
      return;
    }
    const text = textEl(block);
    const empty = isEmptyText(text);
    let el;
    const toggleHeading = /^toggle-h([123])$/.exec(id);
    if (toggleHeading || TEXT_TYPES.has(id)) {
      const type = toggleHeading ? "toggle" : id;
      const extra = toggleHeading ? { attrs: { h: toggleHeading[1] } } : {};
      if (empty) el = convert(block, type, extra);
      else el = insertAfter(block, { type, text: "", children: [], ...extra });
      changed({ structural: true });
      return placeCaret(textEl(el));
    }
    const columns = /^columns-(\d)$/.exec(id);
    const fresh = columns ? { type: "columns", cols: Array.from({ length: Number(columns[1]) }, () => []) } : { type: id };
    if (empty && typeOf(block) === "p") {
      el = blockEl(fresh);
      block.replaceWith(el);
    } else {
      el = insertAfter(block, fresh);
    }
    changed({ structural: true });
    afterInsert(el);
  }

  /* ---- block menu (the grip) --------------------------------------------- */

  function colorItems(apply, current = {}) {
    const text = [{ id: "c-default", label: "Default text", swatch: "sw-text", section: "Text color", current: !current.color, run: () => apply("color", null) }]
      .concat(COLORS.map((c) => ({ id: `c-${c}`, label: `${c[0].toUpperCase()}${c.slice(1)} text`, swatch: `sw-text c-${c}`, section: "Text color", current: current.color === c, keys: "color colour", run: () => apply("color", c) })));
    const bg = [{ id: "bg-default", label: "Default background", swatch: "sw-bg", section: "Background color", current: !current.bg, run: () => apply("bg", null) }]
      .concat(COLORS.map((c) => ({ id: `bg-${c}`, label: `${c[0].toUpperCase()}${c.slice(1)} background`, swatch: `sw-bg bg-${c}`, section: "Background color", current: current.bg === c, keys: "color colour highlight", run: () => apply("bg", c) })));
    return [...text, ...bg];
  }

  function openBlockMenu(block, anchor) {
    selectBlock(block);
    const type = typeOf(block);
    const a = block._attrs || {};
    const items = [];
    const isText = TEXT_TYPES.has(type);
    if (isText) {
      TURN_INTO.forEach((id) => {
        const cmd = COMMANDS.find((c) => c[0] === id);
        items.push({ label: cmd[1], icon: cmd[2], section: "Turn into", current: id === type && !(type === "toggle" && a.h), keys: "turn into convert", run: () => { const el = convert(block, id); changed({ structural: true }); placeCaret(textEl(el)); } });
      });
      [1, 2, 3].forEach((n) => items.push({ label: `Toggle heading ${n}`, icon: "chevron-right", section: "Turn into", current: type === "toggle" && a.h === String(n), keys: "turn into toggle heading", run: () => {
        const el = type === "toggle" ? block : convert(block, "toggle");
        setAttr(el, "h", String(n));
        placeCaret(textEl(el));
      } }));
      items.push(...colorItems((k, v) => setAttr(block, k, v), a));
      [["left", "Align left", "text-align-left"], ["center", "Align center", "text-align-center"], ["right", "Align right", "text-align-right"], ["justify", "Justify", "text-align-justify"]]
        .forEach(([v, label, ico]) => items.push({ label, icon: ico, section: "Alignment", current: (a.align || "left") === v, keys: "align alignment", run: () => setAttr(block, "align", v === "left" ? null : v) }));
    }
    if (type === "number") {
      [["1", "Numbers (1, 2, 3)"], ["a", "Letters (a, b, c)"], ["i", "Roman (i, ii, iii)"]]
        .forEach(([v, label]) => items.push({ label, icon: "list-box", section: "List format", current: (a.list || "1") === v, keys: "number format list", run: () => setAttr(block, "list", v === "1" ? null : v) }));
    }
    if (type === "image" && block.dataset.url) {
      [["left", "Align left", "float-left"], ["center", "Centre", "float-center"], ["right", "Align right", "float-right"]]
        .forEach(([v, label, ico]) => items.push({ label, icon: ico, section: "Image", current: (a.align || "center") === v, run: () => setAttr(block, "align", v === "center" ? null : v) }));
      items.push({ label: "Original size", icon: "aspect-ratio", section: "Image", run: () => setAttr(block, "width", null) });
      items.push({ label: "Replace image", icon: "repeat", section: "Image", run: () => pickFile((file) => uploadInto(block, file)) });
    }
    if (/^h\d$/.test(type)) items.push({ label: "Copy link to heading", icon: "link", section: "Actions", run: () => copyAnchor(block) });
    items.push(
      { label: "Insert above", icon: "arrow-up", section: "Actions", run: () => { const p = blockEl({ type: "p", text: "" }); block.before(p); changed({ structural: true }); focusBlock(p); } },
      { label: "Insert below", icon: "arrow-down", section: "Actions", run: () => { const p = insertAfter(block, { type: "p", text: "" }); changed({ structural: true }); focusBlock(p); } },
      { label: "Duplicate", icon: "copy", section: "Actions", hint: "Ctrl+D", run: () => duplicate(block) },
      { label: "Move up", icon: "chevron-up", section: "Actions", hint: "Ctrl+Shift+↑", run: () => moveBlock(block, -1) },
      { label: "Move down", icon: "chevron-down", section: "Actions", hint: "Ctrl+Shift+↓", run: () => moveBlock(block, 1) },
      { label: "Delete", icon: "trash", section: "Actions", hint: "Del", danger: true, run: () => removeBlock(block) },
    );
    openList(anchor.getBoundingClientRect(), items, {
      footer: `<div class="nb-menu-foot"><span>${escapeHTML(TYPE_NAMES[type] || type)}${type === "toggle" && a.h ? ` · heading ${a.h}` : ""}</span></div>`,
      width: 290,
    });
  }

  function copyAnchor(block) {
    refreshDerived();
    if (!block._anchor) return opts.toast("Give the heading some text first.", "error");
    const slug = post.slug || slugify(titleEl.textContent);
    navigator.clipboard.writeText(`${SITE}blog/${slug}/#${block._anchor}`).then(
      () => opts.toast(post.status === "published" ? "Link to the heading copied." : "Link copied. It works once the post is published.", "info"),
      () => opts.toast("The browser blocked copying.", "error"),
    );
  }

  /* ---- tables: row and column handles, as in Notion --------------------- */

  function tableRows(block) { return [...block.querySelectorAll(":scope .nb-table-scroll tr")]; }

  function placeTableHandles(block, cell) {
    const tbl = block.querySelector(".nb-table");
    const box = tbl.getBoundingClientRect();
    const tr = cell.parentElement;
    const rows = tableRows(block);
    block._row = rows.indexOf(tr);
    block._col = [...tr.children].indexOf(cell);
    const rowHandle = tbl.querySelector("[data-row-handle]");
    const colHandle = tbl.querySelector("[data-col-handle]");
    const rr = tr.getBoundingClientRect();
    const cr = cell.getBoundingClientRect();
    rowHandle.hidden = false;
    colHandle.hidden = false;
    rowHandle.style.top = `${rr.top - box.top + rr.height / 2 - 11}px`;
    colHandle.style.left = `${cr.left - box.left + cr.width / 2 - 11}px`;
  }

  function tableEdit(block, fn) {
    fn(tableRows(block));
    paintTable(block);
    changed({ structural: true });
  }

  function newCell() { return h('<td class="nb-cell" contenteditable="true"></td>'); }

  function openRowMenu(block, anchor) {
    const r = block._row || 0;
    const rows = tableRows(block);
    const tr = rows[r];
    const blankRow = () => { const t = tr.cloneNode(true); t.querySelectorAll("td").forEach((td) => { td.innerHTML = ""; }); return t; };
    openList(anchor.getBoundingClientRect(), [
      { label: "Insert above", icon: "arrow-up", run: () => tableEdit(block, () => tr.before(blankRow())) },
      { label: "Insert below", icon: "arrow-down", run: () => tableEdit(block, () => tr.after(blankRow())) },
      { label: "Move up", icon: "chevron-up", run: () => tableEdit(block, () => { if (tr.previousElementSibling) tr.previousElementSibling.before(tr); }) },
      { label: "Move down", icon: "chevron-down", run: () => tableEdit(block, () => { if (tr.nextElementSibling) tr.nextElementSibling.after(tr); }) },
      { label: "Duplicate", icon: "copy", hint: "", run: () => tableEdit(block, () => tr.after(tr.cloneNode(true))) },
      { label: "Clear contents", icon: "eraser", run: () => tableEdit(block, () => tr.querySelectorAll("td").forEach((td) => { td.innerHTML = ""; })) },
      { label: "Delete row", icon: "trash", danger: true, run: () => tableEdit(block, (all) => { if (all.length > 1) tr.remove(); }) },
    ], { search: false, width: 220 });
  }

  function openColMenu(block, anchor) {
    const c = block._col || 0;
    const rows = tableRows(block);
    const cellsAt = () => rows.map((tr) => tr.children[c]);
    const align = block._align || (block._align = []);
    const moveCol = (d) => tableEdit(block, () => {
      const to = c + d;
      if (to < 0 || to >= rows[0].children.length) return;
      rows.forEach((tr) => { const a = tr.children[c]; const b = tr.children[to]; if (d < 0) b.before(a); else b.after(a); });
      [align[c], align[to]] = [align[to], align[c]];
    });
    openList(anchor.getBoundingClientRect(), [
      { label: "Insert left", icon: "arrow-left", run: () => tableEdit(block, () => { rows.forEach((tr) => tr.children[c].before(newCell())); align.splice(c, 0, "left"); }) },
      { label: "Insert right", icon: "arrow-right", run: () => tableEdit(block, () => { rows.forEach((tr) => tr.children[c].after(newCell())); align.splice(c + 1, 0, "left"); }) },
      { label: "Move left", icon: "chevron-left", run: () => moveCol(-1) },
      { label: "Move right", icon: "chevron-right", run: () => moveCol(1) },
      { label: "Align left", icon: "text-align-left", section: "Alignment", current: (align[c] || "left") === "left", run: () => tableEdit(block, () => { align[c] = "left"; }) },
      { label: "Align center", icon: "text-align-center", section: "Alignment", current: align[c] === "center", run: () => tableEdit(block, () => { align[c] = "center"; }) },
      { label: "Align right", icon: "text-align-right", section: "Alignment", current: align[c] === "right", run: () => tableEdit(block, () => { align[c] = "right"; }) },
      { label: "Duplicate", icon: "copy", section: "Column", run: () => tableEdit(block, () => { rows.forEach((tr) => tr.children[c].after(tr.children[c].cloneNode(true))); align.splice(c + 1, 0, align[c] || "left"); }) },
      { label: "Clear contents", icon: "eraser", section: "Column", run: () => tableEdit(block, () => cellsAt().forEach((td) => { td.innerHTML = ""; })) },
      { label: "Delete column", icon: "trash", section: "Column", danger: true, run: () => tableEdit(block, () => { if (rows[0].children.length > 1) { cellsAt().forEach((td) => td.remove()); align.splice(c, 1); } }) },
    ], { search: false, width: 220 });
  }

  function tableAction(block, act) {
    const rows = tableRows(block);
    if (act === "row") {
      const tr = rows[rows.length - 1].cloneNode(true);
      tr.querySelectorAll("td").forEach((td) => { td.innerHTML = ""; });
      rows[rows.length - 1].after(tr);
      paintTable(block);
      placeCaret(tr.querySelector("td"));
    } else if (act === "col") {
      rows.forEach((tr) => tr.append(newCell()));
      paintTable(block);
      placeCaret(rows[0].lastElementChild);
    }
    changed({ structural: true });
  }

  /* ---- toolbar menus ---------------------------------------------------- */

  function selectionBlock() {
    const r = rangeNow();
    return r && hostOf(r).closest(".nb-block");
  }

  function openTurnInto() {
    const block = selectionBlock();
    if (!block || !TEXT_TYPES.has(typeOf(block))) return;
    const type = typeOf(block);
    openList(toolbar.getBoundingClientRect(), TURN_INTO.map((id) => {
      const cmd = COMMANDS.find((c) => c[0] === id);
      return { label: cmd[1], icon: cmd[2], current: id === type, run: () => { const el = convert(block, id); changed({ structural: true }); placeCaret(textEl(el)); } };
    }), { search: false, width: 230, keepSelection: true });
  }

  function openColorMenu() {
    const saved = rangeNow() && rangeNow().cloneRange();
    const back = () => { if (saved) { sel().removeAllRanges(); sel().addRange(saved); } };
    openList(toolbar.getBoundingClientRect(), colorItems((kind, color) => { back(); colorSelection(kind, color || "default"); changed(); }), {
      search: false, width: 240, keepSelection: true,
    });
  }

  function openMoreFormat() {
    const saved = rangeNow() && rangeNow().cloneRange();
    const back = () => { if (saved) { sel().removeAllRanges(); sel().addRange(saved); } };
    openList(toolbar.getBoundingClientRect(), [
      { label: "Highlight", icon: "brush", hint: "Ctrl+Shift+H", run: () => { back(); format("mark"); } },
      { label: "Superscript", icon: "arrow-up", run: () => { back(); format("sup"); } },
      { label: "Subscript", icon: "arrow-down", run: () => { back(); format("sub"); } },
      { label: "Clear formatting", icon: "eraser", hint: "Ctrl+\\", run: () => { back(); format("clear"); } },
    ], { search: false, width: 230, keepSelection: true });
  }

  /* ---- link ------------------------------------------------------------ */

  function openLink() {
    const r = rangeNow();
    if (!r) return;
    const saved = r.cloneRange();
    const host = (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement).closest("a");
    const el = openPopover(`
      <form class="nb-form">
        <input type="url" placeholder="Paste a link (https://…)" value="${escapeAttr(host ? host.getAttribute("href") : "")}" aria-label="Link address" required />
        <div class="nb-form-row">
          ${host ? '<button type="button" class="nb-ghost nb-boxed" data-unlink>Remove link</button>' : ""}
          <button type="submit" class="nb-primary">Apply</button>
        </div>
        <p class="nb-form-error" hidden></p>
      </form>`, saved.getBoundingClientRect(), { width: 320 });
    const input = el.querySelector("input");
    input.focus();
    const back = () => { sel().removeAllRanges(); sel().addRange(saved); };
    el.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const url = input.value.trim();
      if (!/^https:\/\/\S+$/i.test(url)) {
        const err = el.querySelector(".nb-form-error");
        err.textContent = "Use a full link starting with https://";
        err.hidden = false;
        return;
      }
      closePopover();
      back();
      if (host) host.setAttribute("href", url);
      else if (!saved.collapsed) document.execCommand("createLink", false, url);
      else {
        const a = document.createElement("a");
        a.href = url;
        a.textContent = url;
        saved.insertNode(a);
        caretAfter(a);
      }
      root.querySelectorAll("a:not([rel])").forEach((a) => a.setAttribute("rel", "noopener"));
      changed();
    });
    const unlink = el.querySelector("[data-unlink]");
    if (unlink) unlink.addEventListener("click", () => {
      closePopover();
      host.replaceWith(...host.childNodes);
      changed();
    });
  }

  /* ---- equations ---------------------------------------------------------- */

  function openInlineMath(span) {
    const el = openPopover(`
      <form class="nb-form">
        <textarea rows="2" spellcheck="false" aria-label="TeX equation">${escapeHTML(span.dataset.tex)}</textarea>
        <div class="nb-math-live" aria-live="polite"></div>
        <div class="nb-form-row">
          <button type="button" class="nb-ghost nb-boxed" data-remove>Remove</button>
          <button type="submit" class="nb-primary">Done <kbd>Enter</kbd></button>
        </div>
      </form>`, span.getBoundingClientRect(), { width: 360 });
    const ta = el.querySelector("textarea");
    const live = el.querySelector(".nb-math-live");
    const paint = () => { live.innerHTML = renderMath(ta.value || " "); };
    paint();
    ta.focus();
    ta.select();
    ta.addEventListener("input", () => {
      span.dataset.tex = ta.value;
      span.innerHTML = renderMath(ta.value || " ");
      paint();
      changed();
    });
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); el.querySelector("form").requestSubmit(); }
    });
    el.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      closePopover();
      if (!ta.value.trim()) span.remove();
      changed();
      const text = span.isConnected && span.closest(".nb-text, .nb-cell");
      if (text) { text.focus({ preventScroll: true }); caretAfter(span); }
    });
    el.querySelector("[data-remove]").addEventListener("click", () => {
      closePopover();
      span.remove();
      changed();
    });
  }

  function openMath(block) {
    const ta = block.querySelector(".nb-math-src");
    ta.hidden = false;
    block.classList.add("is-editing");
    autosize(ta);
    placeCaret(ta);
  }

  /* ---- icons (page icon and callout icons) ---------------------------------- */

  function openIconPicker(anchor, { emojiOnly = false, current, onPick, onRemove }) {
    const tabs = emojiOnly ? ["Emoji"] : ["Emoji", "Icons", "Upload"];
    const fromCurrent = /^icon:[a-z0-9-]+:([a-z]+)$/.exec(current || "");
    let color = (fromCurrent && fromCurrent[1]) || localStorage.getItem("fcs-icon-color") || "default";
    if (!ICON_COLORS.includes(color)) color = "default";
    const el = openPopover(`
      <div class="nb-picker">
        <div class="nb-tabs" role="tablist">
          ${tabs.map((t, i) => `<button type="button" role="tab" data-tab="${t}" aria-selected="${i === 0}" class="${i === 0 ? "is-active" : ""}">${t}</button>`).join("")}
          <span class="nb-spacer"></span>
          ${onRemove && current ? '<button type="button" data-remove>Remove</button>' : ""}
        </div>
        <div class="nb-picker-tools" data-tools>
          <label class="nb-search">${pixelIcon("search")}<input type="search" placeholder="Filter…" aria-label="Filter" data-filter /></label>
          <button type="button" class="nb-tool-btn" data-random title="Random">${pixelIcon("shuffle")}</button>
          <button type="button" class="nb-tool-btn" data-color-btn title="Icon colour" hidden><span class="nb-swatch" data-swatch></span></button>
        </div>
        <div class="nb-colors" data-colors hidden>${ICON_COLORS.map((c) => `<button type="button" class="nb-color" style="color: var(--icon-${c})" data-color="${c}" title="${c[0].toUpperCase()}${c.slice(1)}" aria-label="${c}"></button>`).join("")}</div>
        <div class="nb-picker-body" data-body></div>
        <nav class="nb-picker-groups" data-groups hidden></nav>
      </div>`, anchor.getBoundingClientRect(), { width: 420 });
    const body = el.querySelector("[data-body]");
    const filter = el.querySelector("[data-filter]");
    const groupsNav = el.querySelector("[data-groups]");
    let tab = "Emoji";
    let all = [];

    const iconValue = (name) => `icon:${name}${color === "default" ? "" : `:${color}`}`;
    const pick = (value) => { closePopover(); onPick(value); };
    const emojiBtn = ([e, name]) => `<button type="button" data-emoji="${escapeAttr(e)}" title="${escapeAttr(name)}"><img src="${twemojiURL(e)}" alt="${escapeAttr(e)}" loading="lazy" draggable="false" /></button>`;
    const iconBtn = (name) => `<button type="button" data-icon-name="${name}" title="${name.replace(/-/g, " ")}">${pixelIcon(name)}</button>`;
    const section = (title, items, cls, id = "") => (items.length ? `<p class="nb-pop-section"${id ? ` id="${id}"` : ""}>${escapeHTML(title)}</p><div class="${cls}">${items.join("")}</div>` : "");

    const paintColor = () => {
      el.querySelector("[data-swatch]").style.color = `var(--icon-${color})`;
      el.querySelectorAll("[data-color]").forEach((b) => b.classList.toggle("is-on", b.dataset.color === color));
      body.style.setProperty("--pick-color", `var(--icon-${color})`);
      body.classList.toggle("is-colored", color !== "default");
    };

    async function paint() {
      const q = filter.value.trim().toLowerCase().replace(/-/g, " ");
      if (tab === "Emoji") {
        const groups = await loadEmoji();
        if (tab !== "Emoji") return;
        if (q) {
          const hits = groups.flatMap(([, list]) => list).filter(([, name]) => name.includes(q));
          body.innerHTML = section("Results", hits.map(emojiBtn), "nb-emoji-grid") || '<p class="nb-pop-empty">No emoji match.</p>';
        } else {
          const lookup = new Map(groups.flatMap(([, list]) => list).map((x) => [x[0], x]));
          body.innerHTML = section("Recent", recent("emoji").filter((e) => lookup.has(e)).map((e) => emojiBtn(lookup.get(e))), "nb-emoji-grid")
            + groups.map(([name, list], i) => section(name, list.map(emojiBtn), "nb-emoji-grid", `nb-group-${i}`)).join("");
        }
        groupsNav.hidden = Boolean(q);
        groupsNav.innerHTML = groups.map(([name], i) => `<button type="button" data-jump-group="${i}" title="${escapeAttr(name)}"><img src="${twemojiURL(GROUP_GLYPHS[i] || "🙂")}" alt="" /></button>`).join("");
        all = groups.flatMap(([, list]) => list.map((x) => x[0]));
      } else if (tab === "Icons") {
        const names = await loadIcons();
        if (tab !== "Icons") return;
        const hits = q ? names.filter((n) => n.replace(/-/g, " ").includes(q)) : names;
        body.innerHTML = (q ? "" : section("Recent", recent("icon").filter((n) => names.includes(n)).map(iconBtn), "nb-icon-grid"))
          + (section(q ? "Results" : "Icons", hits.map(iconBtn), "nb-icon-grid") || '<p class="nb-pop-empty">No icon matches.</p>');
        all = names;
      }
    }

    const show = (next) => {
      tab = next;
      el.querySelectorAll("[data-tab]").forEach((b) => {
        b.classList.toggle("is-active", b.dataset.tab === tab);
        b.setAttribute("aria-selected", String(b.dataset.tab === tab));
      });
      el.querySelector("[data-tools]").hidden = tab === "Upload";
      body.classList.toggle("nb-picker-short", tab === "Upload");
      el.querySelector("[data-color-btn]").hidden = tab !== "Icons";
      el.querySelector("[data-colors]").hidden = true;
      groupsNav.hidden = tab !== "Emoji";
      filter.value = "";
      if (tab === "Upload") {
        body.innerHTML = '<div class="nb-upload"></div>';
        mountUpload(body.firstChild, { hint: "Square images look best.", onSave: pick, onCancel: closePopover });
        return;
      }
      body.innerHTML = '<p class="nb-pop-empty">Loading…</p>';
      paint().catch(() => { body.innerHTML = '<p class="nb-pop-empty">Could not load the list. Check the connection.</p>'; });
      filter.focus();
    };

    paintColor();
    show(fromCurrent || /^icon:/.test(current || "") ? "Icons" : "Emoji");
    filter.addEventListener("input", () => paint());
    el.addEventListener("click", (e) => {
      const t = e.target;
      const tabBtn = t.closest("[data-tab]");
      if (tabBtn) return show(tabBtn.dataset.tab);
      const emoji = t.closest("[data-emoji]");
      if (emoji) { remember("emoji", emoji.dataset.emoji); return pick(emoji.dataset.emoji); }
      const named = t.closest("[data-icon-name]");
      if (named) {
        remember("icon", named.dataset.iconName);
        localStorage.setItem("fcs-icon-color", color);
        return pick(iconValue(named.dataset.iconName));
      }
      if (t.closest("[data-random]") && all.length) {
        const r = all[Math.floor(Math.random() * all.length)];
        return pick(tab === "Icons" ? iconValue(r) : r);
      }
      if (t.closest("[data-color-btn]")) { el.querySelector("[data-colors]").hidden = !el.querySelector("[data-colors]").hidden; return; }
      const swatch = t.closest("[data-color]");
      if (swatch) {
        color = swatch.dataset.color;
        localStorage.setItem("fcs-icon-color", color);
        paintColor();
        // A pixel icon already in place takes the new colour straight away.
        const name = /^icon:([a-z0-9-]+)/.exec(current || "");
        if (name) { current = iconValue(name[1]); onPick(current); }
        return;
      }
      const jump = t.closest("[data-jump-group]");
      if (jump) {
        const head = body.querySelector(`#nb-group-${jump.dataset.jumpGroup}`);
        if (head) body.scrollTop = head.offsetTop - body.offsetTop;
        return;
      }
      if (t.closest("[data-remove]")) { closePopover(); onRemove(); }
    });
  }

  /* ---- cover ---------------------------------------------------------------- */

  function openCoverPicker(anchor) {
    const el = openPopover(`
      <div class="nb-picker">
        <div class="nb-tabs"><button type="button" class="is-active">Upload</button><span class="nb-spacer"></span>${post.cover_url ? '<button type="button" data-remove>Remove</button>' : ""}</div>
        <div class="nb-picker-body nb-picker-short"><div class="nb-upload" data-upload-pane></div></div>
      </div>`, anchor.getBoundingClientRect(), { width: 408 });
    const setCover = (url) => {
      closePopover();
      post.cover_url = url;
      post.cover_position = 50;
      paintCover();
      changed();
    };
    mountUpload(el.querySelector("[data-upload-pane]"), {
      tiles: false,
      hint: "Wide images work best, at least 1500px across.",
      onSave: setCover,
      onCancel: closePopover,
    });
    const remove = el.querySelector("[data-remove]");
    if (remove) remove.addEventListener("click", () => setCover(""));
  }

  function startReposition() {
    const cover = $("[data-cover]");
    const img = $("[data-cover-img]");
    const before = post.cover_position;
    cover.classList.add("is-moving");
    $("[data-cover-tools]").hidden = true;
    $("[data-cover-moving]").hidden = false;
    let drag = null;
    const down = (e) => {
      if (e.target.closest("button")) return;
      drag = { y: e.clientY, pos: post.cover_position };
      cover.setPointerCapture(e.pointerId);
    };
    const move = (e) => {
      if (!drag) return;
      // Dragging the picture down shows more of its top.
      const span = Math.max(1, img.naturalHeight * (cover.clientWidth / Math.max(1, img.naturalWidth)) - cover.clientHeight);
      post.cover_position = Math.max(0, Math.min(100, drag.pos - ((e.clientY - drag.y) / span) * 100));
      img.style.objectPosition = `50% ${post.cover_position}%`;
    };
    const up = () => { drag = null; };
    const finish = (keep) => {
      cover.classList.remove("is-moving");
      cover.removeEventListener("pointerdown", down);
      cover.removeEventListener("pointermove", move);
      cover.removeEventListener("pointerup", up);
      $("[data-cover-tools]").hidden = false;
      $("[data-cover-moving]").hidden = true;
      if (!keep) post.cover_position = before;
      paintCover();
      if (keep && before !== post.cover_position) changed();
    };
    cover.addEventListener("pointerdown", down);
    cover.addEventListener("pointermove", move);
    cover.addEventListener("pointerup", up);
    $("[data-cover-done]").onclick = () => finish(true);
    $("[data-cover-cancel]").onclick = () => finish(false);
  }

  /* ---- image resizing ------------------------------------------------------- */

  function startResize(e, block, side) {
    e.preventDefault();
    const fig = block.querySelector(".nb-figure");
    const content = block.querySelector(":scope > .nb-content");
    const startX = e.clientX;
    const startW = fig.getBoundingClientRect().width;
    const full = content.getBoundingClientRect().width;
    const factor = (block._attrs.align || "center") === "center" ? 2 : 1;
    fig.classList.add("is-resizing");
    const move = (ev) => {
      const dx = (ev.clientX - startX) * (side === "r" ? 1 : -1) * factor;
      const pct = Math.max(15, Math.min(100, Math.round(((startW + dx) / full) * 100)));
      fig.style.width = `${pct}%`;
      fig.dataset.pct = String(pct);
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      fig.classList.remove("is-resizing");
      if (fig.dataset.pct) setAttr(block, "width", Number(fig.dataset.pct) >= 100 ? null : fig.dataset.pct);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  }

  /* ---- find and replace ------------------------------------------------------ */

  const findState = { open: false, matches: [], at: -1 };
  const canHighlight = typeof CSS !== "undefined" && CSS.highlights && typeof Highlight !== "undefined";

  function openFind() {
    findState.open = true;
    $("[data-find]").hidden = false;
    const input = $("[data-find-input]");
    const r = rangeNow();
    if (r && !r.collapsed && r.toString().length < 80) input.value = r.toString();
    input.focus();
    input.select();
    refreshFind();
  }

  function closeFind() {
    findState.open = false;
    $("[data-find]").hidden = true;
    if (canHighlight) { CSS.highlights.delete("nb-find"); CSS.highlights.delete("nb-find-current"); }
  }

  function refreshFind() {
    const q = $("[data-find-input]").value;
    const matchCase = $("[data-find-case]").checked;
    findState.matches = [];
    if (q) {
      const needle = matchCase ? q : q.toLowerCase();
      root.querySelectorAll(".nb-text, .nb-cell, .nb-caption").forEach((el) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement.closest(".math, .mention, .mention-date, .nb-anchor") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const hay = matchCase ? node.data : node.data.toLowerCase();
          for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) {
            const r = document.createRange();
            r.setStart(node, i);
            r.setEnd(node, i + q.length);
            findState.matches.push(r);
          }
        }
      });
    }
    if (findState.at >= findState.matches.length) findState.at = findState.matches.length ? 0 : -1;
    if (findState.at < 0 && findState.matches.length) findState.at = 0;
    paintFind();
  }

  function paintFind() {
    const { matches, at } = findState;
    $("[data-find-count]").textContent = $("[data-find-input]").value ? (matches.length ? `${at + 1} / ${matches.length}` : "No results") : "";
    if (!canHighlight) return;
    CSS.highlights.set("nb-find", new Highlight(...matches));
    if (matches[at]) CSS.highlights.set("nb-find-current", new Highlight(matches[at]));
    else CSS.highlights.delete("nb-find-current");
  }

  function stepFind(d) {
    const n = findState.matches.length;
    if (!n) return;
    findState.at = (findState.at + d + n) % n;
    const r = findState.matches[findState.at];
    const node = r.startContainer.parentElement;
    if (node) node.scrollIntoView({ block: "center" });
    if (!canHighlight) { sel().removeAllRanges(); sel().addRange(r); }
    paintFind();
  }

  function replaceFind(all) {
    const rep = $("[data-replace-input]").value;
    const targets = all ? findState.matches.slice().reverse() : findState.matches[findState.at] ? [findState.matches[findState.at]] : [];
    if (!targets.length) return;
    targets.forEach((r) => {
      const node = r.startContainer;
      node.replaceData(r.startOffset, r.endOffset - r.startOffset, rep);
    });
    changed({ structural: true });
    refreshFind();
    opts.toast(all ? `Replaced ${targets.length} match${targets.length === 1 ? "" : "es"}.` : "Replaced.", "info");
  }

  /* ---- more menu (the page's "...") ------------------------------------------- */

  function openMore(anchor) {
    const live = post.status === "published";
    const url = `${SITE}blog/${post.slug || slugify(titleEl.textContent)}/`;
    const toggle = (key, label, ico, note = "") => `
      <button type="button" class="nb-item nb-toggle-row" data-toggle="${key}" role="switch" aria-checked="${Boolean(post[key])}">
        <span class="nb-item-icon">${pixelIcon(ico)}</span><span class="nb-item-label">${label}${note ? `<small>${note}</small>` : ""}</span>
        <span class="nb-toggle-switch${post[key] ? " is-on" : ""}" aria-hidden="true"></span>
      </button>`;
    const act = (id, label, ico, hint = "", extra = "") => `<button type="button" class="nb-item${extra}" data-act="${id}"><span class="nb-item-icon">${pixelIcon(ico)}</span><span class="nb-item-label">${label}</span>${hint ? `<kbd>${hint}</kbd>` : ""}</button>`;
    const { words, minutes } = readingTime(bodyMarkdown());
    const el = openPopover(`
      <div class="nb-more">
        <p class="nb-pop-section">Style</p>
        <div class="nb-fonts" role="radiogroup" aria-label="Font">
          ${FONTS.map(([id, name, note]) => `<button type="button" class="nb-font nb-font-${id}${post.font === id || (!post.font && id === "default") ? " is-on" : ""}" data-font="${id}" role="radio" aria-checked="${post.font === id}" title="${escapeAttr(note)}"><span class="nb-font-ag">Ag</span><span>${name}</span></button>`).join("")}
        </div>
        ${toggle("small_text", "Small text", "text-cursor")}
        ${toggle("full_width", "Full width", "arrows-horizontal")}
        ${toggle("locked", "Lock page", "lock", "Stops accidental edits")}
        <div class="nb-zoom">
          <span class="nb-item-icon">${pixelIcon("zoom-in")}</span><span class="nb-item-label">Zoom</span>
          <button type="button" class="nb-tool-btn" data-zoom="-10" aria-label="Zoom out">−</button>
          <span data-zoom-label>${zoom}%</span>
          <button type="button" class="nb-tool-btn" data-zoom="10" aria-label="Zoom in">+</button>
        </div>
        <hr />
        ${live ? act("view", "View on site", "external-link") : ""}
        ${act("copy-link", "Copy link", "link")}
        ${act("copy-md", "Copy as Markdown", "copy")}
        ${opts.duplicate && post.id ? act("duplicate", "Duplicate as a new draft", "files") : ""}
        ${act("undo", "Undo", "undo", "Ctrl+Z")}
        ${act("find", "Find and replace", "search", "Ctrl+F")}
        <hr />
        ${act("import", "Import Markdown", "upload")}
        ${act("export-md", "Export as Markdown", "download")}
        ${act("export-html", "Export as HTML", "file-text")}
        ${act("export-pdf", "Print or save as PDF", "printer")}
        ${opts.history && post.id ? act("history", "Version history", "clock") : ""}
        <hr />
        ${live ? act("unpublish", "Unpublish (back to draft)", "eye-off") : ""}
        ${!live && post.id ? act("save", "Save draft now", "check", "Ctrl+S") : ""}
        ${post.id ? `<button type="button" class="nb-item is-danger" data-act="delete" ${opts.isAdmin ? "" : 'disabled title="Only admins can delete"'}><span class="nb-item-icon">${pixelIcon("trash")}</span><span class="nb-item-label">Delete post</span></button>` : ""}
        <div class="nb-menu-foot nb-more-foot">
          <span>${words} words · ${minutes} min read</span>
          ${post.updated_at ? `<span>Last edited ${escapeHTML(dateText(post.updated_at))}</span>` : ""}
        </div>
      </div>`, anchor.getBoundingClientRect(), { width: 300, className: "nb-menu" });
    el.style.left = `${Math.max(8, anchor.getBoundingClientRect().right - 300)}px`;
    el.addEventListener("click", async (e) => {
      const font = e.target.closest("[data-font]");
      if (font) {
        post.font = font.dataset.font;
        el.querySelectorAll("[data-font]").forEach((b) => b.classList.toggle("is-on", b === font));
        paintPageStyle();
        return changed();
      }
      const tog = e.target.closest("[data-toggle]");
      if (tog) {
        const key = tog.dataset.toggle;
        post[key] = !post[key];
        tog.setAttribute("aria-checked", String(post[key]));
        tog.querySelector(".nb-toggle-switch").classList.toggle("is-on", post[key]);
        paintPageStyle();
        if (key === "locked") {
          dirty = true;
          paintState();
          if (post.status === "draft") scheduleSave();
          return;
        }
        return changed();
      }
      const z = e.target.closest("[data-zoom]");
      if (z) {
        zoom = Math.max(50, Math.min(200, zoom + Number(z.dataset.zoom)));
        localStorage.setItem("fcs-editor-zoom", String(zoom));
        el.querySelector("[data-zoom-label]").textContent = `${zoom}%`;
        return paintPageStyle();
      }
      const btn = e.target.closest("[data-act]");
      if (!btn || btn.disabled) return;
      const a = btn.dataset.act;
      if (a === "delete" && !btn.dataset.armed) {
        btn.dataset.armed = "1";
        btn.querySelector(".nb-item-label").textContent = "Click again to delete";
        return;
      }
      closePopover();
      const copy = (text, done) => navigator.clipboard.writeText(text).then(() => opts.toast(done, "info"), () => opts.toast("The browser blocked copying.", "error"));
      const v = values();
      const fileBase = v.slug || "post";
      if (a === "view") window.open(url, "_blank", "noopener");
      else if (a === "copy-link") copy(url, live ? "Link copied." : "Link copied. It works once the post is published.");
      else if (a === "copy-md") copy(`# ${v.title}\n\n${v.body}`, "Copied as Markdown.");
      else if (a === "duplicate") {
        try { await opts.duplicate(v); } catch (err) { opts.toast(err.message || "Could not duplicate.", "error"); }
      } else if (a === "undo") undo();
      else if (a === "find") openFind();
      else if (a === "import") $("[data-import]").click();
      else if (a === "export-md") downloadFile(`${fileBase}.md`, "text/markdown", `# ${v.title}\n\n${v.body}\n`);
      else if (a === "export-html") downloadFile(`${fileBase}.html`, "text/html", exportHTML(v));
      else if (a === "export-pdf") printPost();
      else if (a === "history") openHistory(anchor);
      else if (a === "unpublish") {
        if (await save({ status: "draft" })) opts.toast("Unpublished. It leaves the site at the next rebuild.", "info");
      } else if (a === "save") save();
      else if (a === "delete") {
        try {
          await opts.remove(post.id, post.status === "published");
          dirty = false;
          close(true);
        } catch (err) {
          opts.toast(err.message || "Could not delete.", "error");
        }
      }
    });
  }

  function exportHTML(v) {
    const article = postArticleHTML({ ...v, published_at: post.published_at || new Date().toISOString() }, SITE);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHTML(v.title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,700..800&family=Archivo+Mono&family=Fira+Code:wght@400;500;600;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="${SITE}css/style.css" />
<link rel="stylesheet" href="${SITE}js/vendor/katex/katex.min.css" />
</head>
<body class="blog-page"><main>${article}</main></body>
</html>
`;
  }

  function printPost() {
    const pane = $("[data-preview-pane]");
    const wasHidden = pane.hidden;
    if (wasHidden) togglePreview();
    setTimeout(() => {
      window.print();
      if (wasHidden) togglePreview();
    }, 300);
  }

  async function openHistory(anchor) {
    const el = openPopover('<div class="nb-history"><p class="nb-pop-section">Version history</p><p class="nb-pop-empty">Loading…</p></div>', anchor.getBoundingClientRect(), { width: 320, className: "nb-menu" });
    el.style.left = `${Math.max(8, anchor.getBoundingClientRect().right - 320)}px`;
    try {
      const rows = await opts.history(post.id);
      if (!el.isConnected) return;
      const what = (r) => (r.action === "update" && r.changed && r.changed.length ? `changed ${r.changed.filter((c) => c !== "updated_at").join(", ")}` : r.action === "create" ? "created the post" : r.action);
      el.querySelector(".nb-history").innerHTML = `<p class="nb-pop-section">Version history</p>${rows.length ? rows.map((r) => `
        <div class="nb-history-row"><strong>${escapeHTML(r.actor_email || "Someone")}</strong><span>${escapeHTML(what(r))}</span><time>${escapeHTML(dateText(r.at))}</time></div>`).join("") : '<p class="nb-pop-empty">No history yet.</p>'}
        <p class="nb-help">Each save is recorded in the admin's Activity page, where deleted posts can be restored.</p>`;
    } catch (err) {
      el.querySelector(".nb-history").innerHTML = `<p class="nb-pop-empty">${escapeHTML(err.message || "Could not load the history.")}</p>`;
    }
  }

  async function importMarkdown(file) {
    const md = (await file.text()).replace(/\r\n?/g, "\n");
    let body = md;
    const first = /^#\s+(.+)\n+/.exec(md);
    if (first) {
      if (!titleEl.textContent.trim()) titleEl.textContent = first[1].trim();
      body = md.slice(first[0].length);
    }
    const blocks = parseBlocks(body);
    if (!blocks.length) return opts.toast("That file has nothing to import.", "error");
    const last = root.lastElementChild;
    if (last && typeOf(last) === "p" && isEmptyText(textEl(last))) last.remove();
    blocks.forEach((b) => root.append(blockEl(b)));
    changed({ structural: true });
    opts.toast(`Imported ${blocks.length} block${blocks.length === 1 ? "" : "s"} at the end of the post.`, "info");
  }

  /* ---- floating format toolbar ----------------------------------------------- */

  function paintToolbar() {
    const r = rangeNow();
    const host = r && hostOf(r);
    const inText = host && editableOf(host) && !host.closest(".nb-caption") && root.contains(host);
    if (!r || r.collapsed || !inText || popover || post.locked) { toolbar.hidden = true; return; }
    toolbar.hidden = false;
    const block = host.closest(".nb-block");
    const isCell = Boolean(host.closest(".nb-cell"));
    toolbar.querySelector("[data-fmt=turn]").hidden = isCell;
    toolbar.querySelector("[data-turn-label]").textContent = block ? TYPE_NAMES[typeOf(block)] || "Text" : "Text";
    const rect = r.getBoundingClientRect();
    const box = toolbar.getBoundingClientRect();
    toolbar.style.top = `${Math.max(56, rect.top - box.height - 8)}px`;
    toolbar.style.left = `${Math.max(8, Math.min(rect.left + rect.width / 2 - box.width / 2, innerWidth - box.width - 8))}px`;
    [["bold", "bold"], ["italic", "italic"], ["underline", "underline"], ["strike", "strikeThrough"]].forEach(([k, cmd]) => {
      toolbar.querySelector(`[data-fmt=${k}]`).classList.toggle("is-on", document.queryCommandState(cmd));
    });
  }

  /* ================================================================
   * Events
   * ================================================================ */

  function onKeydown(e) {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const target = e.target;

    // An inline menu ("/", ":", "@") owns the arrows, Enter, Tab and Escape.
    if (menu && menu.el && popover && popover.el === menu.el) {
      if (k === "ArrowDown" || k === "ArrowUp") {
        e.preventDefault();
        menu.active = (menu.active + (k === "ArrowDown" ? 1 : -1) + menu.list.length) % Math.max(1, menu.list.length);
        return paintMenu();
      }
      if ((k === "Enter" || k === "Tab") && !e.shiftKey) {
        if (menu.list.length) { e.preventDefault(); return applyMenu(menu.active); }
        closeMenu();
      }
      if (k === "Escape") { e.preventDefault(); return closeMenu(); }
    }
    // Other popovers: their own lists handle the keys; Escape closes.
    if (popover && popover.el._keys && !popover.el.contains(target) && popover.el._keys(e)) return;
    if (k === "Escape" && popover) { e.preventDefault(); return closePopover(); }
    if (k === "Escape" && findState.open && (target.closest && target.closest("[data-find]"))) { e.preventDefault(); return closeFind(); }

    if (mod && k.toLowerCase() === "s") { e.preventDefault(); return save(); }
    if (mod && k.toLowerCase() === "f" && !e.shiftKey) { e.preventDefault(); return openFind(); }
    if (target.closest && target.closest("[data-find]")) return findKeys(e);
    if (post.locked) return;

    const inPage = root.contains(target) || target === titleEl;
    if (mod && !e.altKey && inPage && (k.toLowerCase() === "z" || k.toLowerCase() === "y")) {
      e.preventDefault();
      return undo(k.toLowerCase() === "y" || e.shiftKey);
    }

    // A selected (not text) block.
    if (selectedBlock && target === selectedBlock) {
      if (k === "Backspace" || k === "Delete") { e.preventDefault(); return removeBlock(selectedBlock); }
      if (k === "ArrowUp" || k === "ArrowDown") {
        e.preventDefault();
        const order = allBlocks();
        const next = order[order.indexOf(selectedBlock) + (k === "ArrowUp" ? -1 : 1)];
        if (next) focusBlock(next, k === "ArrowUp");
        return;
      }
      if (k === "Enter") {
        e.preventDefault();
        if (typeOf(selectedBlock) === "math") return openMath(selectedBlock);
        if (textEl(selectedBlock)) return focusBlock(selectedBlock, true);
        const p = insertAfter(selectedBlock, { type: "p", text: "" });
        changed({ structural: true });
        return focusBlock(p);
      }
      if (mod && k.toLowerCase() === "d") { e.preventDefault(); return duplicate(selectedBlock); }
      if (mod && k === "/") { e.preventDefault(); return openBlockMenu(selectedBlock, selectedBlock.querySelector(".nb-drag")); }
      if (mod && e.shiftKey && (k === "ArrowUp" || k === "ArrowDown")) { e.preventDefault(); return moveBlock(selectedBlock, k === "ArrowUp" ? -1 : 1); }
      if (k === "Escape") { e.preventDefault(); return selectBlock(null); }
      // Typing on a selected text block goes back to editing it.
      if (k.length === 1 && !mod && textEl(selectedBlock)) { focusBlock(selectedBlock, true); return; }
      return;
    }

    if (target === titleEl) {
      if (k === "Enter" || (k === "ArrowDown" && caretOnEdgeLine(titleEl, true))) {
        e.preventDefault();
        const first = allBlocks()[0];
        if (k === "Enter" && (!first || !isEmptyText(textEl(first) || document.createElement("i")))) {
          const p = blockEl({ type: "p", text: "" });
          root.prepend(p);
          changed({ structural: true });
          return placeCaret(textEl(p));
        }
        if (first) focusBlock(first, false);
      }
      return;
    }

    const cell = target.closest && target.closest(".nb-cell");
    if (cell) return cellKeys(e, cell);

    if (target.classList.contains("nb-caption")) {
      if (k === "Enter") e.preventDefault();
      return;
    }

    const block = target.closest && target.closest(".nb-block");
    if (!block || !root.contains(block)) return;

    if (target.classList.contains("nb-code-text")) return codeKeys(e, block, target);
    if (target.classList.contains("nb-math-src")) {
      if ((k === "Enter" && !e.shiftKey) || k === "Escape") { e.preventDefault(); target.blur(); selectBlock(block); }
      return;
    }
    if (!target.classList.contains("nb-text")) return;
    const text = target;

    if (mod && e.altKey && /^[0-8]$/.test(k)) {
      // Notion's Ctrl+Alt+number: 0 text, 1-3 headings, 4 to-do, 5 bullet, 6 numbered, 7 toggle, 8 code.
      e.preventDefault();
      const to = ["p", "h1", "h2", "h3", "todo", "bullet", "number", "toggle", "code"][Number(k)];
      if (to === "code") { const el = convert(block, "p"); runCommand("code", el); return; }
      const el = convert(block, to);
      changed({ structural: true });
      return placeCaret(textEl(el));
    }
    if (mod && !e.shiftKey && !e.altKey) {
      const map = { b: "bold", i: "italic", u: "underline", e: "code", k: "link", "\\": "clear" };
      if (map[k.toLowerCase()]) { e.preventDefault(); return format(map[k.toLowerCase()]); }
      if (k.toLowerCase() === "d") { e.preventDefault(); return duplicate(block); }
      if (k === "/") { e.preventDefault(); return openBlockMenu(block, block.querySelector(".nb-drag")); }
    }
    if (mod && e.shiftKey) {
      if (k.toLowerCase() === "s" || k.toLowerCase() === "x") { e.preventDefault(); return format("strike"); }
      if (k.toLowerCase() === "h") { e.preventDefault(); return format("mark"); }
      if (k.toLowerCase() === "e") { e.preventDefault(); return format("math"); }
      if (k === "ArrowUp" || k === "ArrowDown") { e.preventDefault(); return moveBlock(block, k === "ArrowUp" ? -1 : 1); }
    }

    if (k === "Escape") { e.preventDefault(); closeMenu(); return selectBlock(block); }
    if (k === "Tab") { e.preventDefault(); return indent(block, e.shiftKey ? -1 : 1); }

    if (k === "Enter" && !e.isComposing) {
      if (e.shiftKey && MULTILINE.has(typeOf(block))) return;
      e.preventDefault();
      if (e.shiftKey) return;
      closeMenu();
      return splitBlock(block);
    }
    if (k === "Backspace" && caretAt(text, false) && sel().isCollapsed) { e.preventDefault(); return backspaceAtStart(block); }
    if (k === "Delete" && caretAt(text, true) && sel().isCollapsed) {
      const next = block.nextElementSibling;
      if (next && next.classList.contains("nb-block") && TEXT_TYPES.has(typeOf(next)) && typeOf(next) !== "toggle") {
        e.preventDefault();
        mergeInto(text, textEl(next));
        const r = rangeNow() && rangeNow().cloneRange();
        next.remove();
        changed({ structural: true });
        if (r) { sel().removeAllRanges(); sel().addRange(r); }
      }
      return;
    }
    if (k === "ArrowUp" && caretOnEdgeLine(text, false) && !e.shiftKey) {
      const order = allBlocks();
      const prev = order[order.indexOf(block) - 1];
      if (prev) { e.preventDefault(); focusBlock(prev, true); }
      else { e.preventDefault(); placeCaret(titleEl); }
      return;
    }
    if (k === "ArrowDown" && caretOnEdgeLine(text, true) && !e.shiftKey) {
      const order = allBlocks();
      const next = order[order.indexOf(block) + 1];
      if (next) { e.preventDefault(); focusBlock(next, false); }
    }
  }

  function findKeys(e) {
    if (e.target.matches("[data-find-input]")) {
      if (e.key === "Enter") { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); }
      if (e.key === "Escape") { e.preventDefault(); closeFind(); }
    } else if (e.target.matches("[data-replace-input]") && e.key === "Enter") {
      e.preventDefault();
      replaceFind(e.ctrlKey || e.metaKey);
    }
  }

  function codeKeys(e, block, ta) {
    if (e.key === "Tab") {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: end } = ta;
      ta.setRangeText("  ", s, end, "end");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    } else if (e.key === "Escape") {
      e.preventDefault();
      selectBlock(block);
    } else if (e.key === "Backspace" && !ta.value) {
      e.preventDefault();
      const el = convert(block, "p");
      changed({ structural: true });
      placeCaret(textEl(el));
    } else if (e.key === "ArrowUp" && ta.selectionStart === 0) {
      const order = allBlocks();
      const prev = order[order.indexOf(block) - 1];
      if (prev) { e.preventDefault(); focusBlock(prev, true); }
    } else if (e.key === "ArrowDown" && ta.selectionEnd === ta.value.length) {
      const order = allBlocks();
      const next = order[order.indexOf(block) + 1];
      e.preventDefault();
      if (next) focusBlock(next, false);
      else { const p = insertAfter(block, { type: "p", text: "" }); changed({ structural: true }); focusBlock(p); }
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const p = insertAfter(block, { type: "p", text: "" });
      changed({ structural: true });
      focusBlock(p);
    }
  }

  function cellKeys(e, cell) {
    const cells = [...cell.closest("table").querySelectorAll("td")];
    const i = cells.indexOf(cell);
    const block = cell.closest(".nb-block");
    if (e.key === "Tab") {
      e.preventDefault();
      const next = cells[i + (e.shiftKey ? -1 : 1)];
      if (next) placeCaret(next);
      else if (!e.shiftKey) tableAction(block, "row");
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cols = cell.parentElement.children.length;
      const below = cells[i + cols];
      if (below) placeCaret(below);
      else tableAction(block, "row");
    } else if (e.key === "Escape") {
      e.preventDefault();
      selectBlock(block);
    } else if ((e.ctrlKey || e.metaKey) && ["b", "i", "u", "e", "k"].includes(e.key.toLowerCase())) {
      e.preventDefault();
      format({ b: "bold", i: "italic", u: "underline", e: "code", k: "link" }[e.key.toLowerCase()]);
    } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "z" || e.key.toLowerCase() === "y")) {
      e.preventDefault();
      undo(e.key.toLowerCase() === "y" || e.shiftKey);
    }
  }

  function onInput(e) {
    const target = e.target;
    if (target === titleEl) {
      if (titleEl.querySelector("*")) titleEl.textContent = titleEl.textContent;
      return changed();
    }
    if (target.matches("[data-prop]")) {
      if (target.tagName === "TEXTAREA") autosize(target);
      return changed();
    }
    if (target.matches("[data-find-input], [data-find-case]")) { findState.at = 0; return refreshFind(); }
    if (target.matches("[data-media-url], [data-replace-input], [data-list-q], [data-filter]")) return;
    const block = target.closest(".nb-block");
    if (!block) return;
    if (target.classList.contains("nb-code-text")) {
      paintCode(block);
      return changed();
    }
    if (target.classList.contains("nb-math-src")) {
      autosize(target);
      paintMath(block);
      return changed();
    }
    if (target.classList.contains("nb-text")) {
      const typed = !e.isComposing && e.inputType === "insertText";
      if (typed) {
        if (tryShortcut(block)) return;
        if (tryInlineRule()) return changed();
      }
      // A menu typed into another block, or left behind, gives way.
      if (menu && menu.text !== target) closeMenu();
      if (menu) updateMenu();
      else if (typed && TRIGGERS[e.data]) {
        const pos = caretOffset(target);
        const before = target.textContent[pos - 2];
        // "/" opens anywhere, as in Notion; ":" and "@" only start a word
        // (so 10:30 and emails are left alone).
        if (e.data === "/" || !before || /[\s\u200b(]/.test(before)) openMenu(TRIGGERS[e.data], block, target);
      }
    }
    changed();
  }

  function onClick(e) {
    const t = e.target;
    // The toolbar has its own listener, and its menus must survive the click that opened them.
    if (t.closest(".nb-tip, [data-toolbar]")) return;
    if (popover && !popover.el.contains(t)) { closePopover(); if (menu) closeMenu(); }

    if (t.closest("[data-close]")) return close();
    if (t.closest("[data-save]")) {
      if (post.status === "published") return save();
      return save({ status: "published" }).then((ok) => ok && opts.toast("Published. It is live in about a minute.", "success"));
    }
    if (t.closest("[data-more]")) return openMore(t.closest("[data-more]"));
    if (t.closest("[data-undo]")) return undo();
    if (t.closest("[data-redo]")) return undo(true);
    if (t.closest("[data-unlock]")) {
      post.locked = false;
      paintPageStyle();
      dirty = true;
      paintState();
      scheduleSave();
      return opts.toast("Unlocked. Lock it again from the ⋯ menu.", "info");
    }
    if (t.closest("[data-preview]")) return togglePreview();
    if (t.closest("[data-authors]")) return openAuthorPicker(t.closest("[data-authors]"));
    if (t.closest("[data-whoami]")) return opts.whoami(t.closest("[data-whoami]"), onLinked);
    if (t.closest("[data-find-close]")) return closeFind();
    if (t.closest("[data-find-next]")) return stepFind(1);
    if (t.closest("[data-find-prev]")) return stepFind(-1);
    if (t.closest("[data-replace-one]")) return replaceFind(false);
    if (t.closest("[data-replace-all]")) return replaceFind(true);
    if (t.closest("[data-add-icon]") || t.closest("[data-icon-btn]")) {
      return openIconPicker(t.closest("button"), {
        current: post.icon,
        onPick: (v) => { post.icon = v; paintIcon(); changed(); },
        onRemove: () => { post.icon = ""; paintIcon(); changed(); },
      });
    }
    if (t.closest("[data-add-cover]") || t.closest("[data-cover-change]")) return openCoverPicker(t.closest("button"));
    if (t.closest("[data-cover-remove]")) { post.cover_url = ""; paintCover(); return changed(); }
    if (t.closest("[data-cover-move]")) return startReposition();

    const tocLink = t.closest("[data-jump]");
    if (tocLink) {
      const toc = tocLink.closest("[data-toc]");
      const target = toc._headings && toc._headings[Number(tocLink.dataset.jump)];
      if (target) focusBlock(target.block, true);
      return;
    }

    const block = t.closest(".nb-block");
    if (!block || !root.contains(block)) {
      if (t.closest("[data-tail]")) {
        const blocks = [...root.children];
        const last = blocks[blocks.length - 1];
        const p = last && typeOf(last) === "p" && isEmptyText(textEl(last)) ? last : insertAfter(last, { type: "p", text: "" }, root);
        changed({ structural: true });
        focusBlock(p);
      }
      return;
    }

    if (t.closest(".nb-plus")) {
      const b = t.closest(".nb-block");
      const p = blockEl({ type: "p", text: "" });
      if (e.altKey) b.before(p); else b.after(p);
      const text = textEl(p);
      text.textContent = "/";
      placeCaret(text);
      changed({ structural: true });
      openMenu("slash", p, text);
      if (menu) menu.synthetic = true;
      return;
    }
    if (t.closest(".nb-drag")) return openBlockMenu(t.closest(".nb-block"), t.closest(".nb-drag"));
    if (t.closest("[data-row-handle]")) return openRowMenu(block, t.closest("[data-row-handle]"));
    if (t.closest("[data-col-handle]")) return openColMenu(block, t.closest("[data-col-handle]"));
    if (t.closest(".nb-anchor")) return copyAnchor(t.closest(".nb-block"));
    if (t.classList.contains("nb-check")) {
      block.classList.toggle("is-done", t.checked);
      return changed({ structural: true });
    }
    if (t.closest(".nb-caret")) {
      const open = !block.classList.contains("is-open");
      block.classList.toggle("is-open", open);
      t.closest(".nb-caret").setAttribute("aria-expanded", String(open));
      return;
    }
    if (t.closest(".nb-callout-icon")) {
      const btn = t.closest(".nb-callout-icon");
      return openIconPicker(btn, { emojiOnly: true, onPick: (v) => { btn.dataset.icon = v; btn.innerHTML = emojiHTML(v); changed(); } });
    }
    const mathInline = t.closest(".nb-text .math, .nb-cell .math");
    if (mathInline) return openInlineMath(mathInline);
    if (t.closest("[data-math-view]")) return openMath(block);
    if (t.closest("[data-copy]")) {
      navigator.clipboard.writeText(block.querySelector(".nb-code-text").value).then(
        () => opts.toast("Code copied.", "info"),
        () => opts.toast("The browser blocked copying.", "error"),
      );
      return;
    }
    if (t.closest("[data-add-row]")) return tableAction(block, "row");
    if (t.closest("[data-add-col]")) return tableAction(block, "col");
    const align = t.closest("[data-img-align]");
    if (align) return setAttr(block, "align", align.dataset.imgAlign === "center" ? null : align.dataset.imgAlign);
    if (t.closest("[data-media-upload]") || t.closest("[data-media-replace]")) {
      return pickFile((file) => uploadInto(block, file));
    }
    if (t.closest("[data-media-embed]")) return embedFromInput(block);
    if (t.closest("[data-media-clear]")) {
      block.dataset.url = "";
      block._attrs = {};
      paintMedia(block);
      return changed({ structural: true });
    }
    if (t.closest(".bookmark, a")) return;
    if (!TEXT_TYPES.has(typeOf(block)) && typeOf(block) !== "columns" && !t.closest("input, textarea, select, [contenteditable=true], button")) selectBlock(block);
  }

  function onMouseOver(e) {
    const cell = e.target.closest && e.target.closest(".nb-cell");
    if (cell && !post.locked) placeTableHandles(cell.closest(".nb-block"), cell);
  }

  function onPointerDown(e) {
    const handle = e.target.closest && e.target.closest("[data-resize]");
    if (handle && !post.locked) startResize(e, handle.closest(".nb-block"), handle.dataset.resize);
  }

  function embedFromInput(block) {
    const input = block.querySelector("[data-media-url]");
    const url = input.value.trim();
    if (!/^https:\/\/\S+$/i.test(url)) return opts.toast("Use a full link starting with https://", "error");
    if (typeOf(block) === "video" && !youtubeId(url)) return opts.toast("Paste a YouTube link (youtube.com or youtu.be).", "error");
    block.dataset.url = url;
    paintMedia(block);
    changed({ structural: true });
    const cap = block.querySelector(".nb-caption");
    if (cap) placeCaret(cap);
  }

  async function uploadInto(block, file) {
    const content = block.querySelector(":scope > .nb-content");
    const before = content.innerHTML;
    content.innerHTML = `<div class="nb-media-empty"><span class="nb-media-head"><span class="nb-spinner" aria-hidden="true"></span><strong>Uploading ${escapeHTML(file.name)}…</strong></span></div>`;
    const url = await upload(file);
    if (!url) { content.innerHTML = before; return; }
    block.dataset.url = url;
    if (!block.dataset.caption) block.dataset.caption = "";
    paintMedia(block);
    changed({ structural: true });
  }

  function insertImages(files, after) {
    let at = after;
    files.forEach((file) => {
      at = insertAfter(at, { type: "image", url: "" }, root);
      uploadInto(at, file);
    });
  }

  function onPaste(e) {
    const t = e.target;
    if (post.locked) return;
    const files = [...(e.clipboardData.files || [])].filter((f) => /^image\//.test(f.type));
    const block = t.closest && t.closest(".nb-block");
    if (files.length && block && root.contains(block)) {
      e.preventDefault();
      return insertImages(files, block);
    }
    if (t === titleEl) {
      e.preventDefault();
      document.execCommand("insertText", false, e.clipboardData.getData("text/plain").replace(/\s+/g, " "));
      return;
    }
    if (!t.closest || !t.closest(".nb-text, .nb-cell, .nb-caption")) return;
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    const r = rangeNow();
    if (/^https:\/\/\S+$/.test(text.trim()) && r && !r.collapsed) {
      document.execCommand("createLink", false, text.trim());
      return changed();
    }
    if (!/\n/.test(text.trim()) || !t.closest(".nb-text")) {
      document.execCommand("insertText", false, text.replace(/\s*\n\s*/g, " "));
      return;
    }
    // Several lines: read them as Markdown and insert the blocks.
    const blocks = parseBlocks(text);
    let at = block;
    const empty = isEmptyText(textEl(block)) && typeOf(block) === "p";
    blocks.forEach((b) => { at = insertAfter(at, b); });
    if (empty) block.remove();
    changed({ structural: true });
    focusBlock(at);
  }

  function onDrop(e) {
    const files = [...(e.dataTransfer && e.dataTransfer.files || [])].filter((f) => /^image\//.test(f.type));
    if (!files.length || post.locked) return;
    e.preventDefault();
    const block = e.target.closest && e.target.closest(".nb-block");
    insertImages(files, block && root.contains(block) ? block : root.lastElementChild);
  }

  function onFocusOut(e) {
    const t = e.target;
    if (t.classList && t.classList.contains("nb-math-src")) {
      const block = t.closest(".nb-block");
      setTimeout(() => {
        if (document.activeElement === t) return;
        t.hidden = true;
        block.classList.remove("is-editing");
      }, 0);
    }
    if (t.classList && t.classList.contains("nb-caption")) {
      const block = t.closest(".nb-block");
      block.dataset.caption = t.textContent.trim();
      changed();
    }
    if (t === titleEl) $("[data-crumb]").textContent = titleEl.textContent.trim() || "Untitled";
  }

  function onChange(e) {
    const t = e.target;
    if (t.matches("[data-lang]")) {
      paintCode(t.closest(".nb-block"));
      changed();
    }
    if (t.matches("[data-find-case]")) refreshFind();
    if (t.matches("[data-import]") && t.files && t.files[0]) {
      importMarkdown(t.files[0]);
      t.value = "";
    }
  }

  function onMediaKey(e) {
    if (e.key === "Enter" && e.target.matches && e.target.matches("[data-media-url]")) {
      e.preventDefault();
      embedFromInput(e.target.closest(".nb-block"));
    }
  }

  /* ---- preview ---------------------------------------------------------- */

  function togglePreview() {
    const pane = $("[data-preview-pane]");
    const showing = !pane.hidden;
    pane.hidden = showing;
    $("[data-scroll]").hidden = !showing;
    ed.classList.toggle("is-previewing", !showing);
    $("[data-preview] span").textContent = showing ? "Preview" : "Back to editing";
    if (!showing) {
      const v = values();
      pane.innerHTML = `<div class="blog-page nb-preview-page">${postArticleHTML({ ...v, title: v.title || "Untitled", published_at: post.published_at || new Date().toISOString() })}</div>`;
    }
  }

  /* ---- drag to reorder ---------------------------------------------------- */

  function initSortable(container) {
    if (!window.Sortable) return;
    sortables.push(new window.Sortable(container, {
      group: "nb-blocks",
      handle: ".nb-drag",
      draggable: ".nb-block",
      animation: 150,
      fallbackOnBody: true,
      swapThreshold: 0.6,
      ghostClass: "is-ghost",
      onEnd: () => changed({ structural: true }),
    }));
  }

  /* ================================================================
   * Open and close
   * ================================================================ */

  function loadBody(md) {
    sortables.splice(0).forEach((s) => s.destroy());
    root.innerHTML = "";
    const blocks = parseBlocks(md);
    if (!blocks.length) blocks.push({ type: "p", text: "" });
    blocks.forEach((b) => root.append(blockEl(b)));
    initSortable(root);
  }

  function beforeUnload(e) {
    if (dirty) { e.preventDefault(); e.returnValue = ""; }
  }

  async function close(force = false) {
    if (!force && dirty) {
      if (post.status === "draft" && titleEl.textContent.trim()) {
        if (!(await save({ quiet: true }))) return;
      } else if (!confirmLeave()) {
        return;
      }
    }
    clearTimeout(autosaveTimer);
    clearTimeout(historyTimer);
    closeFind();
    sortables.forEach((s) => s.destroy());
    document.removeEventListener("selectionchange", paintToolbar);
    window.removeEventListener("beforeunload", beforeUnload);
    ed.remove();
    document.body.classList.remove("nb-open");
    opts.onClose();
  }

  const confirmLeave = () => window.confirm(post.status === "published"
    ? "This post has changes that are not live yet. Leave without updating?"
    : "This draft has no title, so it cannot be saved. Leave anyway?");

  // Wire up and show.
  ed.addEventListener("keydown", onKeydown);
  ed.addEventListener("keydown", onMediaKey);
  ed.addEventListener("input", onInput);
  ed.addEventListener("click", onClick);
  ed.addEventListener("mouseover", onMouseOver);
  ed.addEventListener("pointerdown", onPointerDown);
  ed.addEventListener("paste", onPaste);
  ed.addEventListener("dragover", (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) e.preventDefault(); });
  ed.addEventListener("drop", onDrop);
  ed.addEventListener("focusout", onFocusOut);
  // Focus moving anywhere else (a click into its text, say) ends a block selection.
  ed.addEventListener("focusin", (e) => { if (selectedBlock && e.target !== selectedBlock) selectBlock(null); });
  ed.addEventListener("change", onChange);
  ed.addEventListener("mousedown", (e) => {
    if (e.target.closest("[data-toolbar]")) e.preventDefault();
    if (selectedBlock && !selectedBlock.contains(e.target)) selectBlock(null);
  });
  // The page cannot scroll under an open menu (as in Notion); the wheel is eaten.
  $("[data-scroll]").addEventListener("wheel", (e) => { if (popover && !popover.el.contains(e.target)) e.preventDefault(); }, { passive: false });
  toolbar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-fmt]");
    if (b) format(b.dataset.fmt);
  });
  $("[data-scroll]").addEventListener("scroll", () => { toolbar.hidden = true; });
  document.addEventListener("selectionchange", paintToolbar);
  window.addEventListener("beforeunload", beforeUnload);

  titleEl.textContent = post.title || "";
  $("[data-crumb]").textContent = post.title || "Untitled";
  loadBody(post.body);
  paintCover();
  paintIcon();
  paintProps();
  paintPageStyle();
  refreshDerived();
  paintState();
  commitHistory();

  document.body.append(ed);
  document.body.classList.add("nb-open");
  if (post.locked) opts.toast("This post is locked. Unlock it from the top bar to edit.", "info");
  else if (post.title) focusBlock(allBlocks()[0], true);
  else placeCaret(titleEl);

  return { close };
}
