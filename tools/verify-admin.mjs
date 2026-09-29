/*
 * tools/verify-admin.mjs
 * ------------------------------------------------------------------
 * A headless check of the admin panel with Supabase stubbed out: a fake
 * session in localStorage and canned REST responses. It walks the
 * panel the way a maintainer would: board drag, the edit drawer and its
 * live preview, validation, unsaved-changes guard, click-again delete,
 * move to alumni, reordering, search, repo curation and the Team page.
 *
 * Real RLS still needs a live account: see the plan's Task 5.4 Step 7.
 *
 * Usage:
 *   python -m http.server 8000
 *   node tools/verify-admin.mjs http://localhost:8000/
 * ------------------------------------------------------------------
 */
import { chromium } from "playwright";

const base = process.argv[2] || "http://localhost:8000/";
const results = [];
let failures = 0;
const check = (name, ok, detail) => {
  results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const now = Date.now();
const ev = (id, title, stage, days, order) => ({
  id, title, stage, group_name: "Crypto Study Group", duration_minutes: 60, sort_order: order,
  starts_at: new Date(now + days * 864e5).toISOString(), details: 'He said "hi" & <b>left</b>',
});
const member = (id, name, role, gh, order) => ({
  id, name, role, status: "active", github_username: gh, sort_order: order, is_published: true,
  focus: [], bio: null, group_name: null, title: null,
});
const data = {
  events: [ev("e1", "CryptoMeet-1", "done", -40, 0), ev("e3", "Explain-3", "draft", 2, 0), ev("e4", "Reading room", "scheduled", 5, 0)],
  class_sessions: [{ id: "c1", title: "Explain-3 Session", weekday: 3, start_time: "21:00:00", duration_minutes: 60, is_active: true, sort_order: 0 }],
  resources: [],
  study_groups: [{ id: "g1", name: "Crypto Study Group", topic: "Crypto", status: "Forming", sort_order: 0 }],
  social_links: [],
  repo_kinds: [{ repo_name: "anti-aliasing", kind: "resource", note: null }],
  core_members: [
    member("m1", "Ronit Choudhury", "lead", "nonQualities", 0),
    member("m2", "Jyotirmoy Das", "lead", "JyotirmoyDas05", 1),
    member("m3", "Ved Bhandary", "mentor", "no3465", 2),
  ],
  profiles: [
    { id: "u1", email: "maintainer@fcs.test", role: "admin", created_at: "2026-09-01" },
    { id: "u2", email: "newcomer@fcs.test", role: "pending", created_at: "2026-09-20" },
  ],
};

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const writes = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

// Avatars come from github.com; answer with a 1px PNG so no real request is made.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
await page.route("https://github.com/**", (route) => route.fulfill({ contentType: "image/png", body: PNG }));

await page.route("**/rest/v1/**", (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const table = url.pathname.split("/").pop();
  const single = (req.headers()["accept"] || "").includes("vnd.pgrst.object");
  if (req.method() !== "GET") {
    writes.push({ method: req.method(), table, query: url.searchParams.toString(), body: req.postData() || "" });
    return route.fulfill({ json: single ? { id: "x" } : [{ id: "x" }] });
  }
  // getRole() selects only "role" for the signed-in user; the Team page
  // selects the full columns for everyone.
  if (table === "profiles" && url.searchParams.get("select") === "role") {
    return route.fulfill({ json: [{ role: "admin" }] });
  }
  return route.fulfill({ json: data[table] ?? [] });
});

// Fake a signed-in session. supabase-js reads it from localStorage under
// sb-<project ref>-auth-token and trusts it until expires_at.
const config = await (await fetch(new URL("js/config.js", base))).text();
const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(config)?.[1];
await page.addInitScript((r) => {
  localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify({
    access_token: "a.b.c", token_type: "bearer", expires_in: 3600, refresh_token: "r",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "u1", email: "maintainer@fcs.test", aud: "authenticated", role: "authenticated" },
  }));
}, ref);

const drawerOpen = () => page.$eval("#drawer", (d) => !d.hidden && d.classList.contains("is-open"));
const lastWrite = () => writes[writes.length - 1] || {};
const settle = (ms = 400) => page.waitForTimeout(ms);

await page.goto(new URL("admin.html", base).href, { waitUntil: "networkidle" });
await settle(800);

// --- shell --------------------------------------------------------------
const links = await page.$$eval(".sidebar-link", (a) => a.map((x) => x.dataset.page));
check("sidebar lists every page, Team included for an admin", links.length === 8 && links.includes("team"), links.join(","));

// --- events board -------------------------------------------------------
const counts = () => page.$$eval(".board-column h3", (h) => h.map((x) => x.textContent.replace(/\s+/g, " ").trim()).join(", "));
check("board renders four columns with counts", (await counts()) === "draft 1, scheduled 1, live 0, done 1", await counts());
await page.dragAndDrop('.card[data-id="e3"]', '.board-dropzone[data-stage="scheduled"]');
await settle(800);
check("drag writes the destination stage", writes.some((w) => w.table === "events" && w.body === '{"stage":"scheduled"}'));

