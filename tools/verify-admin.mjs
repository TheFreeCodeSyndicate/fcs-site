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
  activity_log: [
    { id: 3, at: new Date(Date.now() - 2 * 36e5).toISOString(), actor_email: "ronit@fcs.test", action: "delete",
      table_name: "core_members", row_id: "m3", row_label: "Ved Bhandary", changed: [],
      snapshot: { id: "m3", name: "Ved Bhandary", role: "mentor", status: "active", is_published: true } },
    { id: 2, at: new Date(Date.now() - 5 * 36e5).toISOString(), actor_email: "ronit@fcs.test", action: "update",
      table_name: "events", row_id: "e1", row_label: "CryptoMeet-1", changed: ["details", "title"], snapshot: null },
    { id: 1, at: new Date(Date.now() - 864e5).toISOString(), actor_email: null, action: "create",
      table_name: "resources", row_id: "r1", row_label: "Intro to Git", changed: [], snapshot: null },
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

const uploads = [];
await page.route("**/storage/v1/object/**", (route) => {
  uploads.push(new URL(route.request().url()).pathname);
  return route.fulfill({ json: { Key: "member-photos/x" } });
});
await page.route("**/auth/v1/logout**", (route) => route.fulfill({ status: 204, body: "" }));
const invites = [];
let myRole = "admin"; // what profiles says about the signed-in user
await page.route("**/functions/v1/invite-member", (route) => {
  invites.push(route.request().postData());
  return route.fulfill({ json: { ok: true } });
});
// An invite link: supabase-js reads the token from the URL and asks
// /auth/v1/user who it belongs to; setting the password is a PUT there.
const invitee = { id: "u9", email: "friend@fcs.test", aud: "authenticated", role: "authenticated" };
await page.route("**/auth/v1/user**", (route) => route.fulfill({ json: invitee }));
// Signing in with a password.
await page.route("**/auth/v1/token?grant_type=password", (route) => route.fulfill({ json: {
  access_token: "a.b.c", token_type: "bearer", expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r", user: invitee,
} }));

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
    return route.fulfill({ json: myRole ? [{ role: myRole }] : [] });
  }
  return route.fulfill({ json: data[table] ?? [] });
});

