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
  // A site with no favicon answers 404; the page then shows the default icon.
  if (m.type() === "error" && !/\/s2\/favicons/.test(m.location().url || "")) consoleErrors.push(m.text());
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
  coreMembers: document.querySelectorAll(".core-card").length,
  join: document.querySelectorAll(".join-card").length,
  nav: document.querySelectorAll(".nav-links a").length,
}));
check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));
check("no console errors", consoleErrors.length === 0, consoleErrors.join(" | "));
check("principles rendered", counts.principles > 0, `${counts.principles}`);
check("lanes rendered", counts.lanes > 0, `${counts.lanes}`);
check("groups rendered", counts.groups > 0, `${counts.groups}`);
check("core members rendered", counts.coreMembers > 0, `${counts.coreMembers}`);
check("join links rendered", counts.join >= 4, `${counts.join}`);
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

// --- every core member card is the same size, lead or mentor --------
// The old design gave leads a bigger card than mentors. Now every card
// has the same template and width, cards in a row share a height, and
// nothing inside a card scrolls or gets cut off.
const cardBoxes = await page.evaluate(() =>
  [...document.querySelectorAll("#core .core-card")].map((c) => {
    // offset* is the layout size, before each card's small idle tilt.
    const file = c.querySelector(".core-file");
    return { top: `${c.parentElement.id}:${c.offsetTop}`, w: c.offsetWidth, h: c.offsetHeight, clipped: file.scrollHeight > file.clientHeight + 1 };
  })
);
const ws = cardBoxes.map((b) => b.w);
check("core member cards share one width", Math.max(...ws) - Math.min(...ws) <= 4, `${Math.min(...ws)}-${Math.max(...ws)}`);
const rows = {};
for (const b of cardBoxes) (rows[b.top] ||= []).push(b.h); // one grid row: same grid, same top
const ragged = Object.values(rows).filter((hs) => Math.max(...hs) - Math.min(...hs) > 4);
check("cards in the same row share a height", ragged.length === 0, JSON.stringify(Object.values(rows)));
check("no card cuts off or scrolls its content", cardBoxes.every((b) => !b.clipped));

// --- no javascript: URLs survived into the DOM ----------------------
const badHrefs = await page.evaluate(() =>
  [...document.querySelectorAll("a[href]")]
    .map((a) => a.getAttribute("href"))
    .filter((h) => !/^(https?:|#|mailto:|webcal:)/i.test(h))
);
check("every href is http(s), #, mailto or webcal", badHrefs.length === 0, badHrefs.join(" | "));

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

// --- event subscriptions -----------------------------------------------
// The calendar menu points at the live feed, not a one-off download.
await page.click("#cal-menu > summary");
const cal = await page.evaluate(() => ({
  open: document.getElementById("cal-menu").open,
  google: document.getElementById("cal-google").href,
  webcal: document.getElementById("cal-webcal").href,
}));
check("calendar menu opens", cal.open, JSON.stringify(cal));
check("calendar menu subscribes to the events.ics feed",
  cal.webcal.startsWith("webcal:") && cal.webcal.endsWith("/events.ics") && cal.google.includes(encodeURIComponent(cal.webcal)), JSON.stringify(cal));
await page.keyboard.press("Escape");
check("Escape closes the calendar menu", !(await page.$eval("#cal-menu", (d) => d.open)));
const feed = await page.request.get(new URL("events.ics", base).href);
check("events.ics is served as a calendar", feed.ok() && (await feed.text()).startsWith("BEGIN:VCALENDAR"), String(feed.status()));

// "Email me about events" signs up through the event-mail function
// (stubbed here, so no email is sent).
const signups = [];
await page.route("**/functions/v1/event-mail", (route) => {
  signups.push(JSON.parse(route.request().postData() || "{}"));
  return route.fulfill({ json: { ok: true } });
});
await page.click('[data-notify="all"]');
check("the email dialog opens", await page.$eval("#notify-dialog", (d) => d.open));
await page.click("#notify-submit");
check("an empty email is refused", /Enter your email/.test(await page.textContent("#notify-status")) && signups.length === 0);
await page.fill("#notify-email", "visitor@example.com");
await page.click("#notify-submit");
await page.waitForTimeout(500);
check("subscribing asks the function for the all-events list",
  signups.length === 1 && signups[0].action === "subscribe" && signups[0].email === "visitor@example.com" && signups[0].event_id === null,
  JSON.stringify(signups));
check("the dialog says to check the inbox", /Check visitor@example\.com/.test(await page.textContent("#notify-status")));
await page.click("#notify-cancel");
check("the dialog closes", !(await page.$eval("#notify-dialog", (d) => d.open)));

// --- phone widths: nothing may stick out past the screen -------------------
for (const width of [320, 390]) {
  await page.setViewportSize({ width, height: 800 });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.evaluate(() => document.getElementById("events").scrollIntoView());
  await page.click("#cal-menu > summary");
  await page.waitForTimeout(200);
  const menu = await page.$eval(".cal-menu-list", (m) => { const r = m.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right) }; });
  const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`calendar menu fits on a ${width}px screen`, menu.left >= 0 && menu.right <= width, JSON.stringify(menu));
  check(`the page does not scroll sideways at ${width}px`, pageWidth <= width, `${pageWidth}px`);
}

await browser.close();

console.log(results.join("\n"));
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);