await page.click('.card[data-id="e4"]');
await settle();
check("clicking a card opens the drawer", await drawerOpen());
check("stored text is escaped, not rendered as HTML",
  (await page.$eval("#drawer-form textarea[name=details]", (t) => t.value)) === 'He said "hi" & <b>left</b>');
check("event drawer shows a live preview card", Boolean(await page.$("#drawer-preview-slot .event-card")));
await page.keyboard.press("Escape");
await settle();
check("Escape closes an unchanged drawer", !(await drawerOpen()));

// --- core members -------------------------------------------------------
await page.goto(new URL("admin.html#/core", base).href);
await settle(800);
check("core page lists members", (await page.$$(".list-row")).length === 3);

await page.fill("#page-search", "ved");
await settle();
check("search narrows the list", (await page.$$(".list-row")).length === 1);
await page.fill("#page-search", "");
await settle();

await page.click('.list-row[data-key="m1"] .list-open');
await settle();
await page.fill("#drawer-form textarea[name=bio]", "Runs the crypto room.");
await settle(200);
check("typing updates the preview", (await page.$eval("#drawer-preview-slot", (s) => s.textContent)).includes("Runs the crypto room."));
check("bio counter counts characters", (await page.$eval('[data-counter-for="bio"]', (c) => c.textContent)).startsWith("21 /"));

await page.keyboard.press("Escape");
await settle();
check("Escape with unsaved changes asks first", (await drawerOpen()) && !(await page.$eval("#drawer-confirm", (c) => c.hidden)));
await page.click("[data-keep]");
await settle(200);
await page.click('#drawer-actions [type=submit]');
await settle(700);
const save = lastWrite();
check("saving patches the member", save.method === "PATCH" && save.table === "core_members" && save.body.includes("Runs the crypto room."), save.body);
check("the drawer closes after saving", !(await drawerOpen()));

// validation: a duplicate GitHub username never reaches the database
await page.click("#page-new");
await settle();
const before = writes.length;
await page.fill("#drawer-form input[name=name]", "Someone New");
await page.fill("#drawer-form input[name=github_username]", "@JyotirmoyDas05");
await page.click('#drawer-actions [type=submit]');
await settle();
const dupError = await page.$eval('[data-error-for="github_username"]', (e) => !e.hidden && e.textContent);
check("duplicate GitHub username shows a field error", Boolean(dupError), dupError || "");
check("an invalid form sends nothing", writes.length === before);
await page.click("[data-drawer-close]");
await settle(200);
await page.click("[data-discard]");
await settle();

// click-again delete
await page.click('.list-row[data-key="m3"] .list-open');
await settle();
const delBefore = writes.filter((w) => w.method === "DELETE").length;
await page.click("#drawer-delete");
await settle(200);
check("first delete click only arms the button",
  writes.filter((w) => w.method === "DELETE").length === delBefore &&
  (await page.$eval("#drawer-delete", (b) => b.textContent.includes("Click again"))));
await page.click("#drawer-delete");
await settle(700);
check("second click deletes", writes.some((w) => w.method === "DELETE" && w.table === "core_members" && w.query.includes("m3")));

// move to alumni
await page.click('.list-row[data-key="m2"] .list-open');
await settle();
await page.click("#drawer-actions >> text=Move to alumni");
await settle(700);
const alumni = lastWrite();
check("Move to alumni sets status and end date", alumni.body.includes('"status":"alumni"') && /"ended_on":"\d{4}-\d{2}-\d{2}"/.test(alumni.body), alumni.body);

// reorder by keyboard buttons
const orderBefore = writes.length;
await page.click('.list-row[data-key="m1"] [data-move="1"]');
await settle(700);
check("move down writes sort_order", writes.slice(orderBefore).some((w) => w.table === "core_members" && w.body.includes("sort_order")));

// --- repo curation --------------------------------------------------------
await page.goto(new URL("admin.html#/repos", base).href);
await settle(800);
await page.click(".list-row .list-open");
await settle();
check("repo curation keeps the key locked when editing",
  await page.$eval("#drawer-form input[name=repo_name]", (i) => i.readOnly && i.value === "anti-aliasing"));
await page.keyboard.press("Escape");
await settle();

// --- team -------------------------------------------------------------------
await page.goto(new URL("admin.html#/team", base).href);
await settle(800);
check("Team flags accounts waiting for approval", Boolean(await page.$(".page-alert")));
await page.click('.list-row[data-id="u2"] [data-role="editor"]');
await settle(700);
const approve = lastWrite();
check("approving writes the editor role", approve.table === "profiles" && approve.body === '{"role":"editor"}', approve.body);

check("no console or page errors", errors.length === 0, errors.join(" | "));

await page.goto(new URL("admin.html#/core", base).href);
await settle(800);
await page.click('.list-row[data-key="m1"] .list-open');
await settle(600);
await page.screenshot({ path: ".shots/admin-core-drawer.png" }).catch(() => {});

await browser.close();
console.log(results.join("\n"));
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);