// Fake a signed-in session. supabase-js reads it from localStorage under
// sb-<project ref>-auth-token and trusts it until expires_at.
const config = await (await fetch(new URL("js/config.js", base))).text();
const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(config)?.[1];
await page.addInitScript((r) => {
  if (location.protocol === "about:") return; // about:blank has no storage
  if (sessionStorage.getItem("fcs-signout-reason") || sessionStorage.getItem("fcs-test-signed-out")) return;
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
check("sidebar lists every page, Team included for an admin", links.length === 9 && links.includes("team") && links.includes("activity"), links.join(","));

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

// --- activity log, undo, restore ----------------------------------------
await page.goto(new URL("admin.html#/activity", base).href);
await settle(900);
check("Activity page lists the log", (await page.$$(".activity-row")).length === 3);


await page.goto(new URL("admin.html#/core", base).href);
await settle(800);
await page.click('.list-row[data-key="m1"] .list-open');
await settle(700);
check("the drawer says who last edited", /Last edited by ronit|Created by/.test(await page.$eval("#drawer-meta", (m) => m.textContent)),
  await page.$eval("#drawer-meta", (m) => m.textContent));

// photo upload: pick, preview, save, upload
await page.setInputFiles("[data-photo-input]", { name: "me.png", mimeType: "image/png", buffer: PNG });
await settle(500);
check("a picked photo previews before upload", (await page.$eval("[data-photo-preview] img", (i) => i.src)).startsWith("data:image/"));
check("the live preview shows the picked photo", (await page.$eval("#drawer-preview-slot .portrait-pixel", (i) => i.src)).startsWith("data:image/"));
const beforeUpload = writes.length;
await page.click('#drawer-actions [type=submit]');
await settle(900);
const saved = writes.slice(beforeUpload).find((w) => w.table === "core_members") || {};
check("saving uploads the photo and its pixel version", uploads.filter((u) => u.includes("member-photos")).length === 2, uploads.join(" | "));
check("the member row stores the uploaded URLs",
  /member-photos\/members\/[^"]+\.(webp|png)/.test(saved.body || "") && /-24\.png/.test(saved.body || ""), (saved.body || "").slice(0, 160));

// undo a delete from its toast
await page.click('.list-row[data-key="m3"] .list-open');
await settle();
await page.click("#drawer-delete");
await settle(150);
await page.click("#drawer-delete");
await settle(700);
const undo = await page.$(".toast-delete .toast-action");
check("a delete toast offers Undo", Boolean(undo));
const beforeUndo = writes.length;
if (undo) await undo.click();
await settle(900);
const restored = writes.slice(beforeUndo).find((w) => w.method === "POST" && w.table === "core_members") || {};
check("Undo re-inserts the deleted row", restored.body.includes('"id":"m3"'), restored.body);

// idle sign-out: pretend the last activity was 31 minutes ago
await page.evaluate(() => localStorage.setItem("fcs-admin-last-active", String(Date.now() - 31 * 60 * 1000)));
await page.waitForTimeout(17000);
await settle(800);
check("30 minutes idle signs out and says why",
  (await page.$eval("#admin-root", (r) => r.textContent)).includes("30 minutes without activity"));

// --- invites ----------------------------------------------------------
// Changing only the #hash does not reload the page; start from blank.
await page.goto("about:blank");
await page.goto(new URL("admin.html#/team", base).href);
await settle(900);
await page.fill("#invite-email", "friend@fcs.test");
await page.selectOption("#invite-role", "admin");
await page.click('#invite-form [type=submit]');
await settle(900);
check("the Team page sends an invite with the chosen role",
  invites.length === 1 && invites[0].includes('"email":"friend@fcs.test"') && invites[0].includes('"role":"admin"'), invites.join(" | "));

// removing someone: two clicks, never offered for yourself
check("you cannot remove yourself", !(await page.$('.team-list [data-id="u1"] [data-remove]')));
await page.click('.team-list [data-id="u2"] [data-remove]');
check("the first Remove click only arms it", !writes.some((w) => w.table === "remove_member"));
await page.click('.team-list [data-id="u2"] [data-remove]');
await settle(500);
check("the second Remove click deletes that login",
  writes.some((w) => w.table === "remove_member" && w.body.includes('"target":"u2"')), JSON.stringify(lastWrite()));

// an admin removes you while your panel is open: signed out, and told why
myRole = null;
await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
await settle(1500);
check("being removed by an admin signs you out and says why",
  /removed your access/.test(await page.$eval(".gate-notice", (e) => e.textContent).catch(() => "")));
myRole = "admin";

// opening the invite link: set and confirm a password to accept
await page.evaluate(() => sessionStorage.setItem("fcs-test-signed-out", "1"));
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("sb-")) localStorage.removeItem(k); });
await page.goto("about:blank");
await page.goto(new URL("admin.html#access_token=a.b.c&expires_in=3600&refresh_token=r&token_type=bearer&type=invite", base).href);
await settle(1500);
const inviteText = await page.$eval("#admin-root", (r) => r.textContent);
check("an invite link opens the accept page with the role", /Accept your invite/.test(inviteText) && /as Admin/.test(inviteText), inviteText.replace(/\s+/g, " ").slice(0, 120));
await page.fill("#new-password", "correct horse");
await page.fill("#confirm-password", "correct hose");
await page.click(".gate-submit");
await settle(300);
check("mismatched passwords are refused", (await page.$eval("#login-error", (e) => e.textContent)).includes("do not match"));
await page.fill("#confirm-password", "correct horse");
await page.click(".gate-submit");
await settle(1500);
check("accepting returns to sign-in with the email filled in and a success notice",
  (await page.$eval("#login-email", (e) => e.value).catch(() => "")) === "friend@fcs.test" &&
  /as admin/i.test(await page.$eval(".gate-notice-ok", (e) => e.textContent).catch(() => "")));
await page.fill("#login-password", "correct horse");
await page.click(".gate-submit");
await settle(1500);
check("signing in with the new password opens the panel", Boolean(await page.$(".sidebar-link")));

check("no console or page errors", errors.length === 0, errors.join(" | "));



await browser.close();
console.log(results.join("\n"));
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);
