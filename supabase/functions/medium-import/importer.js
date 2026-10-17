// supabase/functions/medium-import/importer.js
// --------------------------------------------------------------------
// Pure business logic for the Medium import Edge Function.
// Kept strictly free of Deno and Node APIs so it can be fully tested under
// Node (`npm test`, js/lib/importer.test.js) and run under Deno.
//
// Network and crypto operations are injected via the `deps` object.
// --------------------------------------------------------------------

import {
  parseInput,
  feedURLFor,
  parseFeed,
  htmlToSections,
  fitSections,
  attributionLine,
  mediumImageID,
  resizeURL,
  serializeSection,
} from "./medium.js";

import {
  sniffType,
  refusal,
  assetPath,
  cdnURL,
  MAX_BYTES,
} from "./asset.js";

const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/**
 * Filter sections to requested ids while preserving original story order,
 * then enforce body length budget.
 *
 * @param {Array<object>} sections
 * @param {Array<string>} [ids]
 * @param {{ maxBody?: number }} [opts]
 * @returns {{ kept: Array<object>, dropped: Array<object>, warnings: Array<string> }}
 */
export function selectSections(sections, ids, { maxBody = 200000 } = {}) {
  const idSet = Array.isArray(ids) ? new Set(ids) : null;
  const requested = idSet ? (sections || []).filter((s) => idSet.has(s.id)) : [...(sections || [])];
  const { sections: kept, dropped } = fitSections(requested, { maxBody });
  const warnings = [];
  if (dropped.length > 0) {
    const sWord = dropped.length === 1 ? "section was" : "sections were";
    warnings.push(`The story was longer than a post can hold; the last ${dropped.length} ${sWord} left out.`);
  }
  return { kept, dropped, warnings };
}

/**
 * Rehost Medium CDN images to GitHub asset repo sequentially.
 *
 * @param {Array<object>} sections
 * @param {{
 *   fetchBytes?: (url: string) => Promise<Uint8Array|{ bytes: Uint8Array, type?: string }|null>,
 *   putAsset?: (bytes: Uint8Array, ext: string, path: string) => Promise<{ sha: string, path?: string }>,
 *   limit?: number,
 *   maxBytes?: number,
 *   now?: Date,
 *   newID?: () => string
 * }} deps
 * @returns {Promise<{ sections: Array<object>, copied: number, left: Array<{ url: string, why: string }>, warnings: Array<string> }>} */
