/*
 * tools/verify-admin.mjs
 * ------------------------------------------------------------------
 * A headless check of the admin panel with Supabase stubbed out: a fake
 * session in localStorage and canned REST responses. It proves the
 * board renders, a drag writes the destination stage and the new
 * order, and stored text is escaped. Real RLS still needs a live
 * account — see the plan's Task 5.4 Step 7.
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
const data = {
  profiles: { role: "admin" },
  events: [ev("e1", "CryptoMeet-1", "done", -40, 0), ev("e3", "Explain-3", "draft", 2, 0), ev("e4", "Reading room", "scheduled", 5, 0)],
  class_sessions: [{ id: "c1", title: "Explain-3 Session", weekday: 3, start_time: "21:00:00", duration_minutes: 60, is_active: true }],
  repo_kinds: [{ repo_name: "anti-aliasing", kind: "resource", note: null }],
};

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
const writes = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.route("**/rest/v1/**", (route) => {
  const req = route.request();
  const table = new URL(req.url()).pathname.split("/").pop();
  if (req.method() !== "GET") {
    writes.push(`${table} ${new URL(req.url()).searchParams.get("id")} ${req.postData()}`);
    return route.fulfill({ json: [{ id: "x" }] });
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

await page.goto(new URL("admin.html", base).href, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

const counts = () => page.$$eval(".board-column h3", (h) => h.map((x) => x.textContent.replace(/\s+/g, " ").trim()).join(", "));
const before = await counts();
check("board renders four columns with counts", before === "draft 1, scheduled 1, live 0, done 1", before);

await page.dragAndDrop('.card[data-id="e3"]', '.board-dropzone[data-stage="scheduled"]');
await page.waitForTimeout(800);
const after = await counts();
check("drag moves the card to the destination column", after === "draft 0, scheduled 2, live 0, done 1", after);
check("drag writes the destination stage", writes.some((w) => w === 'events eq.e3 {"stage":"scheduled"}'), writes.join(" | "));
check("drag writes the new within-column order", writes.filter((w) => w.includes("sort_order")).length === 2);

await page.click('.card[data-id="e4"]');
const details = await page.$eval("textarea[name=details]", (t) => t.value);
check("stored text is escaped, not rendered as HTML", details === 'He said "hi" & <b>left</b>', details);

await page.click('[data-tab="repo-kinds"]');
await page.click('.editor-row [data-action="edit"]');
check("repo curation rows are editable with the key locked", await page.$eval("input[name=repo_name]", (i) => i.readOnly && i.value === "anti-aliasing"));

check("no console or page errors", errors.length === 0, errors.join(" | "));

await browser.close();
console.log(results.join("\n"));
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);
