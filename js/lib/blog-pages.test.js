import test from "node:test";
import assert from "node:assert/strict";
import { postPage, indexPage, sitemap } from "./blog-pages.js";

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
  assert.match(html, /<h1 class="post-title">Hello &lt;b&gt;&quot;world&quot;&lt;\/b&gt;<\/h1>/);
  assert.match(html, /og:image" content="https:\/\/cdn\.jsdelivr\.net\/gh\/x\/y@abc\/cover\.webp"/);
  assert.match(html, /rel="canonical" href="https:\/\/thefreecodesyndicate\.github\.io\/fcs-site\/blog\/hello-world\/"/);
  assert.match(html, /Ada · 6 October 2026/);
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

test("the index lists posts, or says there are none", () => {
  assert.match(indexPage([post]), /href="hello-world\/"/);
  assert.match(indexPage([]), /No posts yet/);
});

test("the sitemap names the home page, the blog and each post", () => {
  const xml = sitemap([post]);
  assert.match(xml, /<loc>https:\/\/thefreecodesyndicate\.github\.io\/fcs-site\/<\/loc>/);
  assert.match(xml, /fcs-site\/blog\/hello-world\//);
});