export async function rehostImages(sections, deps = {}) {
  const {
    fetchBytes,
    putAsset,
    limit = 40,
    maxBytes = MAX_BYTES,
    now = new Date(),
    newID,
  } = deps;

  const defaultNewID = () =>
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 10);

  let copied = 0;
  const left = [];
  const warnings = [];

  for (const s of sections || []) {
    if (!s.blocks) continue;
    let sectionModified = false;

    for (const b of s.blocks) {
      if (b.type !== "image" || !b.url) continue;

      if (copied >= limit) {
        left.push({ url: b.url, why: `Image rehosting limit of ${limit} reached.` });
        continue;
      }

      if (!fetchBytes || !putAsset) {
        left.push({ url: b.url, why: "Missing upload dependencies." });
        continue;
      }

      try {
        const fetched = await fetchBytes(b.url);
        if (!fetched) {
          left.push({ url: b.url, why: "That image could not be fetched." });
          continue;
        }

        let bytes = fetched instanceof Uint8Array || Array.isArray(fetched) ? fetched : fetched.bytes;
        if (!bytes) {
          left.push({ url: b.url, why: "That image could not be fetched." });
          continue;
        }

        if (bytes.length > maxBytes) {
          const imgId = mediumImageID(b.url);
          if (imgId) {
            try {
              const resizeTarget = resizeURL(imgId, 1400);
              const resizedFetched = await fetchBytes(resizeTarget);
              if (resizedFetched) {
                const resizedBytes = resizedFetched instanceof Uint8Array || Array.isArray(resizedFetched)
                  ? resizedFetched
                  : resizedFetched.bytes;
                if (resizedBytes && resizedBytes.length < bytes.length) {
                  bytes = resizedBytes;
                }
              }
            } catch (_) {
              // Proceed with original bytes
            }
          }
        }

        const reason = refusal(bytes);
        if (reason) {
          left.push({ url: b.url, why: reason });
          continue;
        }

        const mime = sniffType(bytes);
        const ext = EXT[mime] || "png";
        const id = newID ? newID() : defaultNewID();
        const assetFile = assetPath(bytes, now, id);
        const putResult = await putAsset(bytes, ext, assetFile);
        const sha = putResult && putResult.sha ? putResult.sha : "";
        const finalPath = (putResult && putResult.path) || assetFile;
        b.url = cdnURL(sha, finalPath);
        copied++;
        sectionModified = true;
      } catch (err) {
        left.push({ url: b.url, why: err.message || "Failed to fetch or upload image" });
      }
    }

    if (sectionModified) {
      s.markdown = serializeSection(s.blocks);
      s.images = s.blocks.filter((b) => b.type === "image" && b.url).map((b) => b.url);
    }
  }

  if (left.length > 0) {
    const overLimit = left.filter((l) => l.why && l.why.includes("limit")).length;
    if (overLimit > 0) {
      warnings.push(`Only ${limit} images can be imported per post; the remaining ${overLimit} were left hotlinked.`);
    }
    const otherLeft = left.length - overLimit;
    if (otherLeft > 0) {
      warnings.push(`${otherLeft} ${otherLeft === 1 ? "image was" : "images were"} left hotlinked.`);
    }
  }

  return { sections, copied, left, warnings };
}

/**
 * Join sections and optionally append attribution line.
 * Resolves cover to the first image block's address.
 *
 * @param {Array<object>} sections
 * @param {{ attributionUrl?: string|null }} [opts]
 * @returns {{ markdown: string, cover: { url: string }|null }}
 */
export function assembleImport(sections, { attributionUrl } = {}) {
  let cover = null;
  for (const s of sections || []) {
    if (s.blocks) {
      const imgBlock = s.blocks.find((b) => b.type === "image" && b.url);
      if (imgBlock) {
        cover = { url: imgBlock.url };
        break;
      }
    }
    if (!cover && s.images && s.images.length > 0) {
      cover = { url: s.images[0] };
      break;
    }
  }

  const parts = (sections || [])
    .map((s) => s.markdown)
    .filter((md) => typeof md === "string" && md.length > 0);
  let markdown = parts.join("\n\n");

  if (attributionUrl) {
    const attrLine = attributionLine(attributionUrl);
    markdown = markdown ? `${markdown}\n\n${attrLine}` : attrLine;
  }

  return { markdown, cover };
}

/**
 * Helper to extract HTML content from a specific story in feed XML.
 * Returns:
 * - HTML string if story exists and has <content:encoded>
 * - null if story exists but is member-only (no content)
 * - undefined if story is not found in the feed
 */
