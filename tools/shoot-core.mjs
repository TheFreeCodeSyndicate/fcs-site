/*
 * tools/shoot-core.mjs
 * ------------------------------------------------------------------
 * Renders the Core Members section with generated data at 3, 12 and
 * 30 people (plus the seed fallback, dark mode and mobile) and writes
 * screenshots to .shots/. GitHub is stubbed, so it costs no API quota.
 *   node tools/shoot-core.mjs
 * ------------------------------------------------------------------
 */
import { chromium } from "playwright";
const users = ["nonQualities", "JyotirmoyDas05", "no3465", "torvalds", "gaearon", "sindresorhus", "tj", "yyx990803", "addyosmani", "kentcdodds"];
const groups = ["Crypto Study Group", "Systems Reading Room", "Anti Aliasing", "Web Guild"];
const focus = [["crypto", "math"], ["os", "compilers"], ["graphics", "shaders"], ["web", "a11y"]];
const names = ["Ronit Choudhury", "Jyotirmoy Das", "Ved Bhandary", "Aarav Sen", "Meera Pillai", "Ishaan Rao", "Tanvi Kulkarni", "Kabir Mehta", "Anaya Iyer", "Rohan Bose"];
function people(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `m${i}`, name: names[i % names.length] + (i >= names.length ? ` ${Math.floor(i / names.length) + 1}` : ""),
    role: i < 3 ? "lead" : "mentor", status: i === n - 1 && n > 3 ? "alumni" : "active",
    title: i === 0 ? "Events lead" : null, group_name: groups[i % 4], focus: focus[i % 4],
    bio: i % 3 === 2 ? null : "Runs the weekly session and reviews first pull requests. Ask about anything in the syllabus.",
    github_username: users[i % users.length] + (i >= users.length ? "" : ""), linkedin_url: i % 2 ? "https://linkedin.com/in/x" : null,
    website_url: i % 4 === 0 ? "https://example.com" : null, discord_handle: i % 3 === 0 ? "handle#" + i : null,
    email: i === 1 ? "someone@example.com" : null, joined_on: "2025-08-01", ended_on: i === n - 1 && n > 3 ? "2026-06-01" : null,
    sort_order: i, is_published: true,
  }));
}
const b = await chromium.launch({ channel: "msedge" });
const errs = [];
const runs = [["seed", null, "light", { width: 1440, height: 900 }], ["n3", 3, "light", { width: 1440, height: 900 }], ["n12", 12, "light", { width: 1440, height: 900 }], ["n12-dark", 12, "dark", { width: 1440, height: 900 }], ["n30", 30, "light", { width: 1440, height: 900 }], ["n12-mobile", 12, "light", { width: 390, height: 844 }]];
for (const [name, n, scheme, vp] of runs) {
  const p = await b.newPage({ viewport: vp, colorScheme: scheme });
  p.on("pageerror", (e) => errs.push(name + ": " + e));
  await p.route("**/api.github.com/**", (r) => r.fulfill({ json: [] }));
  if (n) await p.route("**/rest/v1/core_members**", (r) => r.fulfill({ json: people(n) }));
  await p.goto("http://localhost:8000/#core", { waitUntil: "networkidle" });
  await p.evaluate(() => document.getElementById("core").scrollIntoView({ behavior: "instant" }));
  await p.waitForTimeout(1500);
  if (n && n > 3) {
    const rows = await p.$$(".core-badge");
    if (vp.width > 900) await rows[1].hover();

    await p.waitForTimeout(700);
  } else {
    await p.hover(".core-card");
    await p.waitForTimeout(700);
  }
  const counts = await p.evaluate(() => ({ leads: document.querySelectorAll(".core-card").length, badges: document.querySelectorAll(".core-badge").length, chips: document.querySelectorAll("#core-filters .chip").length, alumni: document.getElementById("core-alumni").hidden ? 0 : 1, photos: document.querySelectorAll(".portrait-photo[src]").length, count: document.getElementById("core-count").textContent }));
  console.log(name, JSON.stringify(counts));
  await (await p.$("#core")).screenshot({ path: `.shots/core-${name}.png` });
}
console.log("errors", errs);
await b.close();
