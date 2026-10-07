/*
 * js/lib/blog-pages.js
 * ------------------------------------------------------------------
 * The blog's static pages, as strings. tools/blog-build.mjs writes them
 * to blog/index.html and blog/<slug>/index.html during the deploy, so
 * every post is real HTML with its own title and preview image: link
 * previews and search engines see it without running any script.
 *
 * The layout follows the admin's editor (a Notion-style page): a
 * full-width cover, the icon overlapping it, a large title, the body.
 * ------------------------------------------------------------------
 */
import { escapeHTML as esc, renderMarkdown, plainSummary, readingTime, emojiHTML } from "./markdown.js";

export const SITE = "https://thefreecodesyndicate.github.io/fcs-site/";

// Images from any https site (posts may link one; images cannot run
// code); KaTeX fonts from our own site; YouTube only through its
// no-cookie player. Scripts only from this site.
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; frame-src https://www.youtube-nocookie.com; connect-src 'self' https://*.supabase.co; object-src 'none'; base-uri 'self'; form-action 'self'";

const dateText = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const describe = (post) => post.excerpt || plainSummary(post.body);

/* ---- authors ------------------------------------------------------------
 * A post's authors: [{ id?, name, avatar?, url? }] (migration 027). Posts
 * from before keep their single author_name. */
export function postAuthors(post) {
  const list = Array.isArray(post.authors) ? post.authors.filter((a) => a && String(a.name || "").trim()) : [];
  return list.length ? list : post.author_name ? [{ name: post.author_name }] : [];
}

/** "Ada", "Ada and Grace", "Ada, Grace and Linus". */
export function authorNames(authors) {
  const names = authors.map((a) => String(a.name).trim());
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const AVATAR_COLORS = ["#c78b1d", "#d9730d", "#448361", "#337ea9", "#9065b0", "#c14c8a", "#d44c47", "#9f6b53"];

/** A round avatar: the person's photo, or their initials on a colour picked from their name. */
export function avatarHTML(author, cls = "avatar") {
  const name = String(author.name || "?").trim();
  if (/^https:\/\/\S+$/i.test(author.avatar || "")) return `<img class="${cls}" src="${esc(author.avatar)}" alt="" loading="lazy" />`;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => [...w][0]).join("").toUpperCase() || "?";
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.codePointAt(0)) >>> 0;
  return `<span class="${cls} avatar-initials" style="background: ${AVATAR_COLORS[hash % AVATAR_COLORS.length]}" aria-hidden="true">${esc(initials)}</span>`;
}

/** Overlapping avatars, the first few, with "+n" for the rest. */
export function avatarGroupHTML(authors, max = 4) {
  const shown = authors.slice(0, max).map((a) => avatarHTML(a)).join("");
  const more = authors.length > max ? `<span class="avatar avatar-more">+${authors.length - max}</span>` : "";
  return `<span class="avatar-group">${shown}${more}</span>`;
}

