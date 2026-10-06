/*
 * tools/blog-build.mjs
 * ------------------------------------------------------------------
 * Writes the blog as static pages: blog/index.html, blog/<slug>/index.html,
 * blog/latest.html (the home page's three newest)
 * and sitemap.xml. Run by the deploy workflow (every 30 minutes, on every
 * push, and when an editor publishes a post), and by hand to preview:
 *
 *   node tools/blog-build.mjs
 *
 * Reads posts with the public anon key, so it only ever sees published
 * ones. blog/ and sitemap.xml are build output and are not committed.
 * If Supabase is unreachable the build fails, so a bad run never
 * replaces a good site with an empty blog.
 * ------------------------------------------------------------------
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { indexPage, latestFragment, postPage, sitemap, postAuthors } from "../js/lib/blog-pages.js";
import { plainSummary, readingTime } from "../js/lib/markdown.js";
import { postCard, siteCard } from "./og.mjs";

const config = readFileSync("js/config.js", "utf8");
const url = /supabaseUrl:\s*"([^"]+)"/.exec(config)?.[1];
const key = /supabaseAnonKey:\s*"([^"]+)"/.exec(config)?.[1];
if (!url || !key) throw new Error("Supabase is not configured in js/config.js");

const res = await fetch(
  `${url}/rest/v1/blog_posts?select=*&status=eq.published&order=published_at.desc`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } }
);
// Until migration 022 is run there is no table (404); build an empty blog.
const posts = res.status === 404 ? [] : res.ok ? await res.json() : null;
if (!posts) throw new Error(`blog_posts -> ${res.status}`);

rmSync("blog", { recursive: true, force: true });
mkdirSync("blog", { recursive: true });
writeFileSync("blog/index.html", indexPage(posts));
writeFileSync("blog/latest.html", latestFragment(posts));
for (const post of posts) {
  mkdirSync(`blog/${post.slug}`, { recursive: true });
  writeFileSync(`blog/${post.slug}/index.html`, postPage(post));
}
writeFileSync("sitemap.xml", sitemap(posts));
console.log(`Blog: ${posts.length} post${posts.length === 1 ? "" : "s"}`);

/* ---- link-preview cards (tools/og.mjs) -------------------------------------
 * blog/<slug>/og.jpg for each post, blog/og/blog.jpg for the blog and
 * blog/og/home.jpg for the home page (index.html and the other pages point
 * at it). Redrawn on every build, so they follow edits and the newest post.
 * A card that fails is skipped with a warning: a missing preview is better
 * than holding back the whole deploy.
 * ponytail: every card is redrawn each run; cache by updated_at if posts reach the hundreds. */
const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "");
const cardOf = (p) => ({
  slug: p.slug,
  title: p.title,
  summary: p.excerpt || plainSummary(p.body),
  authors: postAuthors(p),
  date: day(p.published_at),
  minutes: readingTime(p.body).minutes,
  cover: p.cover_url,
  icon: p.icon,
});
async function draw(file, make) {
  try {
    writeFileSync(file, await make());
  } catch (err) {
    console.warn(`Preview card ${file} skipped: ${err.message}`);
  }
}
mkdirSync("blog/og", { recursive: true });
for (const post of posts) await draw(`blog/${post.slug}/og.jpg`, () => postCard(cardOf(post)));
const newest = posts[0] && cardOf(posts[0]);
await draw("blog/og/blog.jpg", () => siteCard({
  section: "BLOG",
  headline: "Notes, write-ups",
  accent: "and updates",
  line: "From the people of The Free Code Syndicate: what we built, what we read, and what broke along the way.",
  foot: newest ? `Latest: ${newest.title}` : "New posts soon",
  latest: newest,
}));
await draw("blog/og/home.jpg", () => siteCard({
  headline: "The Free Code",
  accent: "Syndicate",
  line: "A public group for free code, study, and careful work.",
  foot: newest ? `New on the blog: ${newest.title}` : "thefreecodesyndicate.github.io",
  mark: true,
}));
console.log(`Preview cards: ${posts.length + 2}`);
