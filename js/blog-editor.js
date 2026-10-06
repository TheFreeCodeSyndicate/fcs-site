/*
 * js/blog-editor.js
 * ------------------------------------------------------------------
 * The admin's post editor: a full-screen, Notion-style page.
 *
 *   cover (upload, link, drag to reposition) . icon (emoji, site icon,
 *   upload) . title . properties . blocks
 *
 * Blocks are edited in place (WYSIWYG). "/" opens the block menu;
 * Markdown shortcuts work at the start of a line ("# ", "- ", "[] ",
 * "> ", "```", "---", "$$ ", ...) and inline (**bold**, *italic*,
 * `code`, ~~strike~~, ==highlight==, $math$). Selecting text shows a
 * formatting bar. Blocks drag by their handle; Tab nests list items.
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
import { parseBlocks, serializeBlocks, inline, renderMath, highlightCode, youtubeId, readingTime, tocHTML, inlineText, twemojiURL, emojiHTML } from "./lib/markdown.js";
import { iconHTML, postArticleHTML, ICON_COLORS } from "./lib/blog-pages.js";
import { slugify } from "./lib/forms.js";
import { escapeHTML, escapeAttr, icon } from "./render.js";

/* ==================================================================
 * Block catalogue
 * ================================================================== */

const TEXT_TYPES = new Set(["p", "h1", "h2", "h3", "bullet", "number", "todo", "quote", "callout", "toggle"]);
const LIST_TYPES = new Set(["bullet", "number", "todo"]);
const MULTILINE = new Set(["p", "quote", "callout"]);

const PLACEHOLDERS = {
  p: "Type '/' for commands", h1: "Heading 1", h2: "Heading 2", h3: "Heading 3",
  bullet: "List", number: "List", todo: "To-do", quote: "Empty quote",
  callout: "Type something…", toggle: "Toggle",
};

// [type or action, label, glyph, keywords, section]
const COMMANDS = [
  ["p", "Text", "T", "text paragraph plain", "Basic blocks"],
  ["h1", "Heading 1", "H1", "heading title big h1 #", "Basic blocks"],
  ["h2", "Heading 2", "H2", "heading subtitle medium h2 ##", "Basic blocks"],
  ["h3", "Heading 3", "H3", "heading small h3 ###", "Basic blocks"],
  ["bullet", "Bulleted list", "•", "bullet list unordered ul -", "Basic blocks"],
  ["number", "Numbered list", "1.", "number list ordered ol", "Basic blocks"],
  ["todo", "To-do list", "☑", "todo task check checkbox []", "Basic blocks"],
  ["toggle", "Toggle", "▸", "toggle collapse details dropdown", "Basic blocks"],
  ["quote", "Quote", "❝", "quote blockquote citation", "Basic blocks"],
  ["callout", "Callout", "💡", "callout note tip warning info box", "Basic blocks"],
  ["divider", "Divider", "—", "divider line separator hr rule", "Basic blocks"],
  ["image", "Image", "🖼", "image picture photo upload media", "Media"],
  ["video", "Video", "▶", "video youtube embed media", "Media"],
  ["bookmark", "Web bookmark", "🔖", "bookmark link card url web", "Media"],
  ["code", "Code", "</>", "code snippet program syntax", "Advanced"],
  ["math", "Block equation", "∑", "math equation latex tex formula katex", "Advanced"],
  ["table", "Table", "▦", "table grid rows columns", "Advanced"],
  ["toc", "Table of contents", "≡", "toc table of contents outline headings", "Advanced"],
  ["inline-math", "Inline equation", "x²", "inline math equation latex tex", "Inline"],
];

const LANGS = ["", "bash", "c", "cpp", "csharp", "css", "diff", "go", "java", "javascript", "json", "kotlin", "markdown", "php", "python", "ruby", "rust", "sql", "swift", "typescript", "xml", "yaml"];

/* The picker's catalogues load the first time it opens: every Unicode
 * emoji in Notion's nine groups (js/vendor/emoji, drawn with Twemoji)
 * and every pixelarticons icon (assets/pixel-icons.svg). */
let emojiGroups = null;
const loadEmoji = () => (emojiGroups ||= fetch("js/vendor/emoji/emoji-groups.json").then((r) => r.json()));
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
  return !frag.textContent.replace(/\u200b/g, "") && !frag.querySelector("br, .math, img");
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

const isEmptyText = (el) => !el.textContent.replace(/\u200b/g, "").trim() && !el.querySelector(".math, img");

/* Editable HTML -> inline Markdown. Only formatting this editor creates
 * survives; anything else (a stray span a browser added) keeps its text. */