/** The byline: avatars, then names, linked where the author has a page. */
function bylineHTML(authors) {
  if (!authors.length) return "";
  const linked = authors.map((a) => (/^https:\/\/\S+$/i.test(a.url || "") ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name)}</a>` : esc(a.name)));
  const names = linked.length < 2 ? linked.join("") : `${linked.slice(0, -1).join(", ")} and ${linked[linked.length - 1]}`;
  return `${avatarGroupHTML(authors)}<span class="post-authors">${names}</span>`;
}

/* Icon colours, as in Notion. "default" follows the text colour. */
export const ICON_COLORS = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];

/** A post's icon: an emoji (drawn with Twemoji), a pixel icon
 * ("icon:name" or "icon:name:colour", from assets/pixel-icons.svg) or an
 * uploaded image (https://). */
export function iconHTML(icon, root = "") {
  if (!icon) return "";
  const named = /^icon:([a-z0-9-]+)(?::([a-z]+))?$/.exec(icon);
  if (named) {
    const color = ICON_COLORS.includes(named[2]) && named[2] !== "default" ? ` icon-${named[2]}` : "";
    return `<svg class="page-icon-svg${color}" aria-hidden="true" focusable="false"><use href="${root}assets/pixel-icons.svg#p-${named[1]}"></use></svg>`;
  }
  if (/^https:\/\//i.test(icon)) return `<img class="page-icon-img" src="${esc(icon)}" alt="" />`;
  return emojiHTML(icon, "page-icon-emoji");
}

/* View transitions: a card's cover, icon, title, summary, authors and date
 * carry the same names as the post page's, so the browser moves each into
 * place when a card opens its post (and back). Names are per post, so
 * every name is unique on a page. */
const vtName = (post, part) => `vt-${part}-${String(post.slug || "").replace(/[^a-z0-9-]/gi, "-")}`;
// Images morph (vt-media); text travels without scaling (vt-text). See style.css.
const VT_CLASS = { cover: "vt-media", icon: "vt-media", authors: "vt-media", title: "vt-text", summary: "vt-text", date: "vt-text" };
const vt = (post, part) => (post.slug ? ` style="view-transition-name: ${vtName(post, part)}; view-transition-class: ${VT_CLASS[part]}"` : "");

/** Unsplash's mark (from their brand page), for the cover picker's tab and credits. */
export const UNSPLASH_LOGO = '<svg class="unsplash-logo" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7.5 6.75V0h9v6.75h-9zm9 3.75H24V24H0V10.5h7.5v6.75h9V10.5z"/></svg>';
export const UNSPLASH_UTM = "utm_source=the_free_code_syndicate&utm_medium=referral";

/** "Photo by <name> on Unsplash", both linked, as Unsplash's API terms ask. */
export function coverCreditHTML(credit) {
  if (!credit || !credit.name || !/^https:\/\/unsplash\.com\/\S+$/i.test(credit.url || "")) return "";
  return `<p class="cover-credit">Photo by <a href="${esc(credit.url)}" target="_blank" rel="noopener">${esc(credit.name)}</a> on <a href="https://unsplash.com/?${esc(UNSPLASH_UTM)}" target="_blank" rel="noopener">Unsplash</a></p>`;
}

/** The site's own images (the cover gallery's colours and textures) are stored
 * as full addresses, as covers must be; pages load them from their own copy. */
export const assetSrc = (url, root = "") => (url && url.startsWith(SITE) ? root + url.slice(SITE.length) : url);

const coverStyle = (post) => `object-position: 50% ${Number.isFinite(post.cover_position) ? post.cover_position : 50}%`;

/* ---- link previews (Open Graph) ------------------------------------------------
 * Every page's preview card is drawn at build time (tools/og.mjs) and
 * stamped with ?v=<when it last changed>, so WhatsApp, Discord and X fetch
 * the new card after an edit instead of showing their cached one. */
const stamp = (iso) => (iso ? Date.parse(iso).toString(36) : "1");
export const ogImageURL = (path, changedAt) => `${SITE}${path}?v=${stamp(changedAt)}`;

/** The image tags every platform reads: size and type up front, so the first share already shows the large card. */
export function ogImageTags(image, alt) {
  return [
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta property="og:image:secure_url" content="${esc(image)}" />`,
    '<meta property="og:image:type" content="image/jpeg" />',
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    `<meta property="og:image:alt" content="${esc(alt)}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:image" content="${esc(image)}" />`,
    `<meta name="twitter:image:alt" content="${esc(alt)}" />`,
  ].join("\n  ");
}

const articleTags = ({ published, modified, authors }) => [
  published && `<meta property="article:published_time" content="${esc(published)}" />`,
  modified && `<meta property="article:modified_time" content="${esc(modified)}" />`,
  ...authors.map((a) => `<meta property="article:author" content="${esc(a.name)}" />`),
].filter(Boolean).join("\n  ");

