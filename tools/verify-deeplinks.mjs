/*
 * tools/verify-deeplinks.mjs
 * ------------------------------------------------------------------
 * Loads the page at each section's #hash with GitHub answering late,
 * the way a real network does, so content renders above the target
 * after the browser's initial jump. Passes when every target ends up
 * flush under the sticky nav (js/main.js pinHashTarget).
 *   node tools/verify-deeplinks.mjs http://localhost:8000/
 * ------------------------------------------------------------------
 */
import { chromium } from "playwright";

const base = process.argv[2] || "http://localhost:8000/";
const repos = Array.from({ length: 8 }, (_, i) => ({
  name: `repo${i}`, html_url: `https://github.com/x/r${i}`, description: "d", language: "C", stargazers_count: 0,
  pushed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
}));

const browser = await chromium.launch({ channel: "msedge" });
let failures = 0;
const ids = ["abstract", "projects", "resources", "study-groups", "events", "core", "join", "references"];
for (const id of ids) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route("**/api.github.com/**", async (route) => {
    await new Promise((r) => setTimeout(r, 900));
    const url = route.request().url();
    route.fulfill({ json: url.includes("/commits") ? [] : url.includes("/users/") ? {} : repos });
  });
  await page.goto(`${new URL(base).href}#${id}`, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  const { top, nav, bottomed } = await page.evaluate((i) => ({
    top: document.getElementById(i).getBoundingClientRect().top,
    nav: document.getElementById("doc-nav").getBoundingClientRect().height,
    // The last sections cannot reach the top when the page ends first.
    bottomed: Math.ceil(scrollY + innerHeight) >= document.documentElement.scrollHeight - 1,
  }), id);
  const ok = Math.abs(top - nav) <= 2 || (bottomed && top >= nav - 2);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  #${id} — top ${Math.round(top)}px, nav ${Math.round(nav)}px${bottomed ? " (page end)" : ""}`);
  await page.close();
}
await browser.close();
console.log(`\n${ids.length - failures}/${ids.length} checks passed`);
process.exit(failures ? 1 : 0);