const escText = (s) => s.replace(/[\\`*$\[\]]/g, "\\$&").replace(/([~=])(?=\1)/g, "\\$1");
const hug = (inner, mark) => {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  return m[2] ? `${m[1]}${mark}${m[2]}${mark}${m[3]}` : inner;
};
const codeSpan = (text) => (text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``);

function toInline(node) {
  let out = "";
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { out += escText(n.nodeValue.replace(/\u00a0/g, " ").replace(/\u200b/g, "")); continue; }
    if (n.nodeType !== 1) continue;
    const tag = n.tagName;
    if (n.classList.contains("math")) { out += `$${n.dataset.tex}$`; continue; }
    if (tag === "BR") { out += "\n"; continue; }
    if (tag === "CODE") { if (n.textContent) out += codeSpan(n.textContent.replace(/\u200b/g, "")); continue; }
    const inner = toInline(n);
    const weight = n.style && (n.style.fontWeight === "bold" || Number(n.style.fontWeight) >= 600);
    if (tag === "B" || tag === "STRONG" || weight) out += hug(inner, "**");
    else if (tag === "I" || tag === "EM") out += hug(inner, "*");
    else if (tag === "S" || tag === "STRIKE" || tag === "DEL") out += hug(inner, "~~");
    else if (tag === "MARK") out += hug(inner, "==");
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
  el.querySelectorAll(".math").forEach((m) => m.setAttribute("contenteditable", "false"));
  el.querySelectorAll("a").forEach((a) => a.setAttribute("rel", "noopener"));
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
 * @param {(msg, tone?) => void} opts.toast
 * @param {() => void} opts.onClose
 */
export function openBlogEditor(opts) {
  const post = {
    id: null, title: "", slug: "", status: "draft", author_name: "", excerpt: "",
    cover_url: "", cover_position: 50, icon: "", body: "", published_at: null, updated_at: null,
    ...(opts.row || {}),
  };
  post.cover_position = Number.isFinite(post.cover_position) ? post.cover_position : 50;

  let dirty = false;
  let saving = null;
  let autosaveTimer = 0;
  let historyTimer = 0;
  const history = [];
  let historyAt = -1;
  let selectedBlock = null;
  let slash = null;
  let popover = null;
  const sortables = [];

  const ed = h(`
    <div class="nb" role="dialog" aria-modal="true" aria-label="Post editor">
      <header class="nb-top">
        <button type="button" class="nb-ghost" data-close>${icon("arrow-up", "nb-back-icon")}<span>Posts</span></button>
        <span class="nb-crumb"><span>Blog</span><span aria-hidden="true">/</span><span data-crumb></span></span>
        <span class="nb-spacer"></span>
        <span class="nb-muted" data-words></span>
        <span class="nb-state" data-state role="status"></span>
        <button type="button" class="nb-ghost" data-preview>${icon("eye")}<span>Preview</span></button>
        <button type="button" class="nb-primary" data-save></button>
        <button type="button" class="nb-ghost nb-square" data-more aria-label="More actions" aria-haspopup="menu">⋯</button>
      </header>
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
        <div class="nb-page">
          <div class="nb-icon" data-icon><button type="button" data-icon-btn aria-label="Change icon"></button></div>
          <div class="nb-adders">
            <button type="button" data-add-icon>☺ Add icon</button>
            <button type="button" data-add-cover>${icon("image")}<span>Add cover</span></button>
          </div>
          <h1 class="nb-title" contenteditable="true" spellcheck="true" data-placeholder="Untitled" data-title aria-label="Title"></h1>
          <div class="nb-props" data-props></div>
          <div class="nb-blocks" data-root></div>
          <div class="nb-tail" data-tail aria-hidden="true"></div>
        </div>
      </div>
      <div class="nb-scroll nb-preview" data-preview-pane hidden></div>
      <div class="nb-toolbar" data-toolbar role="toolbar" aria-label="Formatting" hidden>
        <button type="button" data-fmt="bold" title="Bold (Ctrl+B)"><b>B</b></button>
        <button type="button" data-fmt="italic" title="Italic (Ctrl+I)"><i>i</i></button>
        <button type="button" data-fmt="strike" title="Strikethrough (Ctrl+Shift+S)"><s>S</s></button>
        <button type="button" data-fmt="code" title="Code (Ctrl+E)">&lt;/&gt;</button>
        <button type="button" data-fmt="mark" title="Highlight (Ctrl+Shift+H)"><mark>A</mark></button>
        <button type="button" data-fmt="link" title="Link (Ctrl+K)">${icon("link")}</button>
        <button type="button" data-fmt="math" title="Equation">√x</button>
      </div>
      <input type="file" accept="image/png,image/jpeg,image/webp" data-file hidden />
    </div>`);

  const $ = (s) => ed.querySelector(s);
  const root = $("[data-root]");
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

  /* ================================================================
   * Building blocks
   * ================================================================ */

  function blockEl(b) {
    const el = h(`<div class="nb-block" data-type="${b.type}">
      <div class="nb-gutter" contenteditable="false">
        <button type="button" class="nb-plus" tabindex="-1" aria-label="Add a block below">${GUTTER_PLUS}<span class="nb-tip" role="tooltip"><b>Click</b> to add below<br /><b>Alt-click</b> to add a block above</span></button>
        <button type="button" class="nb-drag" tabindex="-1" aria-label="Drag to move, click for options">${GUTTER_GRIP}<span class="nb-tip" role="tooltip"><b>Drag</b> to move<br /><b>Click</b> or <b>Ctrl+/</b> to open menu</span></button>
      </div>
      <div class="nb-content"></div>
    </div>`);
    const content = el.querySelector(".nb-content");
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
        content.append(h(`<button type="button" class="nb-caret" aria-label="Open or close" aria-expanded="true">▸</button>`));
        el.classList.add("is-open");
      }
      content.append(text);
      if (b.type === "toggle") {
        const kids = h(`<div class="nb-blocks nb-children"></div>`);
        (b.children || []).forEach((c) => kids.append(blockEl(c)));
        content.append(kids);
        initSortable(kids);
      }
      return el;
    }

    el.tabIndex = -1;
    switch (b.type) {
      case "code": {
        const box = h(`<div class="nb-code">
          <div class="nb-code-bar" contenteditable="false">
            <select data-lang aria-label="Language">${LANGS.map((l) => `<option value="${l}">${l || "Plain text"}</option>`).join("")}</select>
            <button type="button" data-copy>${icon("copy")}<span>Copy</span></button>
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
        const rows = b.rows && b.rows.length ? b.rows : [["", ""], ["", ""]];
        content.append(h(`<div class="nb-table">
          <div class="nb-table-scroll"><table><tbody>${rows.map((r, n) => `<tr>${r.map(() => `<td class="nb-cell${n === 0 ? " is-head" : ""}" contenteditable="true"></td>`).join("")}</tr>`).join("")}</tbody></table></div>
          <button type="button" class="nb-table-add" data-add-row title="Add a row">+</button>
          <button type="button" class="nb-table-add nb-table-addcol" data-add-col title="Add a column">+</button>
        </div>`));
        el.querySelectorAll("tr").forEach((tr, n) => tr.querySelectorAll("td").forEach((td, c) => fillInline(td, rows[n][c])));
        break;
      }
    }
    return el;
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
      : `<span class="nb-empty-hint">∑ Click to add a TeX equation</span>`;
  }

  function paintMedia(block) {
    const content = block.querySelector(".nb-content");
    const { type } = block.dataset;
    const url = block.dataset.url;
    if (!url) {
      const label = { image: "Add an image", video: "Embed a YouTube video", bookmark: "Add a web bookmark" }[type];
      const glyph = { image: "🖼", video: "▶", bookmark: "🔖" }[type];
      const placeholder = { image: "Paste an image link…", video: "Paste a YouTube link…", bookmark: "Paste a web address…" }[type];
      content.innerHTML = `<div class="nb-media-empty">
        <span class="nb-media-glyph" aria-hidden="true">${glyph}</span><strong>${label}</strong>
        <div class="nb-media-row">
          ${type === "image" ? `<button type="button" class="nb-primary" data-media-upload>${icon("upload")}<span>Upload</span></button><span class="nb-muted">or</span>` : ""}
          <input type="url" placeholder="${placeholder}" data-media-url aria-label="${placeholder}" />
          <button type="button" class="nb-ghost nb-boxed" data-media-embed>Embed</button>
        </div>
      </div>`;
      return;
    }
    if (type === "image") {
      content.innerHTML = `<figure class="nb-figure">
        <img src="${escapeAttr(url)}" alt="" draggable="false" />
        <div class="nb-media-tools" contenteditable="false"><button type="button" data-media-replace>Replace</button><button type="button" data-media-clear>Remove</button></div>
        <figcaption class="nb-caption" contenteditable="true" data-placeholder="Write a caption…"></figcaption>
      </figure>`;
      content.querySelector(".nb-caption").textContent = block.dataset.caption || "";
    } else if (type === "video") {
      const id = youtubeId(url);
      content.innerHTML = id
        ? `<div class="nb-video"><iframe src="https://www.youtube-nocookie.com/embed/${id}" title="YouTube video" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe><div class="nb-media-tools" contenteditable="false"><button type="button" data-media-clear>Remove</button></div></div>`
        : `<p class="nb-muted">That is not a YouTube link. <button type="button" class="nb-link" data-media-clear>Try another</button></p>`;
    } else {
      let host = url;
      try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* keep the address */ }
      content.innerHTML = `<a class="bookmark" href="${escapeAttr(url)}" target="_blank" rel="noopener"><strong>${escapeHTML(host)}</strong><span>${escapeHTML(url)}</span></a>
        <div class="nb-media-tools" contenteditable="false"><button type="button" data-media-clear>Remove</button></div>`;
    }
  }

  /* ---- reading the DOM back into blocks ----------------------------- */

  const textEl = (block) => block && block.querySelector(":scope > .nb-content > .nb-text");
  const typeOf = (block) => block.dataset.type;

  function readBlock(el) {
    const type = typeOf(el);
    if (TEXT_TYPES.has(type)) {
      const b = { type, text: textOf(textEl(el), MULTILINE.has(type)) };
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
        return { type, url: el.dataset.url, caption: cap ? cap.textContent.replace(/\s+/g, " ").trim() : "" };
      }
      case "video": case "bookmark": return { type, url: el.dataset.url };
      case "table": return { type, rows: [...el.querySelectorAll("tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => textOf(td, false))) };
      default: return { type };
    }
  }
  const readBlocks = (container) => [...container.children].filter((c) => c.classList.contains("nb-block")).map(readBlock);
  const bodyMarkdown = () => serializeBlocks(readBlocks(root));

  /* ---- order, numbering, contents ----------------------------------- */

  /** Every block in reading order, skipping those inside closed toggles. */
  const allBlocks = () => [...root.querySelectorAll(".nb-block")].filter((b) => !b.parentElement.closest(".nb-block:not(.is-open)"));

  function refreshDerived() {
    // Numbered lists count per container and indent, like the rendered page.
    root.querySelectorAll(".nb-blocks").forEach((c) => numberIn(c));
    numberIn(root);
    const ids = new Set();
    const headings = [];
    root.querySelectorAll('.nb-block[data-type^="h"]').forEach((b) => {
      const text = textOf(textEl(b), false);
      if (!text) return;
      let id = inlineText(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
      for (let n = 2; ids.has(id); n++) id = `${id.replace(/-\d+$/, "")}-${n}`;
      ids.add(id);
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
    let prevList = false;
    for (const b of container.children) {
      if (!b.classList.contains("nb-block")) continue;
      const type = typeOf(b);
      if (!LIST_TYPES.has(type)) { counts.length = 0; prevList = false; continue; }
      const indent = Number(b.dataset.indent || 0);
      counts.length = indent + 1;
      if (type === "number") {
        counts[indent] = prevList && counts[indent] ? counts[indent] + 1 : 1;
        b.querySelector(".nb-marker").textContent = `${counts[indent]}.`;
      } else {
        counts[indent] = 0;
        if (type === "bullet") b.querySelector(".nb-marker").textContent = ["•", "◦", "▪"][indent % 3];
      }
      prevList = true;
    }
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
    dirty = true;
    refreshDerived();
    paintState();
    $("[data-crumb]").textContent = titleEl.textContent.trim() || "Untitled";
    if (structural) commitHistory();
    else {
      clearTimeout(historyTimer);
      historyTimer = setTimeout(commitHistory, 600);
    }
    clearTimeout(autosaveTimer);
    if (post.status === "draft") autosaveTimer = setTimeout(() => save({ quiet: true }), 1400);
  }

  function restore(snap) {
    const order = allBlocks();
    const focusIndex = order.indexOf(document.activeElement && document.activeElement.closest(".nb-block"));
    titleEl.textContent = snap.title;
    loadBody(snap.body);
    dirty = true;
    refreshDerived();
    paintState();
    clearTimeout(autosaveTimer);
    if (post.status === "draft") autosaveTimer = setTimeout(() => save({ quiet: true }), 1400);
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
      author_name: ed.querySelector("[data-prop=author_name]").value.trim() || null,
      excerpt: ed.querySelector("[data-prop=excerpt]").value.trim() || null,
      cover_url: post.cover_url || null,
      cover_position: Math.round(post.cover_position),
      icon: post.icon || null,
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
   * Page header: cover, icon, title, properties
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
    const current = props.dataset.built ? { author: props.querySelector("[data-prop=author_name]").value, excerpt: props.querySelector("[data-prop=excerpt]").value, slug: props.querySelector("[data-prop=slug]").value } : null;
    props.innerHTML = `
      <div class="nb-prop"><span class="nb-prop-label">${icon("circle-info")}Status</span><span>${statusPill()}</span></div>
      <label class="nb-prop"><span class="nb-prop-label">${icon("link")}Address</span><span class="nb-prop-slug"><span class="nb-muted">/blog/</span><input data-prop="slug" ${locked ? "readonly title=\"Fixed once published, so shared links keep working\"" : ""} placeholder="made from the title" spellcheck="false" /></span></label>
      <label class="nb-prop"><span class="nb-prop-label">${icon("user")}Author</span><input data-prop="author_name" placeholder="Empty" /></label>
      <label class="nb-prop"><span class="nb-prop-label">${icon("pencil")}Summary</span><textarea data-prop="excerpt" rows="1" maxlength="300" placeholder="Empty: the start of the post is used in link previews"></textarea></label>
      <div class="nb-prop"><span class="nb-prop-label">${icon("calendar")}Published</span><span data-published>${post.published_at ? escapeHTML(dateText(post.published_at)) : "Not yet"}</span></div>`;
    props.dataset.built = "1";
    props.querySelector("[data-prop=slug]").value = locked ? post.slug : (current && current.slug) || post.slug || "";
    props.querySelector("[data-prop=author_name]").value = current ? current.author : post.author_name || "";
    props.querySelector("[data-prop=excerpt]").value = current ? current.excerpt : post.excerpt || "";
    autosize(props.querySelector("[data-prop=excerpt]"));
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
    const next = { type, text: b.text || "", indent: LIST_TYPES.has(type) ? b.indent || 0 : 0, ...extra };
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
    if (!root.querySelector(".nb-block")) root.append(blockEl({ type: "p", text: "" }));
    if (focusPrev) {
      const target = order[i - 1] && order[i - 1].isConnected ? order[i - 1] : allBlocks()[0];
      if (target) focusBlock(target, true);
    }
    changed({ structural: true });
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
      el = blockEl({ ...b, type: LIST_TYPES.has(type) ? type : "p" });
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
    if (!text.textContent && !text.querySelector(".math, img")) text.innerHTML = "";
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
      if (parentBlock && isEmptyText(text)) {
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

  /* ---- Markdown shortcuts at the start of a paragraph ---------------- */

  const SHORTCUTS = [
    [/^#\s$/, "h1"], [/^##\s$/, "h2"], [/^###\s$/, "h3"],
    [/^[-*+]\s$/, "bullet"], [/^1[.)]\s$/, "number"],
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
      const lead = /^(#{1,3}|[-*+]|1[.)]|\[\s?\]|["“]|>)\s/.exec(raw);
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
    if (type === "image" || type === "video" || type === "bookmark") {
      const input = el.querySelector("[data-media-url]");
      if (input) input.focus();
    }
  }

  /* ---- inline formatting --------------------------------------------- */

  const INLINE_RULES = [
    [/\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, "strong"],
    [/(?:^|[^*\\])\*([^*\s](?:[^*]*[^*\s])?)\*$/, "em"],
    [/~~([^~\s](?:[^~]*[^~\s])?)~~$/, "s"],
    [/==([^=\s](?:[^=]*[^=\s])?)==$/, "mark"],
    [/`([^`]+)`$/, "code"],
    [/(?:^|[^\\$])\$([^\s$](?:[^$]*[^\s$])?)\$$/, "math"],
  ];

  function tryInlineRule() {
    const r = rangeNow();
    if (!r || !r.collapsed || r.startContainer.nodeType !== 3) return false;
    const node = r.startContainer;
    if (node.parentElement.closest("code, .math")) return false;
    const before = node.data.slice(0, r.startOffset);
    for (const [re, tag] of INLINE_RULES) {
      const m = re.exec(before);
      if (!m) continue;
      const inner = m[1];
      const fullLen = tag === "strong" || tag === "s" || tag === "mark" ? inner.length + 4 : inner.length + 2;
      const start = r.startOffset - fullLen;
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

  function wrapSelection(tag) {
    const r = rangeNow();
    if (!r || r.collapsed) return;
    const host = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement;
    const existing = host.closest(tag);
    if (existing && existing.closest(".nb-text, .nb-cell, .nb-caption")) {
      existing.replaceWith(...existing.childNodes);
      return;
    }
    const el = document.createElement(tag);
    const frag = r.extractContents();
    if (tag === "code") el.textContent = frag.textContent;
    else el.append(frag);
    r.insertNode(el);
    const after = document.createRange();
    after.selectNodeContents(el);
    sel().removeAllRanges();
    sel().addRange(after);
  }

  function format(kind) {
    const r = rangeNow();
    if (!r) return;
    if (kind === "bold") document.execCommand("bold");
    else if (kind === "italic") document.execCommand("italic");
    else if (kind === "strike") document.execCommand("strikeThrough");
    else if (kind === "code") wrapSelection("code");
    else if (kind === "mark") wrapSelection("mark");
    else if (kind === "link") return openLink();
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
   * Popovers: slash menu, block menu, link, math, icon, cover, more
   * ================================================================ */

  function closePopover() {
    if (!popover) return;
    popover.el.remove();
    if (popover.onClose) popover.onClose();
    popover = null;
  }

  function openPopover(html, anchorRect, { onClose, className = "", width } = {}) {
    closePopover();
    const el = h(`<div class="nb-pop ${className}" role="dialog">${html}</div>`);
    if (width) el.style.width = `${width}px`;
    ed.append(el);
    const box = el.getBoundingClientRect();
    let top = anchorRect.bottom + 6;
    if (top + box.height > innerHeight - 8 && anchorRect.top - box.height - 6 > 8) top = anchorRect.top - box.height - 6;
    const left = Math.max(8, Math.min(anchorRect.left, innerWidth - box.width - 8));
    el.style.top = `${Math.max(8, Math.min(top, innerHeight - box.height - 8))}px`;
    el.style.left = `${left}px`;
    popover = { el, onClose };
    return el;
  }

  const caretRect = () => {
    const r = rangeNow();
    if (!r) return null;
    const rect = r.getClientRects()[0];
    if (rect) return rect;
    const node = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
    return node.getBoundingClientRect();
  };

  /* ---- slash menu ----------------------------------------------------- */

  function commandsMatching(q) {
    const query = q.trim().toLowerCase();
    if (!query) return COMMANDS;
    return COMMANDS.filter(([, label, , words]) => `${label} ${words}`.toLowerCase().includes(query));
  }

  function commandListHTML(list, active) {
    let section = "";
    return list.map(([id, label, glyph, , sec], i) => {
      const head = sec !== section ? `<p class="nb-pop-section">${escapeHTML((section = sec))}</p>` : "";
      return `${head}<button type="button" class="nb-cmd${i === active ? " is-active" : ""}" data-cmd="${id}" role="option" aria-selected="${i === active}"><span class="nb-cmd-glyph">${escapeHTML(glyph)}</span><span>${escapeHTML(label)}</span></button>`;
    }).join("") || '<p class="nb-pop-empty">No results</p>';
  }

  /* The menu remembers where its "/" is as a character offset in the
   * block's text, not as a DOM node: browsers split and merge text
   * nodes while you type, and a node reference goes stale. */
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

  function openSlash(block, text) {
    const at = caretOffset(text) - 1;
    if (at < 0 || text.textContent[at] !== "/") return;
    const rect = caretRect();
    if (!rect) return;
    slash = { block, text, at, query: "", active: 0 };
    const el = openPopover(`<div class="nb-cmds" role="listbox" aria-label="Blocks"></div>`, rect, {
      className: "nb-slash",
      onClose: () => { slash = null; },
    });
    paintSlash();
    el.addEventListener("mousedown", (e) => e.preventDefault());
    el.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-cmd]");
      if (btn) runCommand(btn.dataset.cmd);
    });
    el.addEventListener("mousemove", (e) => {
      const btn = e.target.closest("[data-cmd]");
      if (!btn || !slash) return;
      const i = [...el.querySelectorAll("[data-cmd]")].indexOf(btn);
      if (i !== slash.active) { slash.active = i; paintSlash(); }
    });
  }

  function paintSlash() {
    if (!slash || !popover) return;
    const list = commandsMatching(slash.query);
    slash.list = list;
    slash.active = Math.max(0, Math.min(slash.active, list.length - 1));
    const box = popover.el.querySelector(".nb-cmds");
    box.innerHTML = commandListHTML(list, slash.active);
    const act = box.querySelector(".is-active");
    if (act) act.scrollIntoView({ block: "nearest" });
  }

  /** Re-read what was typed after the "/"; close when it no longer applies. */
  function updateSlash() {
    if (!slash) return;
    const pos = caretOffset(slash.text);
    const text = slash.text.textContent;
    if (pos <= slash.at || text[slash.at] !== "/") return closePopover();
    const q = text.slice(slash.at + 1, pos);
    // Like Notion: give up once the query is long, or a space ends a word nothing matches.
    if (q.length > 24 || (/\s$/.test(q) && !commandsMatching(q).length)) return closePopover();
    slash.query = q;
    slash.active = 0;
    paintSlash();
  }

  function moveSlash() {
    if (!slash || !popover) return;
    const rect = caretRect();
    if (rect) {
      popover.el.style.top = `${Math.min(rect.bottom + 6, innerHeight - popover.el.offsetHeight - 8)}px`;
      popover.el.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - popover.el.offsetWidth - 8))}px`;
    }
  }

  function runCommand(id) {
    if (!slash) return;
    const { block, text: slashText, at } = slash;
    const end = Math.max(at + 1, caretOffset(slashText));
    closePopover();
    if (slashText.isConnected) {
      rangeAt(slashText, at, end).deleteContents();
      slashText.normalize();
      const caret = rangeAt(slashText, at, at);
      slashText.focus({ preventScroll: true });
      sel().removeAllRanges();
      sel().addRange(caret);
    }
    if (id === "inline-math") {
      const el = mathSpan("x");
      rangeNow().insertNode(el);
      caretAfter(el);
      changed();
      return openInlineMath(el);
    }
    const text = textEl(block);
    let el;
    if (TEXT_TYPES.has(id)) {
      if (isEmptyText(text)) el = convert(block, id);
      else el = insertAfter(block, { type: id, text: "", children: [] });
      changed({ structural: true });
      return placeCaret(textEl(el));
    }
    if (isEmptyText(text) && typeOf(block) === "p") {
      el = blockEl({ type: id });
      block.replaceWith(el);
    } else {
      el = insertAfter(block, { type: id });
    }
    changed({ structural: true });
    afterInsert(el);
  }

  /* ---- block menu (the ⋮⋮ handle) -------------------------------------- */

  function openBlockMenu(block, anchor) {
    selectBlock(block);
    const type = typeOf(block);
    const turn = TEXT_TYPES.has(type)
      ? COMMANDS.filter(([id]) => TEXT_TYPES.has(id)).map(([id, label, glyph]) =>
          `<button type="button" class="nb-cmd${id === type ? " is-current" : ""}" data-turn="${id}"><span class="nb-cmd-glyph">${escapeHTML(glyph)}</span><span>${escapeHTML(label)}</span></button>`).join("")
      : "";
    const tableItems = type === "table" ? `
      <button type="button" class="nb-cmd" data-act="row"><span class="nb-cmd-glyph">+</span><span>Add row</span></button>
      <button type="button" class="nb-cmd" data-act="col"><span class="nb-cmd-glyph">+</span><span>Add column</span></button>
      <button type="button" class="nb-cmd" data-act="delrow"><span class="nb-cmd-glyph">−</span><span>Delete last row</span></button>
      <button type="button" class="nb-cmd" data-act="delcol"><span class="nb-cmd-glyph">−</span><span>Delete last column</span></button>` : "";
    const el = openPopover(`
      <div class="nb-cmds">
        <button type="button" class="nb-cmd" data-act="delete"><span class="nb-cmd-glyph">${icon("trash")}</span><span>Delete</span><kbd>Del</kbd></button>
        <button type="button" class="nb-cmd" data-act="duplicate"><span class="nb-cmd-glyph">${icon("copy")}</span><span>Duplicate</span><kbd>Ctrl+D</kbd></button>
        <button type="button" class="nb-cmd" data-act="up"><span class="nb-cmd-glyph">${icon("arrow-up")}</span><span>Move up</span><kbd>Ctrl+Shift+↑</kbd></button>
        <button type="button" class="nb-cmd" data-act="down"><span class="nb-cmd-glyph">${icon("arrow-down")}</span><span>Move down</span><kbd>Ctrl+Shift+↓</kbd></button>
        ${tableItems}
        ${turn ? `<p class="nb-pop-section">Turn into</p>${turn}` : ""}
      </div>`, anchor.getBoundingClientRect(), { className: "nb-slash" });
    el.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      closePopover();
      const act = btn.dataset.act;
      if (btn.dataset.turn) {
        const next = convert(block, btn.dataset.turn);
        changed({ structural: true });
        return placeCaret(textEl(next));
      }
      if (act === "delete") return removeBlock(block);
      if (act === "duplicate") return duplicate(block);
      if (act === "up") return moveBlock(block, -1);
      if (act === "down") return moveBlock(block, 1);
      tableAction(block, act);
    });
  }

  function tableAction(block, act) {
    const rows = [...block.querySelectorAll("tr")];
    if (act === "row") {
      const tr = rows[rows.length - 1].cloneNode(true);
      tr.querySelectorAll("td").forEach((td) => { td.innerHTML = ""; td.classList.remove("is-head"); });
      rows[rows.length - 1].after(tr);
      placeCaret(tr.querySelector("td"));
    } else if (act === "col") {
      rows.forEach((tr, n) => tr.append(h(`<td class="nb-cell${n === 0 ? " is-head" : ""}" contenteditable="true"></td>`)));
      placeCaret(rows[0].lastElementChild);
    } else if (act === "delrow" && rows.length > 1) {
      rows[rows.length - 1].remove();
    } else if (act === "delcol" && rows[0].children.length > 1) {
      rows.forEach((tr) => tr.lastElementChild.remove());
    }
    changed({ structural: true });
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
      el.querySelector("[data-swatch]").className = `nb-swatch icon-${color}`;
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
      el.querySelector("[data-color-btn]").hidden = tab !== "Icons";
      el.querySelector("[data-colors]").hidden = true;
      groupsNav.hidden = tab !== "Emoji";
      filter.value = "";
      if (tab === "Upload") {
        body.innerHTML = `<div class="nb-upload-tab">
          <button type="button" class="nb-primary nb-wide" data-upload>${icon("upload")}<span>Upload an image</span></button>
          <form class="nb-form" data-link-form><input type="url" placeholder="…or paste an image link (https://…)" aria-label="Image link" /><button type="submit" class="nb-ghost nb-boxed">Use link</button></form>
          <p class="nb-muted">Square images look best. Uploads go to the club's public image repository.</p>
        </div>`;
        body.querySelector("[data-upload]").addEventListener("click", () => pickFile(async (file) => {
          const label = body.querySelector("[data-upload] span");
          if (label) label.textContent = "Uploading…";
          const url = await upload(file);
          if (url) pick(url);
        }));
        body.querySelector("[data-link-form]").addEventListener("submit", (e) => {
          e.preventDefault();
          const url = e.target.querySelector("input").value.trim();
          if (/^https:\/\/\S+$/i.test(url)) pick(url);
          else opts.toast("Use a full link starting with https://", "error");
        });
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
      if (swatch) { color = swatch.dataset.color; paintColor(); return; }
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
        <div class="nb-picker-body"><div class="nb-upload-tab">
          <button type="button" class="nb-primary nb-wide" data-upload>${icon("upload")}<span>Upload an image</span></button>
          <form class="nb-form" data-link-form><input type="url" placeholder="…or paste an image link (https://…)" aria-label="Cover image link" /><button type="submit" class="nb-ghost nb-boxed">Use link</button></form>
          <p class="nb-muted">Wide images work best: at least 1500px across. The cover is also the post's link preview.</p>
        </div></div>
      </div>`, anchor.getBoundingClientRect(), { width: 408 });
    const setCover = (url) => {
      closePopover();
      post.cover_url = url;
      post.cover_position = 50;
      paintCover();
      changed();
    };
    el.querySelector("[data-upload]").addEventListener("click", () => pickFile(async (file) => {
      el.querySelector("[data-upload] span").textContent = "Uploading…";
      const url = await upload(file);
      if (url) setCover(url);
    }));
    el.querySelector("[data-link-form]").addEventListener("submit", (e) => {
      e.preventDefault();
      const url = e.target.querySelector("input").value.trim();
      if (/^https:\/\/\S+$/i.test(url)) setCover(url);
      else opts.toast("Use a full link starting with https://", "error");
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

  /* ---- more menu -------------------------------------------------------------- */

  function openMore(anchor) {
    const live = post.status === "published";
    const el = openPopover(`
      <div class="nb-cmds" role="menu">
        ${live ? `<a class="nb-cmd" role="menuitem" href="blog/${escapeAttr(post.slug)}/" target="_blank" rel="noopener"><span class="nb-cmd-glyph">${icon("external-link")}</span><span>View on site</span></a>` : ""}
        ${live ? `<button type="button" class="nb-cmd" role="menuitem" data-act="unpublish"><span class="nb-cmd-glyph">${icon("eye-off")}</span><span>Unpublish (back to draft)</span></button>` : ""}
        ${!live && post.id ? `<button type="button" class="nb-cmd" role="menuitem" data-act="save"><span class="nb-cmd-glyph">${icon("check")}</span><span>Save draft now</span><kbd>Ctrl+S</kbd></button>` : ""}
        <button type="button" class="nb-cmd" role="menuitem" data-act="copy"><span class="nb-cmd-glyph">${icon("copy")}</span><span>Copy as Markdown</span></button>
        ${post.id ? `<button type="button" class="nb-cmd nb-danger" role="menuitem" data-act="delete" ${opts.isAdmin ? "" : 'disabled title="Only admins can delete"'}><span class="nb-cmd-glyph">${icon("trash")}</span><span>Delete post</span></button>` : ""}
        <p class="nb-pop-section">Shortcuts</p>
        <p class="nb-help">/ blocks · Ctrl+B/I/E/K format · Ctrl+Z undo · Tab nest · Ctrl+Shift+↑↓ move · Esc select block · Ctrl+S save</p>
      </div>`, anchor.getBoundingClientRect(), { width: 300 });
    el.style.left = `${Math.max(8, anchor.getBoundingClientRect().right - 300)}px`;
    el.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn || btn.disabled) return;
      const act = btn.dataset.act;
      if (act === "delete" && !btn.dataset.armed) {
        btn.dataset.armed = "1";
        btn.querySelector("span:last-child").textContent = "Click again to delete";
        return;
      }
      closePopover();
      if (act === "unpublish") {
        if (await save({ status: "draft" })) opts.toast("Unpublished. It leaves the site at the next rebuild.", "info");
      } else if (act === "save") {
        save();
      } else if (act === "copy") {
        try {
          await navigator.clipboard.writeText(`# ${values().title}\n\n${bodyMarkdown()}`);
          opts.toast("Copied as Markdown.", "info");
        } catch {
          opts.toast("The browser blocked copying.", "error");
        }
      } else if (act === "delete") {
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

  /* ---- floating format toolbar ----------------------------------------------- */

  function paintToolbar() {
    const r = rangeNow();
    const host = r && (r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement);
    const inText = host && host.closest(".nb-text, .nb-cell") && root.contains(host);
    if (!r || r.collapsed || !inText || popover) { toolbar.hidden = true; return; }
    toolbar.hidden = false;
    const rect = r.getBoundingClientRect();
    const box = toolbar.getBoundingClientRect();
    toolbar.style.top = `${Math.max(56, rect.top - box.height - 8)}px`;
    toolbar.style.left = `${Math.max(8, Math.min(rect.left + rect.width / 2 - box.width / 2, innerWidth - box.width - 8))}px`;
    toolbar.querySelector("[data-fmt=bold]").classList.toggle("is-on", document.queryCommandState("bold"));
    toolbar.querySelector("[data-fmt=italic]").classList.toggle("is-on", document.queryCommandState("italic"));
    toolbar.querySelector("[data-fmt=strike]").classList.toggle("is-on", document.queryCommandState("strikeThrough"));
  }

  /* ================================================================
   * Events
   * ================================================================ */

  function onKeydown(e) {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;

    if (popover && slash) {
      if (k === "ArrowDown" || k === "ArrowUp") {
        e.preventDefault();
        slash.active = (slash.active + (k === "ArrowDown" ? 1 : -1) + slash.list.length) % Math.max(1, slash.list.length);
        return paintSlash();
      }
      if (k === "Enter" || k === "Tab") {
        if (slash.list.length) { e.preventDefault(); return runCommand(slash.list[slash.active][0]); }
      }
      if (k === "Escape") { e.preventDefault(); return closePopover(); }
    }
    if (k === "Escape" && popover) { e.preventDefault(); return closePopover(); }

    if (mod && k.toLowerCase() === "s") { e.preventDefault(); return save(); }

    const target = e.target;
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
        const p = insertAfter(selectedBlock, { type: "p", text: "" });
        changed({ structural: true });
        return focusBlock(p);
      }
      if (mod && k.toLowerCase() === "d") { e.preventDefault(); return duplicate(selectedBlock); }
      if (mod && e.shiftKey && (k === "ArrowUp" || k === "ArrowDown")) { e.preventDefault(); return moveBlock(selectedBlock, k === "ArrowUp" ? -1 : 1); }
      if (k === "Escape") { e.preventDefault(); return selectBlock(null); }
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

    if (mod && !e.shiftKey) {
      const map = { b: "bold", i: "italic", e: "code", k: "link" };
      if (map[k.toLowerCase()]) { e.preventDefault(); return format(map[k.toLowerCase()]); }
      if (k.toLowerCase() === "d") { e.preventDefault(); return duplicate(block); }
      if (k === "/") { e.preventDefault(); return openBlockMenu(block, block.querySelector(".nb-drag")); }
    }
    if (mod && e.shiftKey) {
      if (k.toLowerCase() === "s" || k.toLowerCase() === "x") { e.preventDefault(); return format("strike"); }
      if (k.toLowerCase() === "h") { e.preventDefault(); return format("mark"); }
      if (k === "ArrowUp" || k === "ArrowDown") { e.preventDefault(); return moveBlock(block, k === "ArrowUp" ? -1 : 1); }
    }

    if (k === "Escape") { e.preventDefault(); return selectBlock(block); }
    if (k === "Tab") { e.preventDefault(); return indent(block, e.shiftKey ? -1 : 1); }

    if (k === "Enter" && !e.isComposing) {
      if (e.shiftKey && MULTILINE.has(typeOf(block))) return;
      e.preventDefault();
      if (e.shiftKey) return;
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
      return;
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
      else if (!e.shiftKey) { tableAction(block, "row"); }
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cols = cell.parentElement.children.length;
      const below = cells[i + cols];
      if (below) placeCaret(below);
      else tableAction(block, "row");
    } else if (e.key === "Escape") {
      e.preventDefault();
      selectBlock(block);
    } else if ((e.ctrlKey || e.metaKey) && ["b", "i", "e", "k"].includes(e.key.toLowerCase())) {
      e.preventDefault();
      format({ b: "bold", i: "italic", e: "code", k: "link" }[e.key.toLowerCase()]);
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
    if (target.matches("[data-media-url]")) return;
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
      if (!e.isComposing && e.inputType === "insertText") {
        if (tryShortcut(block)) return;
        if (tryInlineRule()) return changed();
      }
      if (slash) updateSlash();
      else if (e.inputType === "insertText" && e.data === "/") openSlash(block, target);
    }
    changed();
  }

  function onClick(e) {
    const t = e.target;
    if (t.closest(".nb-tip")) return;
    if (popover && !popover.el.contains(t)) closePopover();

    if (t.closest("[data-close]")) return close();
    if (t.closest("[data-save]")) {
      if (post.status === "published") return save();
      return save({ status: "published" }).then((ok) => ok && opts.toast("Published. It is live in about a minute.", "success"));
    }
    if (t.closest("[data-more]")) return openMore(t.closest("[data-more]"));
    if (t.closest("[data-preview]")) return togglePreview();
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
      openSlash(p, text);
      return;
    }
    if (t.closest(".nb-drag")) return openBlockMenu(t.closest(".nb-block"), t.closest(".nb-drag"));
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
    if (t.closest("[data-media-upload]") || t.closest("[data-media-replace]")) {
      return pickFile((file) => uploadInto(block, file));
    }
    if (t.closest("[data-media-embed]")) return embedFromInput(block);
    if (t.closest("[data-media-clear]")) {
      block.dataset.url = "";
      paintMedia(block);
      return changed({ structural: true });
    }
    if (t.closest(".bookmark")) return;
    if (!TEXT_TYPES.has(typeOf(block)) && !t.closest("input, textarea, select, [contenteditable=true], button")) selectBlock(block);
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
    const content = block.querySelector(".nb-content");
    const before = content.innerHTML;
    content.innerHTML = `<div class="nb-media-empty"><span class="nb-spinner" aria-hidden="true"></span><strong>Uploading ${escapeHTML(file.name)}…</strong></div>`;
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
    if (!files.length) return;
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
        if (!t.value.trim() && !popover) { /* keep the empty equation: it shows its hint */ }
      }, 0);
    }
    if (t.matches && t.matches("[data-media-url]")) return;
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
  }

  function onMediaKey(e) {
    if (e.key === "Enter" && e.target.matches("[data-media-url]")) {
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
  ed.addEventListener("paste", onPaste);
  ed.addEventListener("dragover", (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) e.preventDefault(); });
  ed.addEventListener("drop", onDrop);
  ed.addEventListener("focusout", onFocusOut);
  ed.addEventListener("change", onChange);
  ed.addEventListener("mousedown", (e) => {
    if (e.target.closest("[data-toolbar]")) e.preventDefault();
    if (selectedBlock && !selectedBlock.contains(e.target)) selectBlock(null);
  });
  toolbar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-fmt]");
    if (b) format(b.dataset.fmt);
  });
  $("[data-scroll]").addEventListener("scroll", () => { moveSlash(); toolbar.hidden = true; });
  document.addEventListener("selectionchange", paintToolbar);
  window.addEventListener("beforeunload", beforeUnload);

  titleEl.textContent = post.title || "";
  $("[data-crumb]").textContent = post.title || "Untitled";
  loadBody(post.body);
  paintCover();
  paintIcon();
  paintProps();
  refreshDerived();
  paintState();
  commitHistory();

  document.body.append(ed);
  document.body.classList.add("nb-open");
  if (post.title) focusBlock(allBlocks()[0], true);
  else placeCaret(titleEl);

  return { close };
}