/** `root` is the path back to the site's top: "../" or "../../". */
function shell({ root, title, description, url, image, imageAlt = "", body, type = "website", math = false, article = null, social = [], scripts = "" }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${CSP}" />
  <script src="${root}js/theme-init.js"></script>
  <script src="${root}js/page-transitions.js"></script>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${esc(url)}" />
  <meta property="og:type" content="${type}" />
  <meta property="og:site_name" content="The Free Code Syndicate" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${esc(url)}" />
  ${image ? ogImageTags(image, imageAlt || title) : ""}
  ${article ? articleTags(article) : ""}
  <link rel="icon" type="image/svg+xml" href="${root}assets/logoicon.svg" />
  <link rel="icon" type="image/png" sizes="32x32" href="${root}assets/favicon-32.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,700..800&family=Archivo+Mono&family=Fira+Code:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="${root}css/style.css" />
  ${math ? `<link rel="stylesheet" href="${root}js/vendor/katex/katex.min.css" />` : ""}
</head>
<body class="blog-page">
  <header class="blog-nav">
    <a class="blog-brand" href="${root}"><img src="${root}assets/logoicon.svg" alt="" width="24" height="22" />TFCS</a>
    <a href="${root}blog/">Blog</a>
  </header>
${body}
${blogFooterHTML(root, social)}
  <script src="${root}js/config.js"></script>
  <script src="${root}js/track.js" defer></script>
  <script type="module" src="${root}js/link-preview.js"></script>
  <script type="module" src="${root}js/footer-sky.js"></script>${scripts}
</body>
</html>
`;
}

/** The page body shared by the public post and the editor's preview. */
/** `bodyHTML`: the body already rendered (the editor's version history marks changes in it). */
export function postArticleHTML(post, root = "", bodyHTML = "") {
  const { minutes } = readingTime(post.body);
  const authors = postAuthors(post);
  const meta = [post.published_at && dateText(post.published_at), `${minutes} min read`].filter(Boolean).join(" · ");
  const style = [
    post.cover_url && "has-cover", post.icon && "has-icon",
    ["mono", "technical", "garet"].includes(post.font) && `font-${post.font}`,
    post.small_text && "is-small", post.full_width && "is-wide",
  ].filter(Boolean).map((c) => ` ${c}`).join("");
  return `<article class="post${style}">
    ${post.cover_url ? `<div class="post-cover"${vt(post, "cover")}><img src="${esc(assetSrc(post.cover_url, root))}" alt="" style="${coverStyle(post)}" />${coverCreditHTML(post.cover_credit)}</div>` : ""}
    <div class="post-page">
      ${post.icon ? `<div class="page-icon"${vt(post, "icon")}>${iconHTML(post.icon, root)}</div>` : ""}
      <h1 class="post-title"${vt(post, "title")}>${esc(post.title)}</h1>
      ${post.excerpt ? `<p class="post-dek"${vt(post, "summary")}>${esc(post.excerpt)}</p>` : ""}
      <div class="post-byline"><span class="post-byline-people"${vt(post, "authors")}>${bylineHTML(authors)}</span><span class="post-meta"${vt(post, "date")}>${esc(meta)}</span></div>
      <div class="prose">${bodyHTML || renderMarkdown(post.body, { links: post.link_meta })}</div>
    </div>
  </article>`;
}

/**
 * A post's page. `others`: the other published posts, newest first (the
 * three newest become "More from the blog"); `social`: the club's links,
 * for the footer.
 */
export function postPage(post, { others = [], social = [] } = {}) {
  const root = "../../";
  const html = postArticleHTML(post, root);
  const more = others.filter((o) => o.slug !== post.slug).slice(0, 3);
  return shell({
    social,
    scripts: `\n  <script type="module" src="${root}js/post-rail.js"></script>`,
    root: "../../",
    title: `${post.title} | The Free Code Syndicate`,
    description: describe(post),
    url: `${SITE}blog/${post.slug}/`,
    image: ogImageURL(`blog/${post.slug}/og.jpg`, post.updated_at || post.published_at),
    imageAlt: `${post.title}, on The Free Code Syndicate's blog`,
    article: { published: post.published_at, modified: post.updated_at, authors: postAuthors(post) },
    type: "article",
    math: html.includes('class="math'),
    body: `  <main>${html}</main>
${railHTML(post, root)}
${more.length ? morePostsHTML(more, root) : ""}`,
  });
}

