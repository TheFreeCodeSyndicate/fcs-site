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
