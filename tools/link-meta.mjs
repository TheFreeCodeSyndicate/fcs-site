/*
 * tools/link-meta.mjs
 * ------------------------------------------------------------------
 * A web bookmark's title, description and image, read from the page's
 * own Open Graph / Twitter / <title> tags at deploy time, so published
 * posts show Notion-style bookmark cards without calling anyone from
 * the reader's browser. A page that fails just gets the plain card.
 * ------------------------------------------------------------------
 */
const decode = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  .replace(/\s+/g, " ").trim();

/** The content of the first <meta> whose property or name is one of `keys`. */
function metaTag(html, keys) {
  for (const key of keys) {
    for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
      const name = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag);
      const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag);
      if (name && content && name[1].toLowerCase() === key) return decode(content[1]);
    }
  }
  return "";
}

export async function linkMeta(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; fcs-site link previews; +https://thefreecodesyndicate.github.io/fcs-site/)", Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok || !/html/i.test(res.headers.get("content-type") || "")) return null;
    const html = (await res.text()).slice(0, 400000);
    const title = metaTag(html, ["og:title", "twitter:title"]) || decode((/<title[^>]*>([^<]*)<\/title>/i.exec(html) || [])[1] || "");
    const description = metaTag(html, ["og:description", "twitter:description", "description"]);
    let image = metaTag(html, ["og:image", "og:image:url", "twitter:image"]);
    if (image) image = new URL(image, res.url).href;
    if (!/^https:\/\//i.test(image)) image = "";
    return title || description || image ? { title: title.slice(0, 160), description: description.slice(0, 300), image } : null;
  } catch {
    return null;
  }
}

/** { url: details } for every address that answered. */
export async function linkMetaFor(urls) {
  const out = {};
  await Promise.all(urls.map(async (u) => { const m = await linkMeta(u); if (m) out[u] = m; }));
  return out;
}
