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