/* ---- the reading rail (js/post-rail.js) -------------------------------------
 * On wide screens, once the title scrolls away: the post's icon, title and
 * authors, then its contents as a tree with the current section lit, a
 * reading-progress bar and share links, as on claude.dev's blog. The tree
 * is built in the browser from the headings, so it always matches them. */
export function railHTML(post, root) {
  const authors = postAuthors(post);
  const url = `${SITE}blog/${post.slug}/`;
  // Plain text in a non-running script tag (& and < escaped): "Copy markdown" reads it.
  const markdown = `# ${post.title}\n\n${post.body || ""}`;
  const share = (key, label, href) => `<li><a ${href ? `href="${esc(href)}" target="_blank" rel="noopener"` : 'href="#" role="button"'} data-share="${key}">${label}</a></li>`;
  return `  <aside class="post-rail" data-rail aria-label="Reading aid" data-url="${esc(url)}">
    <div class="rail-head">
      ${post.icon ? `<span class="rail-icon" style="--i: 0">${iconHTML(post.icon, root)}</span>` : ""}
      <p class="rail-title" style="--i: 1">${esc(post.title)}</p>
      ${authors.length ? `<p class="rail-byline" style="--i: 2">${avatarGroupHTML(authors, 3)}<span>${esc(authorNames(authors))}</span></p>` : ""}
    </div>
    <div class="rail-section" style="--i: 3" data-rail-tree-wrap hidden>
      <p class="rail-label">Contents</p>
      <ol class="rail-tree" data-rail-tree></ol>
    </div>
    <div class="rail-progress" style="--i: 4" aria-hidden="true"><span class="rail-bar"><span data-rail-fill></span></span><span class="rail-pct" data-rail-pct>00%</span></div>
    <p class="rail-hint" style="--i: 5">Press ↑ / ↓ to scroll</p>
    <div class="rail-section rail-share" style="--i: 6">
      <p class="rail-label">Share</p>
      <ul>
        ${share("x", "X.com", `https://x.com/intent/post?url=${encodeURIComponent(url)}&text=${encodeURIComponent(post.title)}`)}
        ${share("linkedin", "LinkedIn", `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`)}
        ${share("email", "Email", `mailto:?subject=${encodeURIComponent(post.title)}&body=${encodeURIComponent(`${describe(post)}\n\n${url}`)}`)}
        ${share("copy-url", "Copy URL")}
        ${share("copy-markdown", "Copy markdown")}
      </ul>
      <p class="rail-status" role="status" aria-live="polite" data-rail-status></p>
    </div>
  </aside>
  <script type="text/plain" id="post-markdown">${markdown.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</script>`;
}

/** "More from the blog": up to three other posts, as cards. */
function morePostsHTML(posts, root) {
  return `  <section class="more-posts" aria-labelledby="more-posts-title">
    <div class="more-posts-inner">
      <div class="sec-head-row">
        <h2 class="more-posts-title" id="more-posts-title"><span class="blog-eyebrow">Keep reading</span>More from the blog</h2>
        <a class="sec-more" href="../">All posts &rarr;</a>
      </div>
      <ul class="post-grid">
${posts.map((p) => `        <li>${postCardHTML(p, { root, href: `../${p.slug}/` })}</li>`).join("\n")}
      </ul>
    </div>
  </section>`;
}

/* ---- the blog's footer --------------------------------------------------------
 * As on the home page: the slab, and under it the dotted Icarus sky with the
 * club's bird (js/footer-sky.js). Above the sky, in columns as on claude.dev:
 * the club, where to read, where to find us, and the credits. */
const CREDITS = [
  ["Emoji", "Twemoji", "https://github.com/jdecked/twemoji", "CC BY 4.0"],
  ["Icons", "pixelarticons", "https://pixelarticons.com", "MIT"],
  ["Type", "Archivo, Fira Code, Latin Modern Mono", "https://fonts.google.com/specimen/Archivo", "OFL / GUST"],
  ["Images", "Unsplash, NASA, ESA/Webb, The Met", "", "credited on each post"],
];
export function blogFooterHTML(root, social = []) {
  const links = social.filter((l) => /^https:\/\//.test(l.url || "")).slice(0, 6);
  const connect = links.length ? links : [{ label: "GitHub", url: "https://github.com/TheFreeCodeSyndicate" }];
  return `  <footer class="blog-footer">
    <div class="blog-footer-grid">
      <div class="bf-brand">
        <a class="bf-logo" href="${root}"><img src="${root}assets/logoicon.svg" alt="" width="28" height="26" /><span>The Free Code Syndicate</span></a>
        <p class="bf-tag">A public group for free code, study, and careful work.</p>
        <p class="bf-legal">&copy; ${new Date().getUTCFullYear()} The Free Code Syndicate<br /><a href="${root}privacy.html">Privacy</a><a href="https://github.com/TheFreeCodeSyndicate/fcs-site" target="_blank" rel="noopener">Source</a></p>
      </div>
      <nav class="bf-col" aria-label="Read">
        <p class="bf-head">Read</p>
        <a href="${root}blog/">All posts</a>
        <a href="${root}">Home</a>
        <a href="${root}#events">Events</a>
        <a href="${root}#study-groups">Study groups</a>
      </nav>
      <nav class="bf-col" aria-label="Connect">
        <p class="bf-head">Connect</p>
${connect.map((l) => `        <a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label || l.platform || "Link")}</a>`).join("\n")}
      </nav>
      <div class="bf-col bf-credits">
        <p class="bf-head">Credits</p>
${CREDITS.map(([what, who, href, licence]) => `        <p><span>${what}</span>${href ? `<a href="${href}" target="_blank" rel="noopener">${who}</a>` : who}<small>${licence}</small></p>`).join("\n")}
      </div>
    </div>
    <canvas class="footer-sky" id="footer-sky" aria-hidden="true"></canvas>
  </footer>`;
}

/* ---- cards ------------------------------------------------------------------
 * One card for every list of posts: the blog index, the home page and the
 * admin's gallery. A cover (or, without one, a tint picked from the post's
 * address with the icon large in it), the icon overlapping the cover as in
 * Notion, a two-line title and summary, then authors and date. */
const TINTS = ["yellow", "orange", "green", "blue", "purple", "pink", "red", "brown"];
const tintOf = (key) => {
  let hash = 0;
  for (const c of String(key || "")) hash = (hash * 31 + c.codePointAt(0)) >>> 0;
  return TINTS[hash % TINTS.length];
};

/** "Ada", or "Ada +2". */
const leadAuthor = (authors) => esc(authors[0].name) + (authors.length > 1 ? ` <span class="post-card-more">+${authors.length - 1}</span>` : "");

/**
 * href: where the title links (the whole card is clickable through it); empty
 * for a card the caller handles (the admin's gallery). compact: icon, title and
 * date only. eager: the page's first cover, which should not wait. badge: HTML
 * laid over the cover.
 */
export function postCardHTML(post, { root = "", href = "", compact = false, eager = false, badge = "" } = {}) {
  const authors = postAuthors(post);
  const title = esc(post.title || "Untitled");
  const heading = href ? `<a class="post-card-link" href="${esc(href)}">${title}</a>` : title;
  const time = post.published_at ? `<time datetime="${esc(post.published_at)}">${esc(dateText(post.published_at))}</time>` : "";
  const meta = [time, `${readingTime(post.body).minutes} min read`].filter(Boolean).join(" · ");
  const icon = post.icon ? `<span class="post-card-icon"${vt(post, "icon")}>${iconHTML(post.icon, root)}</span>` : "";
  if (compact) {
    return `<article class="post-card is-compact">
      ${icon}
      <div class="post-card-body">
        <h3 class="post-card-title"${vt(post, "title")}>${heading}</h3>
        <p class="post-card-meta"${vt(post, "date")}>${meta}</p>
      </div>
    </article>`;
  }
  const cover = post.cover_url
    ? `<div class="post-card-cover"${vt(post, "cover")}><img src="${esc(assetSrc(post.cover_url, root))}" alt="" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" style="${coverStyle(post)}" /></div>`
    : `<div class="post-card-cover is-blank" style="background-color: var(--bg-${tintOf(post.slug || post.title)})">${post.icon ? `<span class="post-card-glyph"${vt(post, "icon")}>${iconHTML(post.icon, root)}</span>` : ""}</div>`;
  const overlap = Boolean(post.cover_url && post.icon);
  return `<article class="post-card${overlap ? " has-icon" : ""}">
      ${cover}${badge}
      ${overlap ? icon : ""}
      <div class="post-card-body">
        <h3 class="post-card-title"${vt(post, "title")}>${heading}</h3>
        <p class="post-card-text"${post.excerpt ? vt(post, "summary") : ""}>${esc(describe(post))}</p>
        <div class="post-card-foot">
          <span class="post-card-authors"${vt(post, "authors")}>${authors.length ? `${avatarGroupHTML(authors, 3)}<span>${leadAuthor(authors)}</span>` : ""}</span>
          <span class="post-card-meta"${vt(post, "date")}>${time}</span>
        </div>
      </div>
    </article>`;
}

/** The blog index: the three newest as full cards, the rest compact. */
export function indexPage(posts, { social = [] } = {}) {
  const card = (p, opts) => `      <li>${postCardHTML(p, { root: "../", href: `${p.slug}/`, ...opts })}</li>`;
  const featured = posts.slice(0, 3).map((p, i) => card(p, { eager: i === 0 })).join("\n");
  const more = posts.slice(3).map((p) => card(p, { compact: true })).join("\n");
  return shell({
    root: "../",
    title: "Blog | The Free Code Syndicate",
    description: "Notes, write-ups and updates from The Free Code Syndicate.",
    url: `${SITE}blog/`,
    image: ogImageURL("blog/og/blog.jpg", posts[0] && (posts[0].updated_at || posts[0].published_at)),
    imageAlt: "The Free Code Syndicate's blog: notes, write-ups and updates",
    body: `  <main class="blog-index">
    <header class="blog-hero">
      <p class="blog-eyebrow">Blog &amp; notes</p>
      <h1 class="blog-headline">Notes, write&#8209;ups and updates <span>from the Syndicate</span></h1>
    </header>
    ${posts.length ? `<ul class="post-grid">
${featured}
    </ul>
    ${more ? `<h2 class="blog-section-label">More posts</h2>
    <ul class="post-grid is-compact">
${more}
    </ul>` : ""}` : `<div class="blog-empty">
      <img src="../assets/logoicon.svg" alt="" width="48" height="44" />
      <p>No posts yet. The first one is being written.</p>
      <a href="../">Back to the site</a>
    </div>`}
  </main>`,
  });
}

/** blog/latest.html: the home page's "From the blog" cards (main.js fetches it). */
export function latestFragment(posts) {
  return posts.slice(0, 3).map((p) => `<li>${postCardHTML(p, { href: `blog/${p.slug}/` })}</li>`).join("\n");
}

/** sitemap.xml: the home page, the blog index and every post. */
export function sitemap(posts) {
  const urls = [SITE, `${SITE}blog/`, ...posts.map((p) => `${SITE}blog/${p.slug}/`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${esc(u)}</loc></url>`)
    .join("\n")}\n</urlset>\n`;
}
