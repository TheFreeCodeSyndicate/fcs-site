import test from "node:test";
import assert from "node:assert/strict";
import { postPage, indexPage, sitemap, authorNames, avatarHTML, avatarGroupHTML, postAuthors, postCardHTML, latestFragment } from "./blog-pages.js";

const post = {
  slug: "hello-world",
  title: 'Hello <b>"world"</b>',
  excerpt: null,
  body: "First *post*.\n\n![pic](https://cdn.jsdelivr.net/gh/x/y@abc/a.webp)",
  cover_url: "https://cdn.jsdelivr.net/gh/x/y@abc/cover.webp",
  author_name: "Ada",
  published_at: "2026-10-06T10:00:00Z",
};

test("a post page escapes the title and carries its own preview tags", () => {
  const html = postPage(post);
  assert.ok(!html.includes("<b>"));
  assert.match(html, /<h1 class="post-title" style="view-transition-name: vt-title-hello-world; view-transition-class: vt-text">Hello &lt;b&gt;&quot;world&quot;&lt;\/b&gt;<\/h1>/);
  // The preview is the drawn card (tools/og.mjs), stamped with when the post last changed.
  assert.match(html, /<meta property="og:image" content="https:\/\/thefreecodesyndicate\.github\.io\/fcs-site\/blog\/hello-world\/og\.jpg\?v=[a-z0-9]+" \/>/);
  for (const tag of ['og:image:width" content="1200"', 'og:image:height" content="630"', 'og:image:type" content="image/jpeg"', 'twitter:card" content="summary_large_image"', 'article:author" content="Ada"', 'article:published_time']) {
    assert.ok(html.includes(tag), tag);
  }
  assert.notEqual(postPage({ ...post, updated_at: "2026-10-07T10:00:00Z" }).match(/og\.jpg\?v=([a-z0-9]+)/)[1], html.match(/og\.jpg\?v=([a-z0-9]+)/)[1], "an edit changes the stamp");
  assert.match(html, /rel="canonical" href="https:\/\/thefreecodesyndicate\.github\.io\/fcs-site\/blog\/hello-world\/"/);
  assert.match(html, /<span class="post-authors">Ada<\/span><\/span><span class="post-meta" style="view-transition-name: vt-date-hello-world; view-transition-class: vt-text">6 October 2026 · 1 min read<\/span>/);
  assert.match(html, /<em>post<\/em>/);
  assert.match(html, /href="\.\.\/\.\.\/css\/style\.css"/);
});

test("icons, cover position and math styles", () => {
  const html = postPage({ ...post, icon: "icon:github", cover_position: 20, body: "$x$" });
  assert.match(html, /<use href="\.\.\/\.\.\/assets\/pixel-icons\.svg#p-github">/);
  assert.match(postPage({ ...post, icon: "icon:heart:red" }), /class="page-icon-svg icon-red"/);
  assert.ok(!postPage({ ...post, icon: "icon:heart:evil" }).includes("icon-evil"));
  assert.match(html, /object-position: 50% 20%/);
  assert.match(html, /katex\.min\.css/);
  assert.ok(!postPage(post).includes("katex.min.css"));
  assert.match(postPage({ ...post, icon: "🚀" }), /<img class="page-icon-emoji" src="https:\/\/cdn\.jsdelivr\.net\/gh\/jdecked\/twemoji@[\d.]+\/assets\/svg\/1f680\.svg" alt="🚀"/);
  assert.ok(!postPage({ ...post, icon: '"><script>' }).includes("<script>"));
});

test("page styles: fonts, small text and full width; unknown fonts are ignored", () => {
  assert.match(postPage({ ...post, font: "garet", small_text: true, full_width: true }), /<article class="post has-cover font-garet is-small is-wide">/);
  assert.match(postPage({ ...post, font: "evil" }), /<article class="post has-cover">/);
});

