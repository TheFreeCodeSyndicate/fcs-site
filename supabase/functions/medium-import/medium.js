// supabase/functions/medium-import/medium.js
// --------------------------------------------------------------------
// Pure helpers for the Medium importer, kept free of Deno and network
// APIs so `npm test` can import them (js/lib/medium.test.js), exactly as
// upload-asset/asset.js is imported by js/lib/asset.test.js.
//
// Only URL, Date and JSON are used. Nothing here fetches anything.
// --------------------------------------------------------------------

const HEX = /^(?:https?:\/\/)?(?:www\.)?/i;
const STORY_ID = /-([0-9a-f]{12})(?:[?#]|$)/i;
const SHORT_ID = /^https?:\/\/(?:www\.)?medium\.com\/p\/([0-9a-f]{12})(?:[?#]|$)/i;
const PROFILE = /^https?:\/\/(?:www\.)?medium\.com\/@([A-Za-z0-9_.-]+)(?:\/([^?#]*))?/i;
const SUBDOMAIN = /^https?:\/\/([a-z0-9-]+)\.medium\.com\/([^?#]*)/i;
const PUBLICATION = /^https?:\/\/(?:www\.)?medium\.com\/([A-Za-z0-9-]+)\/([^?#]*)/i;
const BARE_HANDLE = /^@?([A-Za-z0-9][A-Za-z0-9_.-]*)$/;

/** Medium's own paths that are not publications. */
const NOT_A_PUBLICATION = new Set(["p", "feed", "tag", "search", "me", "new-story", "m", "about", "policy", "membership"]);

/**
 * What the writer typed.
 * @returns {{kind:"handle"|"story", handle?:string, host?:string, publication?:string, postId?:string}|null}
 */
export function parseInput(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const shortMatch = SHORT_ID.exec(raw);
  if (shortMatch) {
    return { kind: "story", postId: shortMatch[1].toLowerCase() };
  }

  const profileMatch = PROFILE.exec(raw);
  if (profileMatch) {
    const handle = profileMatch[1];
    const rest = profileMatch[2];
    if (!rest) {
      return { kind: "handle", handle };
    }
    const storyMatch = STORY_ID.exec(rest);
    if (storyMatch) {
      return { kind: "story", handle, postId: storyMatch[1].toLowerCase() };
    }
    return null;
  }

  const subMatch = SUBDOMAIN.exec(raw);
  if (subMatch) {
    const sub = subMatch[1].toLowerCase();
    if (sub !== "www" && !NOT_A_PUBLICATION.has(sub)) {
      const rest = subMatch[2];
      if (!rest) {
        return { kind: "handle", handle: sub };
      }
      const storyMatch = STORY_ID.exec(rest);
      if (storyMatch) {
        return { kind: "story", handle: sub, postId: storyMatch[1].toLowerCase() };
      }
      return null;
    }
  }

  const pubMatch = PUBLICATION.exec(raw);
  if (pubMatch) {
    const pub = pubMatch[1];
    if (!NOT_A_PUBLICATION.has(pub.toLowerCase())) {
      const rest = pubMatch[2];
      const storyMatch = STORY_ID.exec(rest);
      if (storyMatch) {
        return { kind: "story", publication: pub, postId: storyMatch[1].toLowerCase() };
      }
    }
    return null;
  }

  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const storyMatch = STORY_ID.exec(u.pathname);
      if (storyMatch) {
        return { kind: "story", host: u.host, postId: storyMatch[1].toLowerCase() };
      }
    } catch {}
    return null;
  }

  if (raw.includes("/") || raw.includes(".com")) {
    return null;
  }

  const bare = BARE_HANDLE.exec(raw);
  if (bare) {
    return { kind: "handle", handle: bare[1] };
  }

  return null;
}

/** The feed to fetch for a parsed input, or null. */
export function feedURLFor(input) {
  if (!input) return null;
  if (input.handle) return `https://medium.com/feed/@${input.handle}`;
  if (input.publication) return `https://medium.com/feed/${input.publication}`;
  if (input.host) return `https://${input.host}/feed`;
  return null;
}


/**
 * Unwraps XML CDATA tags if present.
 */
function unwrapCdata(str) {
  return String(str || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

/**
 * Decodes basic XML / HTML entities.
 */
export function decodeEntities(str) {
  return String(str || "")
    .replace(/&#(\d+);/g, (match, dec) => {
      try {
        const code = parseInt(dec, 10);
        return Number.isFinite(code) && code >= 0 ? String.fromCodePoint(code) : match;
      } catch {
        return match;
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
      try {
        const code = parseInt(hex, 16);
        return Number.isFinite(code) && code >= 0 ? String.fromCodePoint(code) : match;
      } catch {
        return match;
      }
    })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Strips HTML tags from a string.
 */
function stripHtml(str) {
  return String(str || "").replace(/<[^>]+>/g, "");
}

/**
 * Parse a Medium RSS feed string into an author name and story summaries.
 * @param {string} xml
 * @returns {{ author: string, stories: Array<{ id: string, title: string, url: string, publishedAt: string, importable: boolean, publication: string, excerpt: string, thumbnail: string, reason?: string }> }}
 */
export function parseFeed(xml) {
  const text = String(xml || "");

  // Author is the first <dc:creator>'s CDATA, with CDATA wrapper removed
  const authorMatch = text.match(/<dc:creator\b[^>]*>([\s\S]*?)<\/dc:creator>/i);
  const author = authorMatch ? decodeEntities(unwrapCdata(authorMatch[1])).trim() : "";

  const stories = [];
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let itemMatch;

  while ((itemMatch = itemRegex.exec(text)) !== null) {
    const itemXml = itemMatch[1];

    // ID comes from <guid> (e.g. https://medium.com/p/<12hex>), NOT <link>
    const guidMatch = itemXml.match(/<guid\b[^>]*>([\s\S]*?)<\/guid>/i);
    let id = "";
    if (guidMatch) {
      const hexMatch = unwrapCdata(guidMatch[1]).match(/([0-9a-f]{12})/i);
      if (hexMatch) {
        id = hexMatch[1].toLowerCase();
      }
    }

    // Title from <title>
    const titleMatch = itemXml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? decodeEntities(unwrapCdata(titleMatch[1])).trim() : "";

    // URL from <link>, strip tracking query (?source=rss...)
    const linkMatch = itemXml.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i);
    let url = "";
    let linkHost = "";
    if (linkMatch) {
      const rawUrl = decodeEntities(unwrapCdata(linkMatch[1])).trim();
      try {
        const u = new URL(rawUrl);
        u.searchParams.delete("source");
        linkHost = u.host;
        url = u.toString();
      } catch {
        url = rawUrl;
      }
    }

    // Published date from <pubDate>
    const pubDateMatch = itemXml.match(/<pubDate\b[^>]*>([\s\S]*?)<\/pubDate>/i);
    let publishedAt = "";
    if (pubDateMatch) {
      try {
        publishedAt = new Date(unwrapCdata(pubDateMatch[1]).trim()).toISOString();
      } catch {}
    }

    // Content encoded
    const contentMatch = itemXml.match(/<content:encoded\b[^>]*>([\s\S]*?)<\/content:encoded>/i);
    const hasContent = Boolean(contentMatch);
    const importable = hasContent;

    let publication = "";
    let excerpt = "";
    let thumbnail = "";
    let reason;

    if (hasContent) {
      const content = unwrapCdata(contentMatch[1]);

      // Publication from footer: ... was originally published in <a ...>Publication</a> on Medium ...
      const footerMatch = content.match(/was originally published in\s+<a\b[^>]*>([\s\S]*?)<\/a>\s+on Medium/i);
      if (footerMatch) {
        publication = decodeEntities(stripHtml(footerMatch[1])).trim();
      } else {
        publication = linkHost;
      }

      // Excerpt from first <p>
      const pMatch = content.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
      if (pMatch) {
        excerpt = decodeEntities(stripHtml(pMatch[1])).trim();
      }

      // Thumbnail from first <img> that is not /_/stat
      const imgRegex = /<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi;
      let imgMatch;
      while ((imgMatch = imgRegex.exec(content)) !== null) {
        const src = imgMatch[1];
        if (!src.includes("/_/stat")) {
          thumbnail = decodeEntities(src);
          break;
        }
      }
    } else {
      reason = "Medium publishes only a teaser for member-only stories.";
      publication = linkHost;
      excerpt = "";
      thumbnail = "";
    }

    const story = {
      id,
      title,
      url,
      publishedAt,
      importable,
      publication,
      excerpt,
      thumbnail,
    };
    if (!importable && reason) {
      story.reason = reason;
    }

    stories.push(story);
  }

  return { author, stories };
}

/**
 * Strips Medium tracking pixels and trailing publication footer boilerplate.
 * Order of operations:
 * 1. Drop every <img> whose src starts with https://medium.com/_/stat
 * 2. Drop trailing footer: <hr>\s*<p>...on Medium, where people are continuing the conversation...</p>
 * 3. Drop any dangling rule (<hr>) left at the very end.
 * @param {string} html
 * @returns {string}
 */
export function stripBoilerplate(html) {
  let text = String(html || "");
  text = text.replace(/<img\b[^>]*?\bsrc=["']https:\/\/medium\.com\/_\/stat[^"']*["'][^>]*\/?>/gi, "");
  text = text.replace(/<hr\s*\/?>\s*<p\b[^>]*>[\s\S]*?on Medium, where people are continuing the conversation[\s\S]*?<\/p>\s*$/i, "");
  text = text.replace(/<hr\s*\/?>\s*$/i, "");
  return text;
}

const VOID_ELEMENTS = new Set(["br", "hr", "img", "meta", "link", "input"]);

/**
 * Parses an HTML tag attribute string quote-aware.
 * Values are entity-decoded.
 * @param {string} attrsStr
 * @returns {Record<string, string>}
 */
function parseAttrs(attrsStr) {
  const attrs = {};
  if (!attrsStr) return attrs;
  const attrRegex = /([a-zA-Z][\w-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = attrRegex.exec(attrsStr)) !== null) {
    const name = m[1].toLowerCase();
    const val = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : ""));
    attrs[name] = decodeEntities(val);
  }
  return attrs;
}

/**
 * A quote-aware HTML tokeniser for the RSS/Medium subset.
 * Uses a stack to build an element tree, treats void elements properly,
 * and decodes entities in text nodes and attribute values.
 * @param {string} html
 * @returns {Array<object>} Root nodes
 */
export function parseHTML(html) {
  const root = { children: [] };
  const stack = [root];
  const tagRegex = /<\/?([a-zA-Z][\w-]*)((?:\s+[\w-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/g;
  let lastIndex = 0;
  let match;
  const str = String(html || "");

  while ((match = tagRegex.exec(str)) !== null) {
    if (match.index > lastIndex) {
      const rawText = str.slice(lastIndex, match.index);
      if (rawText) {
        if (stack.length > 1 || rawText.trim().length > 0) {
          const parent = stack[stack.length - 1];
          parent.children.push({
            type: "text",
            text: decodeEntities(rawText),
          });
        }
      }
    }
    lastIndex = tagRegex.lastIndex;

    const fullTag = match[0];
    const isClosing = fullTag.startsWith("</");
    const tagName = match[1].toLowerCase();

    if (isClosing) {
      let idx = -1;
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tagName) {
          idx = i;
          break;
        }
      }
      if (idx !== -1) {
        stack.length = idx;
      }
    } else {
      const attrs = parseAttrs(match[2]);
      const isVoid = VOID_ELEMENTS.has(tagName) || /\/\s*>$/.test(fullTag);
      const node = {
        tag: tagName,
        attrs,
        children: [],
      };
      const parent = stack[stack.length - 1];
      parent.children.push(node);
      if (!isVoid) {
        stack.push(node);
      }
    }
  }

  if (lastIndex < str.length) {
    const rawText = str.slice(lastIndex);
    if (rawText) {
      if (stack.length > 1 || rawText.trim().length > 0) {
        const parent = stack[stack.length - 1];
        parent.children.push({
          type: "text",
          text: decodeEntities(rawText),
        });
      }
    }
  }

  return root.children;
}

/**
 * Recursively extracts plain text from a node or array of nodes.
 * Maps <br> elements to "\n".
 * @param {any} nodes
 * @returns {string}
 */
export function textOf(nodes) {
  if (nodes == null) return "";
  if (typeof nodes === "string") return nodes;
  if (Array.isArray(nodes)) return nodes.map(textOf).join("");
  if (nodes.tag === "br") return "\n";
  if (nodes.type === "text") return nodes.text || "";
  if (nodes.children) return textOf(nodes.children);
  if (typeof nodes.text === "string") return nodes.text;
  return "";
}

/**
 * Parses an iframe's attributes and returns the decoded url query parameter
 * when the src is a cdn.embedly.com/widgets/media.html address, else null.
 * Decoding handles &amp; entity escaping and percent-encoding.
 * @param {object|string} attrs
 * @returns {string|null}
 */
export function embedTarget(attrs) {
  if (!attrs) return null;
  const src = typeof attrs === "string" ? attrs : (attrs.src || attrs.SRC || "");
  if (!src) return null;
  const cleanSrc = decodeEntities(src);
  if (!cleanSrc.includes("cdn.embedly.com/widgets/media.html")) return null;

  let rawUrl = null;
  try {
    const u = new URL(cleanSrc, "https://cdn.embedly.com");
    rawUrl = u.searchParams.get("url");
  } catch {}

  if (!rawUrl) {
    const m = /[?&]url=([^&#]+)/.exec(cleanSrc);
    if (m) rawUrl = m[1];
  }
  if (!rawUrl) return null;

  try {
    return decodeURIComponent(rawUrl);
  } catch {
    return rawUrl;
  }
}

const ONE_LINE_RE = /\s*\n\s*/g;
function oneLine(s) {
  return String(s || "").replace(ONE_LINE_RE, " ").trim();
}

function isListBlock(b) {
  return b && (b.type === "bullet" || b.type === "number" || b.type === "todo");
}

function startsBlock(line) {
  return (
    /^(#{1,4}\s|>|\+\+\+|:::|```|\$\$|---+$\s*|\[\[toc\]\]\s*|\|)/.test(line) ||
    /^( *)(?:([-*])\s+\[( |x|X)\]|([-*])|(\d+)[.)])\s+(.*)$/.test(line) ||
    /^!\[((?:\\.|[^\]\\])*)\]\((https:\/\/[^\s)]+)\)\s*$/.test(line) ||
    /^@\[(video|bookmark)\]\((https:\/\/[^\s)]+)\)\s*$/.test(line)
  );
}

function guard(line) {
  return startsBlock(line) ? `\\${line}` : line;
}

/**
 * Serializes an array of block objects into Markdown suitable for the FCS site editor.
 * @param {Array<object>|object} blocks
 * @returns {string}
 */
export function serializeSection(blocks) {
  if (!blocks) return "";
  const list = Array.isArray(blocks) ? blocks : [blocks];
  const parts = [];
  const counters = [];
  let prev = null;

  for (const b of list) {
    if (!b) continue;
    let text = "";
    if (isListBlock(b)) {
      const indent = Math.max(0, Math.min(b.indent || 0, 6));
      counters.length = indent + 1;
      counters[indent] =
        b.type === "number" && prev && prev.type === "number" && (prev.indent || 0) >= indent
          ? (counters[indent] || 0) + 1
          : b.type === "number"
          ? 1
          : 0;
      const pad = "  ".repeat(indent);
      const marker =
        b.type === "todo" ? `- [${b.checked ? "x" : " "}]` : b.type === "number" ? `${counters[indent]}.` : "-";
      const lines = String(b.text || "")
        .split(/\n+/)
        .map((l) => l.trim())
        .filter((l, n) => l || n === 0);
      text = `${pad}${marker} ${lines.join(`\n${pad}${" ".repeat(marker.length + 1)}`)}`;
    } else {
      counters.length = 0;
      switch (b.type) {
        case "h1":
        case "h2":
        case "h3":
        case "h4":
          text = `${"#".repeat(Number(b.type[1]))} ${oneLine(b.text)}`;
          break;
        case "quote":
          text = String(b.text || "")
            .split("\n")
            .map((l) => (l ? `> ${l}` : ">"))
            .join("\n");
          if (!b.text) text = ">";
          break;
        case "code": {
          const longest = Math.max(2, ...(String(b.code || "").match(/^`+/gm) || []).map((f) => f.length));
          const fence = "`".repeat(longest + 1);
          text = `${fence}${b.lang || ""}\n${b.code || ""}\n${fence}`;
          break;
        }
        case "divider":
          text = "---";
          break;
        case "image":
          text = b.url ? `![${oneLine(b.caption).replace(/([\\\]\[])/g, "\\$1")}](${b.url})` : "";
          break;
        case "video":
        case "bookmark":
          text = b.url ? `@[${b.type}](${b.url})` : "";
          break;
        default:
          text = String(b.text || "")
            .split("\n")
            .map(guard)
            .join("\n");
      }
    }
    if (text) {
      parts.push((parts.length ? (isListBlock(b) && isListBlock(prev) ? "\n" : "\n\n") : "") + text);
    }
    prev = b;
  }
  return parts.join("");
}

function isYouTubeUrl(url) {
  return /^https:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i.test(
    String(url || "").trim()
  );
}

function inlineMarkdown(nodes) {
  if (nodes == null) return "";
  if (typeof nodes === "string") return nodes;
  if (Array.isArray(nodes)) return nodes.map(inlineMarkdown).join("");
  if (nodes.type === "text") return nodes.text || "";
  if (nodes.tag === "br") return "\n";

  const inner = inlineMarkdown(nodes.children);
  switch (nodes.tag) {
    case "strong":
    case "b":
      return inner ? `**${inner}**` : "";
    case "em":
    case "i":
      return inner ? `*${inner}*` : "";
    case "code":
      return inner ? `\`${inner}\`` : "";
    case "a": {
      const href = (nodes.attrs && (nodes.attrs.href || nodes.attrs.HREF)) || "";
      if (isYouTubeUrl(href)) {
        return `@[video](${href})`;
      }
      return href ? `[${inner || href}](${href})` : inner;
    }
    case "img": {
      const src = (nodes.attrs && (nodes.attrs.src || nodes.attrs.SRC)) || "";
      const alt = (nodes.attrs && (nodes.attrs.alt || nodes.attrs.ALT)) || "";
      return src ? `![${alt}](${src})` : "";
    }
    default:
      return inner;
  }
}

function collectListItems(listNode, indent = 0) {
  const items = [];
  const type = listNode.tag === "ol" ? "number" : "bullet";

  for (const child of listNode.children || []) {
    if (child.type === "text" && !child.text.trim()) continue;

    if (child.tag === "li") {
      const inlineChildren = [];
      const nestedLists = [];

      for (const grandChild of child.children || []) {
        if (grandChild.tag === "ul" || grandChild.tag === "ol") {
          nestedLists.push(grandChild);
        } else {
          inlineChildren.push(grandChild);
        }
      }

      const text = inlineMarkdown(inlineChildren).trim();
      if (text) {
        items.push({ type, indent, text });
      }

      for (const nested of nestedLists) {
        items.push(...collectListItems(nested, indent + 1));
      }
    } else if (child.tag === "ul" || child.tag === "ol") {
      items.push(...collectListItems(child, indent + 1));
    }
  }
  return items;
}

function findTag(node, tag) {
  if (!node) return null;
  if (node.tag === tag) return node;
  for (const child of node.children || []) {
    const found = findTag(child, tag);
    if (found) return found;
  }
  return null;
}

function flattenElements(nodes) {
  const flat = [];
  for (const node of nodes || []) {
    if (node.type === "text") {
      if (node.text.trim()) {
        flat.push(node);
      }
    } else if (["div", "section", "article", "main"].includes(node.tag)) {
      flat.push(...flattenElements(node.children));
    } else {
      flat.push(node);
    }
  }
  return flat;
}

function makeLabel(kind, text) {
  const clean = oneLine(text || "");
  if (!clean) {
    if (kind === "divider") return "---";
    if (kind === "image") return "Image";
    if (kind === "code") return "Code";
    if (kind === "video") return "Video";
    if (kind === "list") return "List";
    return kind;
  }
  return clean.length <= 60 ? clean : clean.slice(0, 59) + "…";
}

/**
 * Converts Medium story HTML into an array of editable section objects.
 * @param {string} html
 * @param {{ dropped?: boolean }} [opts]
 * @returns {Array<object>|{ sections: Array<object>, dropped: Array<object> }}
 */
export function htmlToSections(html, opts = {}) {
  const cleanHtml = stripBoilerplate(html);
  const parsed = parseHTML(cleanHtml);
  const elements = flattenElements(parsed);
  const dropped = [];
  const rawSections = [];

  let i = 0;
  while (i < elements.length) {
    const el = elements[i];

    // 1. Merge consecutive <pre> runs
    if (el.tag === "pre") {
      const preRun = [];
      while (i < elements.length && elements[i].tag === "pre") {
        preRun.push(elements[i]);
        i++;
      }
      const code = preRun
        .map((p) => textOf(p).replace(/\r\n?/g, "\n").replace(/\n+$/, ""))
        .join("\n");
      const blocks = [{ type: "code", lang: "", code }];
      rawSections.push({
        kind: "code",
        blocks,
        label: makeLabel("code", code),
        images: [],
      });
      continue;
    }

    // 2. Lists (ul/ol)
    if (el.tag === "ul" || el.tag === "ol") {
      const listItems = [];
      while (i < elements.length && (elements[i].tag === "ul" || elements[i].tag === "ol")) {
        listItems.push(...collectListItems(elements[i], 0));
        i++;
      }
      if (listItems.length > 0) {
        rawSections.push({
          kind: "list",
          blocks: listItems,
          label: makeLabel("list", listItems[0]?.text),
          images: [],
        });
      }
      continue;
    }

    // 3. Iframe (direct)
    if (el.tag === "iframe") {
      const target = embedTarget(el.attrs);
      if (target) {
        if (isYouTubeUrl(target)) {
          const blocks = [{ type: "video", url: target }];
          rawSections.push({
            kind: "video",
            blocks,
            label: makeLabel("video", target),
            images: [],
          });
        } else {
          const blocks = [{ type: "p", text: `[${target}](${target})` }];
          rawSections.push({
            kind: "p",
            blocks,
            label: makeLabel("p", target),
            images: [],
          });
        }
      } else {
        dropped.push({ kind: "embed" });
      }
      i++;
      continue;
    }

    // 4. Figure
    if (el.tag === "figure") {
      const iframe = findTag(el, "iframe");
      if (iframe) {
        const target = embedTarget(iframe.attrs);
        if (target) {
          if (isYouTubeUrl(target)) {
            const blocks = [{ type: "video", url: target }];
            rawSections.push({
              kind: "video",
              blocks,
              label: makeLabel("video", target),
              images: [],
            });
          } else {
            const blocks = [{ type: "p", text: `[${target}](${target})` }];
            rawSections.push({
              kind: "p",
              blocks,
              label: makeLabel("p", target),
              images: [],
            });
          }
        } else {
          dropped.push({ kind: "embed" });
        }
        i++;
        continue;
      }

      const img = findTag(el, "img");
      if (img) {
        const url = (img.attrs && (img.attrs.src || img.attrs.SRC)) || "";
        const figcaption = findTag(el, "figcaption");
        const caption = figcaption
          ? textOf(figcaption).trim()
          : (img.attrs && (img.attrs.alt || img.attrs.ALT)) || "";
        if (url) {
          const blocks = [{ type: "image", url, caption }];
          rawSections.push({
            kind: "image",
            blocks,
            label: makeLabel("image", caption),
            images: [url],
          });
        }
        i++;
        continue;
      }

      const pre = findTag(el, "pre");
      if (pre) {
        const code = textOf(pre).replace(/\r\n?/g, "\n").replace(/\n+$/, "");
        const blocks = [{ type: "code", lang: "", code }];
        rawSections.push({
          kind: "code",
          blocks,
          label: makeLabel("code", code),
          images: [],
        });
        i++;
        continue;
      }

      const text = inlineMarkdown(el.children).trim();
      if (text) {
        rawSections.push({
          kind: "p",
          blocks: [{ type: "p", text }],
          label: makeLabel("p", text),
          images: [],
        });
      }
      i++;
      continue;
    }

    // 5. Headings
    if (/^h[1-6]$/.test(el.tag)) {
      let kind = "h1";
      if (el.tag === "h4") kind = "h2";
      else if (el.tag === "h5") kind = "h3";
      else if (el.tag === "h6") kind = "h4";
      const text = inlineMarkdown(el.children).trim();
      if (text) {
        rawSections.push({
          kind,
          blocks: [{ type: kind, text }],
          label: makeLabel(kind, text),
          images: [],
        });
      }
      i++;
      continue;
    }

    // 6. Blockquote
    if (el.tag === "blockquote") {
      const text = inlineMarkdown(el.children).trim();
      if (text) {
        rawSections.push({
          kind: "quote",
          blocks: [{ type: "quote", text }],
          label: makeLabel("quote", text),
          images: [],
        });
      }
      i++;
      continue;
    }

    // 7. Divider (<hr>)
    if (el.tag === "hr") {
      rawSections.push({
        kind: "divider",
        blocks: [{ type: "divider" }],
        label: "---",
        images: [],
      });
      i++;
      continue;
    }

    // 8. Paragraph (<p>) or other tags
    const iframeInP = findTag(el, "iframe");
    if (iframeInP) {
      const target = embedTarget(iframeInP.attrs);
      if (target) {
        if (isYouTubeUrl(target)) {
          rawSections.push({
            kind: "video",
            blocks: [{ type: "video", url: target }],
            label: makeLabel("video", target),
            images: [],
          });
        } else {
          rawSections.push({
            kind: "p",
            blocks: [{ type: "p", text: `[${target}](${target})` }],
            label: makeLabel("p", target),
            images: [],
          });
        }
      } else {
        dropped.push({ kind: "embed" });
      }
      i++;
      continue;
    }

    const imgInP = findTag(el, "img");
    if (imgInP && textOf(el).trim() === "") {
      const url = (imgInP.attrs && (imgInP.attrs.src || imgInP.attrs.SRC)) || "";
      const caption = (imgInP.attrs && (imgInP.attrs.alt || imgInP.attrs.ALT)) || "";
      if (url) {
        rawSections.push({
          kind: "image",
          blocks: [{ type: "image", url, caption }],
          label: makeLabel("image", caption),
          images: [url],
        });
      }
      i++;
      continue;
    }

    const text = (el.type === "text" ? el.text : inlineMarkdown(el.children || el)).trim();
    if (text) {
      if (text.includes("@[video](")) {
        const parts = text.split(/(@\[video\]\([^\)]+\))/g);
        const pBlocks = [];
        let videoUrl = "";
        for (const part of parts) {
          const m = /^@\[video\]\(([^\)]+)\)$/.exec(part);
          if (m) {
            pBlocks.push({ type: "video", url: m[1] });
            videoUrl = m[1];
          } else {
            const t = part.trim();
            if (t) pBlocks.push({ type: "p", text: t });
          }
        }
        if (pBlocks.length > 0) {
          rawSections.push({
            kind: "video",
            blocks: pBlocks,
            label: makeLabel("video", videoUrl || text),
            images: [],
          });
        }
      } else {
        rawSections.push({
          kind: "p",
          blocks: [{ type: "p", text }],
          label: makeLabel("p", text),
          images: [],
        });
      }
    }
    i++;
  }

  const sections = rawSections.map((s, idx) => {
    const markdown = serializeSection(s.blocks);
    const images = [...(s.images || [])];
    const imgMatches = markdown.matchAll(/!\[[^\]]*\]\((https:\/\/[^\s)]+)\)/g);
    for (const m of imgMatches) {
      if (!images.includes(m[1])) {
        images.push(m[1]);
      }
    }
    return {
      id: `s${idx + 1}`,
      kind: s.kind,
      label: s.label,
      markdown,
      images,
    };
  });

  return opts && opts.dropped ? { sections, dropped } : sections;
}
