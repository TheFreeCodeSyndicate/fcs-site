/*
 * tools/blog-build.mjs
 * ------------------------------------------------------------------
 * Writes the blog as static pages: blog/index.html, blog/<slug>/index.html
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
import { indexPage, postPage, sitemap } from "../js/lib/blog-pages.js";

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
for (const post of posts) {
  mkdirSync(`blog/${post.slug}`, { recursive: true });
  writeFileSync(`blog/${post.slug}/index.html`, postPage(post));
}
writeFileSync("sitemap.xml", sitemap(posts));
console.log(`Blog: ${posts.length} post${posts.length === 1 ? "" : "s"}`);