function extractStoryContent(xml, targetId) {
  const text = String(xml || "");
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let itemMatch;
  const tid = targetId.toLowerCase();

  while ((itemMatch = itemRegex.exec(text)) !== null) {
    const itemXml = itemMatch[1];
    let id = "";
    const guidMatch = itemXml.match(/<guid\b[^>]*>([\s\S]*?)<\/guid>/i);
    if (guidMatch) {
      const hexMatch = guidMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").match(/([0-9a-f]{12})/i);
      if (hexMatch) {
        id = hexMatch[1].toLowerCase();
      }
    }
    if (!id) {
      const linkMatch = itemXml.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i);
      if (linkMatch) {
        const linkStr = linkMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
        const hexMatch = linkStr.match(/-([0-9a-f]{12})(?:[?#]|$)/i);
        if (hexMatch) {
          id = hexMatch[1].toLowerCase();
        }
      }
    }
    if (id === tid) {
      const contentMatch = itemXml.match(/<content:encoded\b[^>]*>([\s\S]*?)<\/content:encoded>/i);
      if (!contentMatch) return null; // Story found, but no content (member-only)
      return contentMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
    }
  }
  return undefined; // Not found in feed
}

/**
 * Helper to fetch feed text with one retry on failure.
 */
async function fetchFeedWithRetry(fetchText, url) {
  if (!fetchText) return null;
  try {
    return await fetchText(url);
  } catch (_) {
    try {
      return await fetchText(url);
    } catch (_) {
      return null;
    }
  }
}

/**
 * Handle function action dispatch for feed, story, and import.
 *
 * @param {{ action: string, input?: string, url?: string, handle?: string, ids?: Array<string>, attribution?: boolean|string }} body
 * @param {{
 *   fetchText: (url: string) => Promise<string>,
 *   fetchBytes?: (url: string) => Promise<Uint8Array|{ bytes: Uint8Array, type?: string }|null>,
 *   putAsset?: (bytes: Uint8Array, ext: string, path: string) => Promise<{ sha: string, path?: string }>,
 *   limit?: number,
 *   maxBytes?: number,
 *   now?: Date,
 *   newID?: () => string
 * }} deps
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function handleAction(body, deps = {}) {
  const action = body && body.action;
  if (!action) {
    return { status: 400, body: { error: "Missing action." } };
  }

  if (action === "feed") {
    const input = body.input;
    if (!input) return { status: 400, body: { error: "Missing input." } };
    const parsed = parseInput(input);
    if (!parsed) {
      return { status: 400, body: { error: "That doesn't look like a Medium address or handle." } };
    }
    const feedUrl = feedURLFor(parsed);
    if (!feedUrl) {
      return { status: 400, body: { error: "No feed could be found for that address." } };
    }
    const xml = await fetchFeedWithRetry(deps.fetchText, feedUrl);
    if (!xml) {
      return { status: 502, body: { error: "Medium didn't answer. Try again in a moment." } };
    }
    const { author, stories } = parseFeed(xml);
    return {
      status: 200,
      body: {
        source: {
          kind: parsed.kind,
          handle: parsed.handle || null,
          host: parsed.host || null,
          publication: parsed.publication || null,
          author,
          url: feedUrl,
        },
        stories,
      },
    };
  }

  if (action === "story") {
    const url = body.url;
    if (!url) return { status: 400, body: { error: "Missing story url." } };
    const parsed = parseInput(url);
    if (!parsed || parsed.kind !== "story" || !parsed.postId) {
      return { status: 400, body: { error: "That doesn't look like a Medium story address." } };
    }
    if (!parsed.handle && !parsed.publication && !parsed.host && body.handle) {
      parsed.handle = String(body.handle).replace(/^@/, "").trim();
    }
    const feedUrl = feedURLFor(parsed);
    if (!feedUrl) {
      return { status: 400, body: { error: "Cannot find feed address for that story. Provide an author handle." } };
    }
    const xml = await fetchFeedWithRetry(deps.fetchText, feedUrl);
    if (!xml) {
      return { status: 502, body: { error: "Medium didn't answer. Try again in a moment." } };
    }
    const { author, stories } = parseFeed(xml);
    const storyHtml = extractStoryContent(xml, parsed.postId);
    if (storyHtml === undefined) {
      const handleOrAuthor = parsed.handle ? `@${parsed.handle}` : (author ? `@${author}` : "this author");
      return {
        status: 404,
        body: {
          error: `That story isn't in the newest ten for ${handleOrAuthor}. Here is what is.`,
          stories,
        },
      };
    }
    if (storyHtml === null) {
      return {
        status: 400,
        body: { error: "Medium publishes only a teaser for member-only stories. Import it from the original document instead." },
      };
    }

    const storyMeta = stories.find((s) => s.id === parsed.postId) || {};
    const { sections, dropped } = htmlToSections(storyHtml, { dropped: true });
    const clientSections = sections.map(({ blocks, ...rest }) => rest);
    const warnings = [];
    if (dropped && dropped.length > 0) {
      const sWord = dropped.length === 1 ? "embed was" : "embeds were";
      warnings.push(`${dropped.length} ${sWord} left out because Medium does not export them.`);
    }

    return {
      status: 200,
      body: {
        source: {
          url: storyMeta.url || url,
          title: storyMeta.title || "",
          author: author || "",
          publication: storyMeta.publication || "",
          publishedAt: storyMeta.publishedAt || "",
          postId: parsed.postId,
        },
        sections: clientSections,
        dropped: dropped || [],
        warnings,
      },
    };
  }

  if (action === "import") {
    const url = body.url;
    if (!url) return { status: 400, body: { error: "Missing story url." } };
    const parsed = parseInput(url);
    if (!parsed || parsed.kind !== "story" || !parsed.postId) {
      return { status: 400, body: { error: "That doesn't look like a Medium story address." } };
    }
    if (!parsed.handle && !parsed.publication && !parsed.host && body.handle) {
      parsed.handle = String(body.handle).replace(/^@/, "").trim();
    }
    const feedUrl = feedURLFor(parsed);
    if (!feedUrl) {
      return { status: 400, body: { error: "Cannot find feed address for that story. Provide an author handle." } };
    }
    const xml = await fetchFeedWithRetry(deps.fetchText, feedUrl);
    if (!xml) {
      return { status: 502, body: { error: "Medium didn't answer. Try again in a moment." } };
    }
    const { author, stories } = parseFeed(xml);
    const storyHtml = extractStoryContent(xml, parsed.postId);
    if (storyHtml === undefined) {
      return { status: 409, body: { error: "That story left the feed while you were choosing. Open it again." } };
    }
    if (storyHtml === null) {
      return {
        status: 400,
        body: { error: "Medium publishes only a teaser for member-only stories. Import it from the original document instead." },
      };
    }

    const storyMeta = stories.find((s) => s.id === parsed.postId) || {};
    const { sections, dropped } = htmlToSections(storyHtml, { blocks: true, dropped: true });
    const { kept, warnings: selectWarnings } = selectSections(sections, body.ids, { maxBody: 200000 });
    const { sections: rehosted, copied, left, warnings: rehostWarnings } = await rehostImages(kept, deps);

    let recoveredEmbeds = 0;
    for (const s of kept) {
      if (s.blocks) {
        for (const b of s.blocks) {
          if (b.type === "video" || b.type === "bookmark") {
            recoveredEmbeds++;
          }
        }
      }
    }
    const embedWarnings = [];
    if (recoveredEmbeds > 0) {
      const sWord = recoveredEmbeds === 1 ? "embed" : "embeds";
      embedWarnings.push(`${recoveredEmbeds} ${sWord} came through as a link rather than the original player.`);
    }

    let attributionUrl = null;
    if (body.attribution === true) {
      attributionUrl = storyMeta.url || url;
    } else if (typeof body.attribution === "string") {
      const trimmed = body.attribution.trim();
      try {
        const u = new URL(trimmed);
        if (u.protocol === "https:") {
          attributionUrl = trimmed;
        }
      } catch (_) {
        // Stray string or invalid URL: omit attribution
      }
    }

    const { markdown, cover } = assembleImport(rehosted, { attributionUrl });

    const allWarnings = [
      ...selectWarnings,
      ...rehostWarnings,
      ...embedWarnings,
    ];
    if (dropped && dropped.length > 0) {
      const sWord = dropped.length === 1 ? "embed was" : "embeds were";
      allWarnings.push(`${dropped.length} ${sWord} left out because Medium does not export them.`);
    }

    return {
      status: 200,
      body: {
        markdown,
        cover,
        images: {
          copied,
          left,
        },
        warnings: allWarnings,
      },
    };
  }

  return { status: 400, body: { error: `Unknown action: ${action}` } };
}
