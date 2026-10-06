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

const coverStyle = (post) => `object-position: 50% ${Number.isFinite(post.cover_position) ? post.cover_position : 50}%`;

/** `root` is the path back to the site's top: "../" or "../../". */
function shell({ root, title, description, url, image, body, type = "website", math = false }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${CSP}" />
  <script src="${root}js/theme-init.js"></script>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${esc(url)}" />
  <meta property="og:type" content="${type}" />
  <meta property="og:site_name" content="The Free Code Syndicate" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${esc(url)}" />
  ${image ? `<meta property="og:image" content="${esc(image)}" />\n  <meta name="twitter:card" content="summary_large_image" />` : ""}
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
  <footer class="blog-foot">
    <p><a href="${root}blog/">All posts</a> &middot; <a href="${root}">The Free Code Syndicate</a></p>
    <p class="blog-credit">Emoji by <a href="https://github.com/jdecked/twemoji" rel="noopener">Twemoji</a> (CC-BY 4.0); icons by <a href="https://pixelarticons.com" rel="noopener">pixelarticons</a>.</p>
  </footer>
  <script src="${root}js/config.js"></script>
  <script src="${root}js/track.js" defer></script>
</body>
</html>
`;
}

/** The page body shared by the public post and the editor's preview. */
export function postArticleHTML(post, root = "") {
  const { minutes } = readingTime(post.body);
  const meta = [post.author_name, post.published_at && dateText(post.published_at), `${minutes} min read`].filter(Boolean).join(" · ");
  return `<article class="post${post.cover_url ? " has-cover" : ""}${post.icon ? " has-icon" : ""}">
    ${post.cover_url ? `<div class="post-cover"><img src="${esc(post.cover_url)}" alt="" style="${coverStyle(post)}" /></div>` : ""}
    <div class="post-page">
      ${post.icon ? `<div class="page-icon">${iconHTML(post.icon, root)}</div>` : ""}
      <h1 class="post-title">${esc(post.title)}</h1>
      <p class="post-meta">${esc(meta)}</p>
      <div class="prose">${renderMarkdown(post.body)}</div>
    </div>
  </article>`;
}

export function postPage(post) {
  const html = postArticleHTML(post, "../../");
  return shell({
    root: "../../",
    title: `${post.title} | The Free Code Syndicate`,
    description: describe(post),
    url: `${SITE}blog/${post.slug}/`,
    image: post.cover_url,
    type: "article",
    math: html.includes('class="math'),
    body: `  <main>${html}</main>`,
  });
}

export function indexPage(posts) {
  const cards = posts.map((p) => `      <li>
        <a class="post-card" href="${esc(p.slug)}/">
          <span class="post-card-cover">${p.cover_url ? `<img src="${esc(p.cover_url)}" alt="" loading="lazy" style="${coverStyle(p)}" />` : ""}</span>
          <span class="post-card-body">
            ${p.icon ? `<span class="page-icon page-icon-sm">${iconHTML(p.icon, "../")}</span>` : ""}
            <strong>${esc(p.title)}</strong>
            <span class="post-card-text">${esc(describe(p))}</span>
            <span class="post-meta">${esc([p.author_name, dateText(p.published_at), `${readingTime(p.body).minutes} min read`].filter(Boolean).join(" · "))}</span>
          </span>
        </a>
      </li>`).join("\n");
  return shell({
    root: "../",
    title: "Blog | The Free Code Syndicate",
    description: "Notes, write-ups and updates from The Free Code Syndicate.",
    url: `${SITE}blog/`,
    body: `  <main class="blog-index">
    <h1 class="post-title">Blog</h1>
    <p class="post-meta">Notes, write-ups and updates from The Free Code Syndicate.</p>
    ${posts.length ? `<ul class="post-grid">\n${cards}\n    </ul>` : "<p>No posts yet. Check back soon.</p>"}
  </main>`,
  });
}

/** sitemap.xml: the home page, the blog index and every post. */
export function sitemap(posts) {
  const urls = [SITE, `${SITE}blog/`, ...posts.map((p) => `${SITE}blog/${p.slug}/`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `  <url><loc>${esc(u)}</loc></url>`)
    .join("\n")}\n</urlset>\n`;
}