test("authors: avatars or initials, joined names, links only when https, everything escaped", () => {
  const authors = [
    { name: "Ada Lovelace", avatar: "https://github.com/ada.png", url: "https://github.com/ada" },
    { name: "Grace Hopper" },
    { name: '<b>Linus</b>', avatar: "javascript:alert(1)", url: "http://x.example" },
  ];
  assert.equal(authorNames(authors), "Ada Lovelace, Grace Hopper and <b>Linus</b>");
  assert.equal(authorNames(authors.slice(0, 2)), "Ada Lovelace and Grace Hopper");
  assert.match(avatarHTML(authors[0]), /<img class="avatar" src="https:\/\/github\.com\/ada\.png"/);
  assert.match(avatarHTML(authors[1]), /avatar-initials" style="background: #[0-9a-f]{6}" aria-hidden="true">GH</);
  const html = postPage({ ...post, authors });
  assert.match(html, /<a href="https:\/\/github\.com\/ada" target="_blank" rel="noopener">Ada Lovelace<\/a>, Grace Hopper and &lt;b&gt;Linus&lt;\/b&gt;/);
  assert.ok(!html.includes("javascript:"));
  assert.ok(!html.includes('href="http://x.example"'));
  assert.deepEqual(postAuthors({ authors: [], author_name: "Old" }), [{ name: "Old" }]);
  assert.match(avatarGroupHTML(Array.from({ length: 6 }, (_, i) => ({ name: `P${i}` })), 4), /avatar-more">\+2</);
});

test("the index lists posts, or says there are none", () => {
  assert.match(indexPage([post]), /href="hello-world\/"/);
  assert.match(indexPage([]), /No posts yet/);
});

test("the sitemap names the home page, the blog and each post", () => {
  const xml = sitemap([post]);
  assert.match(xml, /<loc>https:\/\/thefreecodesyndicate\.github\.io\/fcs-site\/<\/loc>/);
  assert.match(xml, /fcs-site\/blog\/hello-world\//);
});

test("post cards: cover with the icon over it, a tint without one, compact for older posts", () => {
  const withIcon = postCardHTML({ ...post, icon: "🚀", authors: [{ name: "Ada" }, { name: "Grace" }] }, { href: "hello-world/" });
  assert.match(withIcon, /class="post-card has-icon"/);
  assert.match(withIcon, /<a class="post-card-link" href="hello-world\/">Hello &lt;b&gt;&quot;world&quot;&lt;\/b&gt;<\/a>/);
  assert.match(withIcon, /Ada <span class="post-card-more">\+1<\/span>/);
  assert.match(withIcon, /<time datetime="2026-10-06T10:00:00Z">6 October 2026<\/time><\/span>/);
  const bare = postCardHTML({ ...post, cover_url: "", icon: "icon:code" });
  assert.match(bare, /class="post-card-cover is-blank" style="background-color: var\(--bg-[a-z]+\)"><span class="post-card-glyph" style="view-transition-name: vt-icon-hello-world; view-transition-class: vt-media"><svg/);
  // The card and the post page share names, so the browser can move each part across.
  for (const part of ["cover", "icon", "title", "authors", "date"]) {
    assert.ok(withIcon.includes(`view-transition-name: vt-${part}-hello-world`), part);
    assert.ok(postPage({ ...post, icon: "🚀" }).includes(`view-transition-name: vt-${part}-hello-world`), part);
  }
  assert.ok(!bare.includes("<a "), "no href, no link");
  const compact = postCardHTML(post, { compact: true, href: "x/" });
  assert.match(compact, /class="post-card is-compact"/);
  assert.ok(!compact.includes("post-card-cover"));
  const posts = [1, 2, 3, 4, 5].map((n) => ({ ...post, slug: `p${n}` }));
  assert.equal((indexPage(posts).match(/class="post-card is-compact"/g) || []).length, 2);
  assert.equal((latestFragment(posts).match(/<li>/g) || []).length, 3);
  assert.match(latestFragment(posts), /href="blog\/p1\/"/);
});

test("an Unsplash cover credits its photographer and Unsplash, both linked", () => {
  const html = postPage({ ...post, cover_credit: { name: "Annie <Spratt>", url: "https://unsplash.com/@anniespratt?utm_source=x" } });
  assert.match(html, /<p class="cover-credit">Photo by <a href="https:\/\/unsplash\.com\/@anniespratt\?utm_source=x" target="_blank" rel="noopener">Annie &lt;Spratt&gt;<\/a> on <a href="https:\/\/unsplash\.com\/\?utm_source=the_free_code_syndicate&amp;utm_medium=referral"/);
  assert.ok(!postPage({ ...post, cover_credit: { name: "x", url: "javascript:alert(1)" } }).includes("cover-credit"));
});
