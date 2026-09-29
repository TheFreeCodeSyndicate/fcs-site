/*
 * tools/verify-page.mjs
 * ------------------------------------------------------------------
 * A one-off headless check of the public page. Not part of the test
 * suite and not shipped to the site — it exists because two real bugs
 * (a silently-unloaded Supabase client, and a nav with no active link
 * at the top of the page) were invisible to unit tests and only showed
 * up in a real browser.
 *
 * Usage:
 *   python -m http.server 8000
 *   node tools/verify-page.mjs http://localhost:8000/
 */
import { chromium } from "playwright";

const base = process.argv[2] || "http://localhost:8000/";
const results = [];
let failures = 0;

function check(name, condition, detail) {
  results.push(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures++;
}

const browser = await chromium.launch({
  // Use the Edge already installed on Windows rather than requiring a
  // Playwright-managed browser download.
  channel: "msedge",
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const consoleErrors = [];
const pageErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => pageErrors.push(String(e)));

await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

// --- the page rendered at all ---------------------------------------
const counts = await page.evaluate(() => ({
  principles: document.querySelectorAll(".principle-item").length,
  lanes: document.querySelectorAll(".lane-card").length,
  groups: document.querySelectorAll(".group-card").length,
  events: document.querySelectorAll(".event-card").length,
  repos: document.querySelectorAll(".repo-card").length,
  coreMembers: document.querySelectorAll(".core-card, .core-row").length,
  join: document.querySelectorAll(".join-card").length,
  refs: document.querySelectorAll("#ref-list li").length,
  nav: document.querySelectorAll(".nav-links a").length,
}));
check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));
check("no console errors", consoleErrors.length === 0, consoleErrors.join(" | "));
check("principles rendered", counts.principles > 0, `${counts.principles}`);
check("lanes rendered", counts.lanes > 0, `${counts.lanes}`);
check("groups rendered", counts.groups > 0, `${counts.groups}`);
check("core members rendered", counts.coreMembers > 0, `${counts.coreMembers}`);
check("join links rendered", counts.join === 4, `${counts.join}`);
check("references rendered", counts.refs === 4, `${counts.refs}`);
check("nav has links", counts.nav === 6, `${counts.nav}`);
check("projects loaded from GitHub", counts.repos > 0, `${counts.repos}`);

// --- Instagram is actually present ----------------------------------
const bodyText = await page.evaluate(() => document.body.innerText);
check("Instagram appears on the page", /Instagram/i.test(bodyText));
check("new Discord invite is used", !/nH2PRmbB5/.test(bodyText));

// --- event state is derived, never stale -----------------------------
const tags = await page.evaluate(() =>
  [...document.querySelectorAll(".event-card .tag")].map((t) => t.textContent.trim())
);
check("no event claims to be UPCOMING when none is scheduled", !tags.includes("UPCOMING"), tags.join(","));
check("event tags use the derived vocabulary",
  tags.every((t) => ["UPCOMING", "LIVE NOW", "FINISHED"].includes(t)), tags.join(","));

// --- THE BUG: an active nav link must exist at the top of the page ---
const activeAtTop = await page.evaluate(() =>
  [...document.querySelectorAll(".nav-links a.is-active")].map((a) => a.textContent.trim())
);
check("exactly one active nav link at scroll 0", activeAtTop.length === 1, JSON.stringify(activeAtTop));
check("active nav link at top is About", activeAtTop[0] === "About", JSON.stringify(activeAtTop));

// --- and it must track scrolling ------------------------------------
const track = [];
for (const [name, y] of [["projects", 3000], ["resources", 3700], ["groups", 4050], ["events", 4650], ["join", 6600]]) {
  await page.evaluate((top) => window.scrollTo(0, top), y);
  await page.waitForTimeout(250);
  const a = await page.evaluate(() =>
    [...document.querySelectorAll(".nav-links a.is-active")].map((x) => x.textContent.trim())
  );
  track.push(`${name}->${a.join("|") || "NONE"}`);
  check(`scrolled to ${name}: exactly one active link`, a.length === 1, a.join("|"));
}
check("nav tracks the section being read", track.every((t) => !t.endsWith("NONE")), track.join("  "));

// --- no javascript: URLs survived into the DOM ----------------------
const badHrefs = await page.evaluate(() =>
  [...document.querySelectorAll("a[href]")]
    .map((a) => a.getAttribute("href"))
    .filter((h) => !/^(https?:|#|mailto:)/i.test(h))
);
check("every href is http(s), # or mailto", badHrefs.length === 0, badHrefs.join(" | "));

// --- dark mode: no flash, and the toggle works ----------------------
await page.evaluate(() => localStorage.clear());
await page.emulateMedia({ colorScheme: "dark" });
await page.reload({ waitUntil: "networkidle" });
const themeDark = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
check("respects prefers-color-scheme: dark", themeDark === "dark", String(themeDark));
const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
check("dark theme actually repaints the body", darkBg !== "rgb(246, 244, 239)", darkBg);

await page.click("#theme-toggle");
await page.waitForTimeout(200);
const themeAfter = await page.evaluate(() => ({
  theme: document.documentElement.getAttribute("data-theme"),
  pressed: document.getElementById("theme-toggle").getAttribute("aria-pressed"),
  stored: localStorage.getItem("fcs-theme"),
}));
check("toggle switches to light", themeAfter.theme === "light", JSON.stringify(themeAfter));
check("toggle keeps aria-pressed in sync", themeAfter.pressed === "false", JSON.stringify(themeAfter));
check("toggle persists the choice", themeAfter.stored === "light", JSON.stringify(themeAfter));
await page.reload({ waitUntil: "networkidle" });
const themePersisted = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
check("choice survives a reload", themePersisted === "light", String(themePersisted));

await browser.close();

console.log(results.join("\n"));
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);
