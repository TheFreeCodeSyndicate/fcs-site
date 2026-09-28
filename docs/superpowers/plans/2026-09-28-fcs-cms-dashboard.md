# FCS Site: Admin CMS, Events, Resources, Dark Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give The Free Code Syndicate a login-protected admin panel so a non-technical maintainer can update events, class schedule, resources, study groups, and social links, while the public site derives event state from timestamps so it can never look stale again.

**Architecture:** The site stays a no-build static bundle on GitHub Pages. Six pure-logic ES modules in `js/lib/` hold all testable logic and are imported unchanged by both the browser and `node --test`. `js/supabase.js` is the only module that talks to Supabase, using just the *anon* key; Postgres Row Level Security provides the real authorisation. Every database read falls back to hard-coded seed data in `js/data.js`, so the site works fully with no database configured.

**Tech Stack:** Vanilla HTML/CSS/ES modules. Supabase (Postgres, GoTrue auth, RLS) free tier. Node 22 built-in `node --test` — **zero npm dependencies, no build step**. Vendored `supabase-js` UMD and SortableJS, no CDN at runtime.

**Spec:** `docs/superpowers/specs/2026-09-28-fcs-cms-dashboard-design.md`

---

## Scope decomposition — read this first

The spec contains six independently shippable phases. **This plan is organised as
seven task groups: Phase 0 is the test harness, and Phases 1–6 map one-to-one
onto the spec's six rollout phases.** Execute them in order, one at a time, with
a checkpoint between each. Do not merge them into one commit. Phase 1 lands dark
(nothing reads the new code yet), so the site is in a working state at every
single boundary.

| Phase | Ships | Needs a human? |
|-------|-------|----------------|
| 0 | Test harness | No |
| 1 | Pure logic modules + Supabase adapter (unused) | No |
| 2 | Dark mode | No |
| 3 | Nav rework | No |
| 4 | Data-backed public sections, events revamp, repo split | No |
| 5 | Admin panel + Kanban | **Yes — a real Supabase project** |
| 6 | Cutover, link sweep, README | Partly |

Phases 0–4 can be built and verified with no database at all.

---

## File map

| File | Responsibility |
|------|----------------|
| `package.json` | Test script only. No dependencies. |
| `supabase/schema.sql` | Tables, indexes, RLS policies, triggers, seed rows |
| `js/config.js` | Supabase URL + anon key + site constants |
| `js/supabase.js` | Client init, session, one function per operation |
| `js/lib/derive.js` | `deriveEventState` — event display state from timestamps |
| `js/lib/schedule.js` | `nextOccurrence`, `resolveNextSession` — weekly recurrence |
| `js/lib/countdown.js` | `formatCountdown` — ms to `2d 04h 13m` |
| `js/lib/events-view.js` | `partitionEvents`, `groupNames`, `filterByGroup` |
| `js/lib/ics.js` | `buildICS` — RFC 5545 calendar text |
| `js/lib/repos.js` | `splitRepos` — Resources/Projects classification |
| `js/lib/forms.js` | datetime-local to UTC conversion |
| `js/lib/*.test.js` | One test file per module, colocated |
| `js/data.js` | Fixed copy + seed fallback arrays |
| `js/main.js` | Public page rendering + countdown loop |
| `js/admin.js` | Login, Kanban board, CRUD editors |
| `index.html` | Public page |
| `admin.html` | Admin panel |
| `css/style.css` | Public page styles, tokenised |
| `css/admin.css` | Admin panel styles, tokenised |
| `js/vendor/` | `supabase.min.js`, `sortable.min.js` |

---

# Phase 0 — Test harness

### Task 0.1: Add `package.json` with a zero-dependency test script

**Files:**
- Create: `package.json`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "fcs-site",
  "version": "1.0.0",
  "private": true,
  "description": "The Free Code Syndicate — static site with a Supabase-backed admin panel.",
  "type": "module",
  "scripts": {
    "test": "node --test js/lib/*.test.js",
    "serve": "python -m http.server 8000"
  }
}
```

`"type": "module"` is required so `node --test` can `import` the ES modules. It does not affect the browser, which reads the same files via `<script type="module">`.

- [ ] **Step 2: Verify the harness runs**

Run: `npm test`
Expected: `tests 0`, `pass 0`, `fail 0`, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add zero-dependency test harness"
```

---

# Phase 1 — Pure logic modules and the Supabase adapter (lands dark)

Nothing in this phase is wired to the page. It exists so Phases 4 and 5 can be built on tested logic.

### Task 1.1: `deriveEventState` — the fix for stale events

**Files:**
- Create: `js/lib/derive.js`
- Test: `js/lib/derive.test.js`

This is the most important function in the project. It is why an event can never be displayed as upcoming once its time has passed, regardless of what a human typed.

- [ ] **Step 1: Write the failing test**

`js/lib/derive.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveEventState, LIVE_LEAD_MINUTES } from "./derive.js";

const START = "2026-10-05T18:30:00.000Z";
const DURATION = 60;

const at = (minutesFromStart) =>
  new Date(new Date(START).getTime() + minutesFromStart * 60000).toISOString();

test("is upcoming well before the live window", () => {
  assert.equal(deriveEventState(at(-60), START, DURATION, "scheduled"), "upcoming");
});

test("is still upcoming one minute before the live window opens", () => {
  assert.equal(
    deriveEventState(at(-LIVE_LEAD_MINUTES - 1), START, DURATION, "scheduled"),
    "upcoming"
  );
});

test("is live exactly when the live window opens", () => {
  assert.equal(
    deriveEventState(at(-LIVE_LEAD_MINUTES), START, DURATION, "scheduled"),
    "live"
  );
});

test("is live while the session runs", () => {
  assert.equal(deriveEventState(at(0), START, DURATION, "scheduled"), "live");
  assert.equal(deriveEventState(at(59), START, DURATION, "scheduled"), "live");
});

test("is finished as soon as the session ends", () => {
  assert.equal(deriveEventState(at(60), START, DURATION, "scheduled"), "finished");
});

test("a month-old event is finished even if nobody moved its card", () => {
  assert.equal(deriveEventState(at(60 * 24 * 30), START, DURATION, "scheduled"), "finished");
});

test("stage done forces finished regardless of the clock", () => {
  assert.equal(deriveEventState(at(0), START, DURATION, "done"), "finished");
});

test("a cancelled future event explicitly set to done is finished", () => {
  assert.equal(deriveEventState(at(60 * 24 * 7), START, DURATION, "done"), "finished");
});

test("stage draft is still subject to the clock", () => {
  assert.equal(deriveEventState(at(-60), START, DURATION, "draft"), "upcoming");
  assert.equal(deriveEventState(at(60), START, DURATION, "draft"), "finished");
});

test("an unparseable start is treated as upcoming rather than throwing", () => {
  assert.equal(deriveEventState(new Date(), "not-a-date", 60, "scheduled"), "upcoming");
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module .../js/lib/derive.js`.

- [ ] **Step 3: Implement**

`js/lib/derive.js`:

```js
/*
 * js/lib/derive.js
 * ------------------------------------------------------------------
 * Turns an event's timestamps into what a visitor should actually
 * see. Deliberately independent of the browser so it can be unit
 * tested directly.
 * ------------------------------------------------------------------
 */

/** Minutes before the start at which an event is considered live. */
export const LIVE_LEAD_MINUTES = 15;

const MINUTE_MS = 60 * 1000;

/**
 * @param {string|Date} now
 * @param {string} startsAt        ISO timestamp
 * @param {number} durationMinutes
 * @param {string} stage           "draft" | "scheduled" | "live" | "done"
 * @returns {"upcoming"|"live"|"finished"}
 */
export function deriveEventState(now, startsAt, durationMinutes = 60, stage = "scheduled") {
  if (stage === "done") return "finished";

  const start = new Date(startsAt).getTime();
  if (Number.isNaN(start)) return "upcoming";

  const end = start + (durationMinutes || 60) * MINUTE_MS;
  const liveFrom = start - LIVE_LEAD_MINUTES * MINUTE_MS;
  const t = new Date(now).getTime();
  if (Number.isNaN(t)) return "upcoming";

  if (t < liveFrom) return "upcoming";
  if (t < end) return "live";
  return "finished";
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npm test`
Expected: 10 tests, 10 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add js/lib/derive.js js/lib/derive.test.js
git commit -m "feat(lib): derive event display state from timestamps"
```

### Task 1.2: `nextOccurrence` and `resolveNextSession`

**Files:**
- Create: `js/lib/schedule.js`
- Test: `js/lib/schedule.test.js`

- [ ] **Step 1: Write the failing test**

`js/lib/schedule.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextOccurrence, resolveNextSession } from "./schedule.js";

const at = (iso) => new Date(iso);

test("returns the next matching weekday later the same day", () => {
  const next = nextOccurrence(
    { weekday: 3, start_time: "21:00", is_active: true },
    at("2026-10-07T09:00:00")
  );
  assert.equal(next.getHours(), 21);
  assert.equal(next.getMinutes(), 0);
  assert.equal(next.getDate(), 7);
});

test("rolls to next week when today's slot has passed", () => {
  const next = nextOccurrence(
    { weekday: 3, start_time: "21:00", is_active: true },
    at("2026-10-07T23:00:00")
  );
  assert.equal(next.getDay(), 3);
  assert.equal(next.getDate(), 14);
});

test("weekday 0 is Sunday, matching Date.getDay()", () => {
  const next = nextOccurrence(
    { weekday: 0, start_time: "10:00", is_active: true },
    at("2026-10-05T12:00:00")
  );
  assert.equal(next.getDay(), 0);
});

test("inactive sessions have no next occurrence", () => {
  assert.equal(
    nextOccurrence({ weekday: 1, start_time: "10:00", is_active: false }, at("2026-10-05T12:00:00")),
    null
  );
});

test("a malformed start_time yields null rather than an Invalid Date", () => {
  assert.equal(
    nextOccurrence({ weekday: 1, start_time: "", is_active: true }, at("2026-10-05T12:00:00")),
    null
  );
});

test("resolveNextSession picks the soonest of events and classes", () => {
  const result = resolveNextSession(
    {
      events: [
        { id: "e-far", title: "Far Event", starts_at: "2026-10-20T18:30:00.000Z", stage: "scheduled" },
        { id: "e-near", title: "Near Event", starts_at: "2026-10-06T18:30:00.000Z", stage: "scheduled" },
        { id: "e-past", title: "Past Event", starts_at: "2026-10-01T18:30:00.000Z", stage: "scheduled" },
        { id: "e-done", title: "Done Event", starts_at: "2026-10-02T18:30:00.000Z", stage: "done" },
      ],
      classSessions: [
        { title: "Weekly Class", group_name: "Crypto", weekday: 4, start_time: "21:00", is_active: true },
      ],
    },
    at("2026-10-05T12:00:00")
  );
  assert.equal(result.title, "Near Event");
  assert.equal(result.kind, "event");
});

test("resolveNextSession falls back to a class when no event is pending", () => {
  const result = resolveNextSession(
    {
      events: [],
      classSessions: [{ title: "Weekly Class", weekday: 2, start_time: "21:00", is_active: true }],
    },
    at("2026-10-05T12:00:00")
  );
  assert.equal(result.title, "Weekly Class");
  assert.equal(result.kind, "class");
});

test("resolveNextSession returns null when there is nothing ahead", () => {
  assert.equal(resolveNextSession({ events: [], classSessions: [] }, at("2026-10-05T12:00:00")), null);
});

test("resolveNextSession tolerates being called with no arguments", () => {
  assert.equal(typeof resolveNextSession(), "object");
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test`
Expected: FAIL — `Cannot find module .../js/lib/schedule.js`.

- [ ] **Step 3: Implement**

`js/lib/schedule.js`:

```js
/*
 * js/lib/schedule.js
 * ------------------------------------------------------------------
 * Weekly class schedule and "what is next" resolution.
 *
 * `weekday` uses the same convention as JavaScript's Date.getDay():
 * 0 = Sunday ... 6 = Saturday, so no conversion is needed anywhere
 * in the client or the admin panel.
 *
 * TIMEZONE: the candidate is built in the *viewer's* local zone, so a
 * recurring 21:00 session shows as 21:00 to whoever looks at it. That
 * is the right behaviour for a community that spans zones, but it does
 * mean the `class_sessions.timezone` column records intent rather than
 * converting the time. Do not add a timezone conversion here without
 * also changing what the public page displays — a visitor in Berlin
 * should not see a 21:00 IST session silently become 18:00.
 * ------------------------------------------------------------------
 */

/**
 * The next wall-clock time a recurring session runs, strictly after `now`.
 * @returns {Date|null} null when the session is inactive or malformed
 */
export function nextOccurrence(session, now = new Date()) {
  if (!session || session.is_active === false) return null;

  const m = /^(\d{1,2}):(\d{2})/.exec(String(session.start_time || ""));
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;

  const nowMs = new Date(now).getTime();
  if (Number.isNaN(nowMs)) return null;

  // Eight days covers a full week plus today, so a slot that already
  // passed today still finds its next occurrence.
  for (let offset = 0; offset < 8; offset++) {
    const day = new Date(now);
    day.setDate(day.getDate() + offset);
    if (day.getDay() !== session.weekday) continue;

    const candidate = new Date(day);
    candidate.setHours(hours, minutes, 0, 0);
    if (candidate.getTime() > nowMs) return candidate;
  }
  return null;
}

/**
 * The soonest thing happening next, across one-off events and the
 * recurring class schedule.
 * @returns {{kind:"event"|"class",title:string,group:?string,at:Date}|null}
 */
export function resolveNextSession({ events = [], classSessions = [] } = {}, now = new Date()) {
  const candidates = [];
  const nowMs = new Date(now).getTime();

  for (const event of events || []) {
    if (!event || event.stage === "done") continue;
    const at = new Date(event.starts_at).getTime();
    if (Number.isNaN(at) || at <= nowMs) continue;
    candidates.push({
      kind: "event",
      title: event.title,
      group: event.group_name || null,
      at: new Date(at),
    });
  }

  for (const session of classSessions || []) {
    const at = nextOccurrence(session, now);
    if (at) {
      candidates.push({
        kind: "class",
        title: session.title,
        group: session.group_name || null,
        at,
      });
    }
  }

  candidates.sort((a, b) => a.at.getTime() - b.at.getTime());
  return candidates[0] || null;
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npm test`
Expected: all tests pass — 10 from `derive.test.js` plus 9 here.

- [ ] **Step 5: Commit**

```bash
git add js/lib/schedule.js js/lib/schedule.test.js
git commit -m "feat(lib): weekly schedule recurrence and next-session resolution"
```

### Task 1.3: `formatCountdown`

**Files:**
- Create: `js/lib/countdown.js`
- Test: `js/lib/countdown.test.js`

- [ ] **Step 1: Write the failing test**

`js/lib/countdown.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCountdown } from "./countdown.js";

const m = (minutes) => minutes * 60 * 1000;

test("days, hours and minutes", () => {
  assert.equal(formatCountdown(m(60 * 24 * 2 + 60 * 4 + 13)), "2d 04h 13m");
});

test("hours and minutes when under a day", () => {
  assert.equal(formatCountdown(m(60 * 5 + 7)), "5h 07m");
});

test("minutes and seconds when under an hour", () => {
  assert.equal(formatCountdown(m(42)), "42m 00s");
});

test("seconds tick down within the final minute", () => {
  assert.equal(formatCountdown(45 * 1000), "0m 45s");
});

test("zero is padded", () => {
  assert.equal(formatCountdown(0), "0m 00s");
});

test("negative counts as zero rather than rendering backwards", () => {
  assert.equal(formatCountdown(-5000), "0m 00s");
});

test("a full day minus one second never renders as a whole day", () => {
  assert.equal(formatCountdown(m(60 * 24) - 1000), "23h 59m");
});

test("exactly one day renders with a day segment", () => {
  assert.equal(formatCountdown(m(60 * 24)), "1d 00h 00m");
});

test("a non-numeric input degrades to zero rather than NaN", () => {
  assert.equal(formatCountdown("nonsense"), "0m 00s");
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test`
Expected: FAIL — cannot find `countdown.js`.

- [ ] **Step 3: Implement**

`js/lib/countdown.js`:

```js
/*
 * js/lib/countdown.js
 * ------------------------------------------------------------------
 * Human-readable time remaining. Pure, so the exact string the page
 * shows is unit tested rather than eyeballed.
 * ------------------------------------------------------------------
 */

const SECOND_MS = 1000;

const pad = (n) => String(n).padStart(2, "0");

/**
 * @param {number} ms Milliseconds remaining. Negative is treated as zero.
 * @returns {string} e.g. "2d 04h 13m", "5h 07m", or "0m 45s"
 */
export function formatCountdown(ms) {
  const numeric = Number(ms);
  const total = Math.max(0, Math.floor((Number.isFinite(numeric) ? numeric : 0) / SECOND_MS));

  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (days > 0) return `${days}d ${pad(hours)}h ${pad(minutes)}m`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  return `${minutes}m ${pad(seconds)}s`;
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npm test`
Expected: 9 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add js/lib/countdown.js js/lib/countdown.test.js
git commit -m "feat(lib): countdown formatting"
```

### Task 1.4: `partitionEvents` — upcoming vs past

**Files:**
- Create: `js/lib/events-view.js`
- Test: `js/lib/events-view.test.js`

- [ ] **Step 1: Write the failing test**

`js/lib/events-view.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { partitionEvents, groupNames, filterByGroup } from "./events-view.js";

const NOW = new Date("2026-10-07T12:00:00.000Z");

const ev = (id, starts_at, extra = {}) => ({
  id,
  title: id,
  starts_at,
  duration_minutes: 60,
  stage: "scheduled",
  group_name: "Crypto",
  ...extra,
});

test("upcoming sorts ascending and past sorts descending", () => {
  const { upcoming, past } = partitionEvents(
    [
      ev("middle", "2026-10-07T18:00:00.000Z"),
      ev("latest", "2026-10-09T18:00:00.000Z"),
      ev("recent-past", "2026-10-06T18:00:00.000Z"),
      ev("old-past", "2026-09-01T18:00:00.000Z"),
    ],
    NOW
  );
  assert.deepEqual(upcoming.map((e) => e.id), ["middle", "latest"]);
  assert.deepEqual(past.map((e) => e.id), ["recent-past", "old-past"]);
});

test("each event carries its derived display state", () => {
  const { upcoming, past } = partitionEvents(
    [ev("soon", "2026-10-07T18:00:00.000Z"), ev("ago", "2026-10-01T18:00:00.000Z")],
    NOW
  );
  assert.equal(upcoming[0].display_state, "upcoming");
  assert.equal(past[0].display_state, "finished");
});

test("a currently running event is live and lands in upcoming", () => {
  const { upcoming, past } = partitionEvents(
    [ev("running", "2026-10-07T12:00:00.000Z")],
    NOW
  );
  assert.equal(upcoming[0].display_state, "live");
  assert.equal(past.length, 0);
});

test("a cancelled future event lands in past because it is done", () => {
  const { upcoming, past } = partitionEvents(
    [ev("cancelled", "2026-11-01T18:00:00.000Z", { stage: "done" })],
    NOW
  );
  assert.equal(upcoming.length, 0);
  assert.equal(past[0].id, "cancelled");
});

test("the input array is not mutated", () => {
  const input = [ev("b", "2026-10-01T18:00:00.000Z"), ev("a", "2026-10-08T18:00:00.000Z")];
  const snapshot = input.map((e) => e.id);
  partitionEvents(input, NOW);
  assert.deepEqual(input.map((e) => e.id), snapshot);
});

test("group names are unique, non-empty, and sorted", () => {
  const names = groupNames([
    { group_name: "Crypto" },
    { group_name: "Graphics" },
    { group_name: "Crypto" },
    { group_name: null },
    { group_name: "" },
    { group_name: "   " },
  ]);
  assert.deepEqual(names, ["Crypto", "Graphics"]);
});

test("filtering by group keeps only that group", () => {
  const items = [
    ev("a", "2026-10-08T18:00:00.000Z"),
    ev("b", "2026-10-08T18:00:00.000Z", { group_name: "Graphics" }),
  ];
  assert.deepEqual(filterByGroup(items, "Graphics").map((e) => e.id), ["b"]);
});

test("filtering by All returns everything", () => {
  const items = [
    ev("a", "2026-10-08T18:00:00.000Z"),
    ev("b", "2026-10-08T18:00:00.000Z", { group_name: "Graphics" }),
  ];
  assert.equal(filterByGroup(items, "All").length, 2);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test`
Expected: FAIL — cannot find `events-view.js`.

- [ ] **Step 3: Implement**

`js/lib/events-view.js`:

```js
/*
 * js/lib/events-view.js
 * ------------------------------------------------------------------
 * Turns a flat list of event rows into what the Events section
 * renders: an ascending Upcoming list, a descending Past list, and
 * the set of group names to build filter chips from.
 * ------------------------------------------------------------------
 */

import { deriveEventState } from "./derive.js";

/**
 * @returns {{upcoming: object[], past: object[]}} each item gains
 *   `display_state` of "upcoming" | "live" | "finished"
 */
export function partitionEvents(events = [], now = new Date()) {
  const upcoming = [];
  const past = [];

  for (const event of events || []) {
    if (!event) continue;
    const item = {
      ...event,
      display_state: deriveEventState(now, event.starts_at, event.duration_minutes, event.stage),
    };
    if (item.display_state === "finished") past.push(item);
    else upcoming.push(item);
  }

  const byStart = (a, b) => new Date(a.starts_at) - new Date(b.starts_at);
  upcoming.sort(byStart);
  past.sort((a, b) => -byStart(a, b));

  return { upcoming, past };
}

/** Distinct, non-blank group names, alphabetically sorted. */
export function groupNames(items = []) {
  const names = (items || [])
    .map((item) => item && item.group_name)
    .filter((name) => name && String(name).trim())
    .map((name) => String(name).trim());
  return [...new Set(names)].sort();
}

/** @param {string} group "All" or an exact group name */
export function filterByGroup(items = [], group) {
  if (!group || group === "All") return items || [];
  return (items || []).filter((item) => item && item.group_name === group);
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npm test`
Expected: 8 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add js/lib/events-view.js js/lib/events-view.test.js
git commit -m "feat(lib): partition events into upcoming and past"
```

### Task 1.5: `buildICS` — calendar subscribe

**Files:**
- Create: `js/lib/ics.js`
- Test: `js/lib/ics.test.js`

- [ ] **Step 1: Write the failing test**

`js/lib/ics.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildICS } from "./ics.js";

const NOW = new Date("2026-09-28T00:00:00.000Z");

const EVENTS = [
  {
    id: "abc-123",
    title: "Explain-3 Session",
    details: "A study session; bring questions.",
    starts_at: "2026-10-05T18:30:00.000Z",
    duration_minutes: 90,
    link: "https://discord.gg/97BAafVesn",
  },
];

test("emits a valid VCALENDAR envelope with CRLF line endings", () => {
  const ics = buildICS(EVENTS, { now: NOW });
  const lines = ics.split("\r\n");
  assert.equal(lines[0], "BEGIN:VCALENDAR");
  assert.equal(lines[lines.length - 1], "END:VCALENDAR");
  assert.ok(lines.includes("VERSION:2.0"));
});

test("converts a timestamp to a UTC DTSTART with a Z suffix", () => {
  assert.ok(buildICS(EVENTS, { now: NOW }).includes("DTSTART:20261005T183000Z"));
});

test("DTEND reflects duration_minutes", () => {
  assert.ok(buildICS(EVENTS, { now: NOW }).includes("DTEND:20261005T200000Z"));
});

test("DTEND defaults to 60 minutes when duration is missing", () => {
  const ics = buildICS([{ id: "x", title: "No Duration", starts_at: "2026-10-05T18:30:00.000Z" }], {
    now: NOW,
  });
  assert.ok(ics.includes("DTEND:20261005T193000Z"));
});

test("escapes commas, semicolons, backslashes and newlines in text", () => {
  const ics = buildICS(
    [{ id: "e", title: "A, B; C \\ D\nline two", starts_at: "2026-10-05T18:30:00.000Z" }],
    { now: NOW }
  );
  assert.ok(ics.includes("SUMMARY:A\\, B\\; C \\\\ D\\nline two"), ics);
});

test("UID is unique per event id", () => {
  assert.ok(buildICS(EVENTS, { now: NOW }).includes("UID:abc-123@freecodesyndicate"));
});

test("folds long lines to 75 octets so clients accept them", () => {
  const ics = buildICS(
    [{ id: "long", title: "T".repeat(200), starts_at: "2026-10-05T18:30:00.000Z" }],
    { now: NOW }
  );
  for (const line of ics.split("\r\n")) {
    assert.ok(Buffer.byteLength(line, "utf8") <= 75, `line too long: ${line.length}`);
  }
});

test("an empty event list still yields a valid calendar", () => {
  const ics = buildICS([], { now: NOW });
  assert.ok(ics.startsWith("BEGIN:VCALENDAR"));
  assert.ok(!ics.includes("BEGIN:VEVENT"));
});

test("rows with no usable start time are skipped, not emitted broken", () => {
  const ics = buildICS([{ id: "bad", title: "No Date" }], { now: NOW });
  assert.ok(!ics.includes("BEGIN:VEVENT"));
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test`
Expected: FAIL — cannot find `ics.js`.

- [ ] **Step 3: Implement**

`js/lib/ics.js`:

```js
/*
 * js/lib/ics.js
 * ------------------------------------------------------------------
 * RFC 5545 calendar text, generated in the browser. No server, no
 * account, no tracking pixel. Timestamps are emitted in UTC so the
 * calendar client needs no timezone database of its own.
 * ------------------------------------------------------------------
 */

const SECOND_MS = 1000;

/** UTF-8 byte length. Not Buffer — this module runs in the browser. */
function utf8Len(text) {
  return new TextEncoder().encode(text).length;
}

/** 2026-10-05T18:30:00.000Z -> 20261005T183000Z */
function stamp(date) {
  return new Date(date).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeText(value) {
  return String(value == null ? "" : value)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** RFC 5545 requires content lines no longer than 75 octets. */
function fold(line) {
  if (utf8Len(line) <= 75) return line;

  const chunks = [];
  let current = "";
  let currentBytes = 0;

  for (const ch of line) {
    // Continuation lines lose one octet to their leading space.
    const limit = chunks.length === 0 ? 75 : 74;
    const size = utf8Len(ch);
    if (currentBytes + size > limit) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += ch;
    currentBytes += size;
  }
  if (current) chunks.push(current);

  return chunks.map((chunk, i) => (i === 0 ? chunk : " " + chunk)).join("\r\n");
}

/**
 * @param {object[]} events rows with id, title, details, starts_at,
 *   duration_minutes, group_name, link
 * @param {{calendarName?:string, now?:Date}} options `now` is injectable for tests
 * @returns {string} VCALENDAR text
 */
export function buildICS(events = [], { calendarName = "FCS Events", now = new Date() } = {}) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//The Free Code Syndicate//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];

  for (const event of events || []) {
    if (!event || !event.starts_at) continue;
    const start = new Date(event.starts_at);
    if (Number.isNaN(start.getTime())) continue;

    const parsed = Number(event.duration_minutes);
    const duration = Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
    const end = new Date(start.getTime() + duration * 60 * SECOND_MS);

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${event.id || start.getTime()}@freecodesyndicate`);
    lines.push(`DTSTAMP:${stamp(now)}`);
    lines.push(`DTSTART:${stamp(start)}`);
    lines.push(`DTEND:${stamp(end)}`);
    lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (event.details) lines.push(`DESCRIPTION:${escapeText(event.details)}`);
    if (event.group_name) lines.push(`CATEGORIES:${escapeText(event.group_name)}`);
    if (event.link) lines.push(`URL:${event.link}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n");
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npm test`
Expected: 9 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add js/lib/ics.js js/lib/ics.test.js
git commit -m "feat(lib): generate RFC 5545 calendar files client-side"
```

### Task 1.6: `splitRepos` — Resources vs Projects

**Files:**
- Create: `js/lib/repos.js`
- Test: `js/lib/repos.test.js`

- [ ] **Step 1: Write the failing test**

`js/lib/repos.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitRepos } from "./repos.js";

const repo = (name) => ({ name, description: "", updated_at: "2026-09-01T00:00:00Z" });

test("an uncategorised repo defaults to project", () => {
  const { projects, resources } = splitRepos([repo("alpha")], []);
  assert.deepEqual(projects.map((r) => r.name), ["alpha"]);
  assert.equal(resources.length, 0);
});

test("a repo marked resource is pulled out of projects", () => {
  const { projects, resources } = splitRepos(
    [repo("alpha"), repo("notes")],
    [{ repo_name: "notes", kind: "resource" }]
  );
  assert.deepEqual(projects.map((r) => r.name), ["alpha"]);
  assert.deepEqual(resources.map((r) => r.name), ["notes"]);
});

test("a repo marked project explicitly stays in projects", () => {
  const { projects, resources } = splitRepos([repo("alpha")], [
    { repo_name: "alpha", kind: "project" },
  ]);
  assert.deepEqual(projects.map((r) => r.name), ["alpha"]);
  assert.equal(resources.length, 0);
});

test("classification is case sensitive on repo name, matching GitHub", () => {
  const { projects, resources } = splitRepos([repo("Notes")], [
    { repo_name: "notes", kind: "resource" },
  ]);
  assert.deepEqual(projects.map((r) => r.name), ["Notes"]);
  assert.equal(resources.length, 0);
});

test("a curated entry for a repo that no longer exists is ignored", () => {
  const { projects, resources } = splitRepos([repo("alpha")], [
    { repo_name: "deleted-repo", kind: "resource" },
  ]);
  assert.equal(projects.length, 1);
  assert.equal(resources.length, 0);
});

test("the curated note is carried onto the resource for display", () => {
  const { resources } = splitRepos([repo("notes")], [
    { repo_name: "notes", kind: "resource", note: "Start here" },
  ]);
  assert.equal(resources[0].curated_note, "Start here");
});

test("handles null and undefined inputs", () => {
  assert.deepEqual(splitRepos(null, null), { projects: [], resources: [] });
  assert.deepEqual(splitRepos(undefined, undefined), { projects: [], resources: [] });
});

test("an unnamed repo row is skipped rather than rendered blank", () => {
  const { projects, resources } = splitRepos([{ description: "orphan" }], []);
  assert.equal(projects.length, 0);
  assert.equal(resources.length, 0);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test`
Expected: FAIL — cannot find `repos.js`.

- [ ] **Step 3: Implement**

`js/lib/repos.js`:

```js
/*
 * js/lib/repos.js
 * ------------------------------------------------------------------
 * Separates the live GitHub repository list into Projects and
 * Resources. A repo is a Project unless a maintainer has explicitly
 * curated it as a Resource, so a newly pushed repo appears on its own
 * with no CMS involvement.
 * ------------------------------------------------------------------
 */

/**
 * @param {object[]} repos rows from the GitHub API
 * @param {object[]} kinds rows from the `repo_kinds` table
 * @returns {{projects: object[], resources: object[]}} resources carry
 *   an added `curated_note` property
 */
export function splitRepos(repos = [], kinds = []) {
  const curated = new Map();
  for (const kind of kinds || []) {
    if (kind && kind.repo_name) curated.set(kind.repo_name, kind);
  }

  const projects = [];
  const resources = [];

  for (const repo of repos || []) {
    if (!repo || !repo.name) continue;
    const entry = curated.get(repo.name);
    if (entry && entry.kind === "resource") {
      resources.push({ ...repo, curated_note: entry.note || "" });
    } else {
      projects.push(repo);
    }
  }

  return { projects, resources };
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npm test`
Expected: 8 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add js/lib/repos.js js/lib/repos.test.js
git commit -m "feat(lib): split repositories into projects and resources"
```

### Task 1.7: `config.js`, `supabase.js`, and `schema.sql`

**Files:**
- Create: `js/config.js`
- Create: `js/supabase.js`
- Create: `supabase/schema.sql`

No unit tests — this is I/O wiring. It is verified in Phase 4 (seed fallback) and Phase 5 (live RLS checks).

- [ ] **Step 1: Create `js/config.js`**

```js
/*
 * js/config.js
 * ------------------------------------------------------------------
 * The Supabase ANON key is designed to be public and is safe to
 * commit. It is NOT the service-role key. All real authorisation
 * happens in Postgres via Row Level Security — see supabase/schema.sql.
 *
 * To connect a real project: create a free project at supabase.com,
 * run supabase/schema.sql in its SQL editor, then paste the two values
 * below. Leave them blank and the site runs entirely from seed data.
 * ------------------------------------------------------------------
 */
window.FCS_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",

  communityName: "The Free Code Syndicate",

  // Weekday select order. Matches JavaScript Date.getDay().
  weekdays: [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ],

  defaultTimezone: "Asia/Kolkata",
};
```

- [ ] **Step 2: Create `js/supabase.js`**

```js
/*
 * js/supabase.js
 * ------------------------------------------------------------------
 * The only module that talks to Supabase. Every function is a narrow,
 * named operation — the UI never receives a query builder, so there
 * is exactly one place to audit.
 *
 * The site never hard-depends on the database: every public read
 * falls back to the seed data in data.js.
 * ------------------------------------------------------------------
 */

/** @returns {boolean} whether a project has been configured */
export function isConfigured() {
  const config = window.FCS_CONFIG || {};
  return Boolean(config.supabaseUrl && config.supabaseAnonKey);
}

let client = null;

/** @returns {object|null} the vendored Supabase client, or null if unconfigured */
export function getClient() {  if (client) return client;
  if (!isConfigured()) return null;
  const factory = window.supabase && window.supabase.createClient;
  if (!factory) return null;
  client = factory(window.FCS_CONFIG.supabaseUrl, window.FCS_CONFIG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return client;
}

/** @returns {object} the client, or throws if the project is not configured */
export function getClientOrThrow() {
  const supabase = getClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

/** Named in the spec's data-flow diagram. Idempotent. */
export function connect() {
  return getClient();
}

async function readTable(table, order = "sort_order") {
  const supabase = getClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from(table).select("*").order(order);
  if (error) throw error;
  return data || [];
}

/* ---- public reads: fall back to seed data on any failure ----------
 *
 * The `|| fallback` must be applied BEFORE filtering. `readTable`
 * returns null when Supabase is unconfigured, and `null.filter` would
 * throw while `([]).filter` would silently return an empty section —
 * either way the seed data would be lost.
 * ------------------------------------------------------------------ */

export async function getEvents(fallback) {
  try {
    return (await readTable("events", "starts_at")) || fallback || [];
  } catch {
    return fallback || [];
  }
}

export async function getClassSessions(fallback) {
  try {
    return (await readTable("class_sessions")) || fallback || [];
  } catch {
    return fallback || [];
  }
}

export async function getResources(fallback) {
  try {
    return ((await readTable("resources")) || fallback || []).filter(
      (r) => r.is_published !== false
    );
  } catch {
    return fallback || [];
  }
}

export async function getStudyGroups(fallback) {
  try {
    return ((await readTable("study_groups")) || fallback || []).filter(
      (g) => g.is_published !== false
    );
  } catch {
    return fallback || [];
  }
}

export async function getSocialLinks(fallback) {
  try {
    return ((await readTable("social_links")) || fallback || []).filter(
      (l) => l.is_published !== false
    );
  } catch {
    return fallback || [];
  }
}

export async function getRepoKinds() {
  try {
    return (await readTable("repo_kinds", "repo_name")) || [];
  } catch {
    return [];
  }
}

/* ---- auth --------------------------------------------------------- */

export async function getSession() {
  const supabase = getClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return (data && data.session) || null;
}

export async function signIn(email, password) {
  const { data, error } = await getClientOrThrow().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

export async function signOut() {
  const supabase = getClient();
  if (supabase) await supabase.auth.signOut();
}

/** @returns {Promise<"admin"|"editor"|null>} */
export async function getRole(userId) {
  const supabase = getClient();
  if (!supabase || !userId) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (error) return null;
  return (data && data.role) || null;
}

/* ---- admin writes --------------------------------------------------
 *
 * These are named per table rather than a generic insertRow(table,
 * row). Naming them means the UI cannot address a table it should not
 * touch, and there is one place to audit when a schema changes.
 * `repo_kinds` is keyed by repo_name, not id, so it gets its own pair.
 * ------------------------------------------------------------------ */

async function write(operation) {
  const { data, error } = await operation(getClientOrThrow());
  if (error) throw error;
  return data;
}

export const createEvent = (patch) =>
  write((s) => s.from("events").insert(patch).select().single());

export const updateEvent = (id, patch) =>
  write((s) => s.from("events").update(patch).eq("id", id).select().single());

export const deleteEvent = (id) => write((s) => s.from("events").delete().eq("id", id).select());

export const createClassSession = (patch) =>
  write((s) => s.from("class_sessions").insert(patch).select().single());

export const updateClassSession = (id, patch) =>
  write((s) => s.from("class_sessions").update(patch).eq("id", id).select().single());

export const deleteClassSession = (id) =>
  write((s) => s.from("class_sessions").delete().eq("id", id).select());

export const createResource = (patch) =>
  write((s) => s.from("resources").insert(patch).select().single());

export const updateResource = (id, patch) =>
  write((s) => s.from("resources").update(patch).eq("id", id).select().single());

export const deleteResource = (id) =>
  write((s) => s.from("resources").delete().eq("id", id).select());

export const createStudyGroup = (patch) =>
  write((s) => s.from("study_groups").insert(patch).select().single());

export const updateStudyGroup = (id, patch) =>
  write((s) => s.from("study_groups").update(patch).eq("id", id).select().single());

export const deleteStudyGroup = (id) =>
  write((s) => s.from("study_groups").delete().eq("id", id).select());

export const createSocialLink = (patch) =>
  write((s) => s.from("social_links").insert(patch).select().single());

export const updateSocialLink = (id, patch) =>
  write((s) => s.from("social_links").update(patch).eq("id", id).select().single());

export const deleteSocialLink = (id) =>
  write((s) => s.from("social_links").delete().eq("id", id).select());

export const saveRepoKind = (row) =>
  write((s) => s.from("repo_kinds").upsert(row, { onConflict: "repo_name" }).select().single());

export const deleteRepoKind = (repoName) =>
  write((s) => s.from("repo_kinds").delete().eq("repo_name", repoName).select());
```

- [ ] **Step 3: Create `supabase/schema.sql`**

```sql
-- supabase/schema.sql
-- The Free Code Syndicate — schema, Row Level Security, and seed data.
-- Run this once in the Supabase SQL editor of a fresh project.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- tables

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  role         text not null default 'editor' check (role in ('admin','editor')),
  created_at   timestamptz not null default now()
);

create table if not exists public.events (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  group_name       text,
  details          text,
  starts_at        timestamptz not null,
  duration_minutes integer not null default 60,
  stage            text not null default 'draft' check (stage in ('draft','scheduled','live','done')),
  link             text,
  link_text        text,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists events_starts_at_idx on public.events (starts_at);
create index if not exists events_stage_idx on public.events (stage);

create table if not exists public.class_sessions (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  group_name       text,
  weekday          integer not null check (weekday between 0 and 6),
  start_time       time not null,
  duration_minutes integer not null default 60,
  timezone         text not null default 'Asia/Kolkata',
  link             text,
  is_active        boolean not null default true,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.resources (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  kind         text not null default 'notes' check (kind in ('notes','video','paper','course','tool','book')),
  url          text not null,
  summary      text,
  group_name   text,
  sort_order   integer not null default 0,
  is_published boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.study_groups (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  topic        text not null,
  status       text not null default 'Forming' check (status in ('Active','Forming','Paused','Completed')),
  link         text,
  link_text    text,
  sort_order   integer not null default 0,
  is_published boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.social_links (
  id           uuid primary key default gen_random_uuid(),
  platform     text not null default 'web' check (platform in ('discord','instagram','whatsapp','github','x','web')),
  label        text not null,
  url          text not null,
  hint         text,
  sort_order   integer not null default 0,
  is_published boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Curated classification of the live GitHub list, keyed by repo name.
-- A repo absent from this table is a Project by default.
create table if not exists public.repo_kinds (
  repo_name  text primary key,
  kind       text not null default 'project' check (kind in ('project','resource')),
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -------------------------------------------------------------- triggers

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['events','class_sessions','resources','study_groups','social_links','repo_kinds']
  loop
    execute format(
      'drop trigger if exists touch_%1$s on public.%1$s;', t);
    execute format(
      'create trigger touch_%1$s before update on public.%1$s
       for each row execute function public.touch_updated_at();', t);
  end loop;
end $$;

-- Every new signup gets an editor profile; the first account is promoted by hand.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------ RLS helper

create or replace function public.current_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'anon');
$$;

-- ------------------------------------------------------------------- RLS

alter table public.profiles       enable row level security;
alter table public.events         enable row level security;
alter table public.class_sessions enable row level security;
alter table public.resources      enable row level security;
alter table public.study_groups   enable row level security;
alter table public.social_links   enable row level security;
alter table public.repo_kinds     enable row level security;

-- profiles: a user may read their own row; admins may read all.
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select
  using (id = auth.uid() or public.current_role() = 'admin');

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update
  using (id = auth.uid() or public.current_role() = 'admin');

-- Content tables share four rules: public read, editor write, admin delete.
do $$
declare t text;
begin
  foreach t in array array['events','class_sessions','resources','study_groups','social_links']
  loop
    execute format('drop policy if exists "public read" on public.%1$I;', t);
    execute format('create policy "public read" on public.%1$I for select using (true);', t);

    execute format('drop policy if exists "editors insert" on public.%1$I;', t);
    execute format('create policy "editors insert" on public.%1$I for insert to authenticated
      with check (public.current_role() in (''admin'',''editor''));', t);

    execute format('drop policy if exists "editors update" on public.%1$I;', t);
    execute format('create policy "editors update" on public.%1$I for update to authenticated
      using (public.current_role() in (''admin'',''editor''))
      with check (public.current_role() in (''admin'',''editor''));', t);

    execute format('drop policy if exists "admins delete" on public.%1$I;', t);
    execute format('create policy "admins delete" on public.%1$I for delete to authenticated
      using (public.current_role() = ''admin'');', t);
  end loop;
end $$;

-- repo_kinds: public read, editor write, admin delete.
drop policy if exists "public read" on public.repo_kinds;
create policy "public read" on public.repo_kinds for select using (true);

drop policy if exists "editors insert" on public.repo_kinds;
create policy "editors insert" on public.repo_kinds for insert to authenticated
  with check (public.current_role() in ('admin','editor'));

drop policy if exists "editors update" on public.repo_kinds;
create policy "editors update" on public.repo_kinds for update to authenticated
  using (public.current_role() in ('admin','editor'))
  with check (public.current_role() in ('admin','editor'));

drop policy if exists "admins delete" on public.repo_kinds;
create policy "admins delete" on public.repo_kinds for delete to authenticated
  using (public.current_role() = 'admin');

-- ------------------------------------------------------------ seed data

insert into public.social_links (platform, label, url, hint, sort_order) values
  ('discord',   'Discord Server',     'https://discord.gg/97BAafVesn', 'Study rooms, voice rooms, and code help.', 1),
  ('instagram', 'Instagram',          'https://www.instagram.com/freecodesyndicate/', 'Posters, notes, and session announcements.', 2),
  ('whatsapp',  'WhatsApp Community', 'https://chat.whatsapp.com/Dks4VUe0E5n7xmilaKTqXS', 'Daily messages and notices.', 3),
  ('github',    'GitHub Organization','https://github.com/TheFreeCodeSyndicate', 'Public repositories and the work record.', 4);

insert into public.study_groups (name, topic, status, link, link_text, sort_order) values
  ('Crypto Study Group', 'Study cryptography from first principles. Prove before you trust.', 'Completed',
   'https://github.com/TheFreeCodeSyndicate/CRYPTO_STUDY_GROUP', 'Check the repository', 1),
  ('Systems Reading Room', 'Read operating systems, networks, compilers, and the machine layer below user programs.', 'Forming',
   'https://discord.gg/97BAafVesn', 'Help form the room', 2),
  ('Anti Aliasing: A Computer Graphics Study Group', 'Study computer graphics from first principles. Learn to render, shade, and animate.', 'Forming',
   'https://github.com/TheFreeCodeSyndicate/anti-aliasing', 'Read the repositories', 3);

insert into public.events (title, group_name, details, starts_at, duration_minutes, stage, link, link_text, sort_order) values
  ('Explain-3 Session', 'Crypto Study Group', 'A study session for the next Explain track discussion.',
   '2026-07-28T15:30:00Z', 60, 'done', 'https://github.com/TheFreeCodeSyndicate/CRYPTO_STUDY_GROUP', 'Check the repository', 1),
  ('CryptoMeet-3 Session', 'Crypto Study Group', 'A meeting for discussing the PCSP project, DES and AES, and some public key cryptography.',
   '2026-08-04T15:30:00Z', 60, 'done', 'https://discord.gg/97BAafVesn', 'Join Discord', 2),
  ('Quantum Computing and PQC Session', 'Crypto Study Group', 'A meeting for discussing quantum computing and post-quantum cryptography.',
   '2026-08-09T15:30:00Z', 60, 'done', 'https://calendar.app.google/4agDYABbWPYyvWQc9', 'Add to Calendar', 3);

-- Promote the first account to admin. Run once, after signing up.
-- update public.profiles set role = 'admin' where email = 'you@example.com';
```

- [ ] **Step 4: Confirm nothing on the page changed**

Run: `npm run serve`, open `http://localhost:8000`.
Expected: the page renders exactly as before. No console errors, and no request to any `*.supabase.co` host.

- [ ] **Step 5: Commit**

```bash
git add js/config.js js/supabase.js supabase/schema.sql
git commit -m "feat: Supabase adapter and schema, lands unused"
```

---

# Phase 2 — Dark mode

Ships independently. Nothing from Phase 1 is required.

### Task 2.1: Design tokens

**Files:**
- Modify: `css/style.css`

Before writing these values, load the `better-ui` and `high-end-visual-design`
skills and apply their guidance to the palette and the type scale. The values
below are a working baseline that satisfies WCAG AA; the skills decide the final
result. **Whatever you choose, verify contrast for body text and for every text
colour on `--accent` and `--live` in both themes before signing off.**

- [ ] **Step 1: Replace the `:root` block with a token layer**

```css
/* ================================================================
   TOKENS
   Every colour in this stylesheet resolves through these variables.
   Adding a theme means adding one [data-theme] block — no other
   selector changes.
   ================================================================ */
:root {
  color-scheme: light;

  --paper:        #f6f4ef;
  --paper-raised: #fffefb;
  --ink:          #16150f;
  --ink-muted:    #55514a;
  --ink-faint:    #7d786e;
  --rule:         #d8d3c6;
  --rule-strong:  #16150f;

  --accent:       #1d4ed8;
  --accent-ink:   #ffffff;
  --accent-soft:  #e3e9fb;

  --live:         #b42318;
  --live-soft:    #fde8e6;
  --done:         #5f6b52;

  --mark:         #f2e3b3;

  --shadow: 0 1px 2px rgb(22 21 15 / 0.06), 0 8px 24px rgb(22 21 15 / 0.08);
  --radius: 2px;

  --font-mono: "Fira Code", ui-monospace, SFMono-Regular, Menlo, monospace;
}

[data-theme="dark"] {
  color-scheme: dark;

  --paper:        #0e0f0c;
  --paper-raised: #171914;
  --ink:          #ecebe4;
  --ink-muted:    #a8a49a;
  --ink-faint:    #8b867b;
  --rule:         #2e3029;
  --rule-strong:  #ecebe4;

  --accent:       #8ab4ff;
  --accent-ink:   #0e0f0c;
  --accent-soft:  #1c2436;

  --live:         #ff8f85;
  --live-soft:    #34191a;
  --done:         #9aa88a;

  --mark:         #4a3f18;

  --shadow: 0 1px 2px rgb(0 0 0 / 0.5), 0 8px 24px rgb(0 0 0 / 0.45);
}
```

- [ ] **Step 2: Map every existing token onto the new one — do not just delete**

The current `css/style.css` `:root` defines 15 custom properties, and the
stylesheet references them **204 times**. Replacing the block without remapping
the references leaves every one unresolved, so `body` loses its background and
every card loses its shadow. The site would still "work" and still pass a
casual glance, but it would be unstyled.

Rewrite the references first, then the block. Apply this mapping across the file:

| Old token | New token | Notes |
|-----------|-----------|-------|
| `--black` | `--ink` | the dominant one, 68 uses |
| `--white` | `--paper` | 17 uses |
| `--yellow` | `--accent` | 32 uses |
| `--yellow-deep` | `--accent` | 10 uses |
| `--yellow-pale` | `--mark` | 3 uses |
| `--gray` | `--ink-muted` | 11 uses |
| `--line` | `--rule` | |
| `--border-w` | keep as `--border-w` | non-colour, 21 uses |
| `--shadow-off` | keep as `--shadow-off` | non-colour, 22 uses |
| `--gap`, `--section-pad`, `--page-pad` | keep | non-colour, 18 uses total |
| `--cyan`, `--magenta` | `--accent` | 1 use each; drop the distinct values |

So the new `:root` must **retain** `--border-w --shadow-off --gap --section-pad
--page-pad`. Add them back into the Step 1 block:

```css
  /* non-colour tokens, carried over unchanged */
  --border-w: 1px;
  --shadow-off: 4px;
  --gap: 24px;
  --section-pad: 56px;
  --page-pad: 40px;
```

Note there is a **second `:root`** block inside `@media (max-width: 520px)` near
the end of the file. It overrides a few values at small widths and must be
remapped too.

Then replace the literal colours. Confirm none survive outside the token block:

```bash
grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(' css/style.css
```

Expected: roughly 32 matches, **all of them inside the `:root` and
`[data-theme="dark"]` blocks** (the two `--shadow` values are the only ones
outside a colour declaration). Any other match is a literal you missed — the
file currently has two stray `#333` values near the media query.

- [ ] **Step 3: Confirm no dangling references to removed tokens**

```bash
grep -nE 'var\(--(black|white|yellow|yellow-deep|yellow-pale|cyan|magenta|gray|line)\)' css/style.css
```

Expected: **no matches.** A match means a `var()` still points at a token you
renamed, and that declaration will silently fall back to its initial value.

- [ ] **Step 4: Commit**

```bash
git add css/style.css
git commit -m "refactor(css): introduce design token layer and remap legacy tokens"
```

### Task 2.2: The no-flash script and the toggle

**Files:**
- Modify: `index.html`
- Create: `js/theme.js`
- Modify: `css/style.css`

- [ ] **Step 1: Add the inline no-flash script to `index.html`**

Immediately after `<head>`, before the stylesheet link:

```html
    <script>
      /* Runs before first paint so the page never flashes the wrong theme. */
      (function () {
        try {
          var stored = localStorage.getItem("fcs-theme");
          document.documentElement.setAttribute(
            "data-theme",
            stored || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
          );
        } catch (e) {
          document.documentElement.setAttribute("data-theme", "light");
        }
      })();
    </script>
```

- [ ] **Step 2: Add the toggle button to the nav**

As the **last child** of `.doc-nav`, immediately after the closing `</ul>` of
`.nav-links`. The nav is `justify-content: space-between`, so "last child" puts
the button on the far right as the spec requires. Placing it before the
hamburger would strand it next to the brand on the left.

```html
    <button
      class="theme-toggle"
      id="theme-toggle"
      type="button"
      aria-pressed="false"
      aria-label="Switch to dark mode"
    >
      <span class="theme-toggle-icon" aria-hidden="true"></span>
    </button>
```

- [ ] **Step 3: Create `js/theme.js`**

A classic script, not a module, so it attaches independently of the module graph
and works on `admin.html` too.

```js
/*
 * js/theme.js
 * ------------------------------------------------------------------
 * The initial theme is already applied by the inline script in <head>.
 * This file only handles the toggle and keeps aria in sync.
 * ---------------------------------------------------------------- */
(function () {
  var STORAGE_KEY = "fcs-theme";

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") || "light";
  }

  function syncButton(theme) {
    var button = document.getElementById("theme-toggle");
    if (!button) return;
    var isDark = theme === "dark";
    button.setAttribute("aria-pressed", String(isDark));
    button.setAttribute("aria-label", "Switch to " + (isDark ? "light" : "dark") + " mode");
  }

  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    syncButton(theme);
  }

  window.FCSTheme = { apply: apply, current: currentTheme, toggle: function () {
    apply(currentTheme() === "dark" ? "light" : "dark");
  } };

  document.addEventListener("DOMContentLoaded", function () {
    var button = document.getElementById("theme-toggle");
    syncButton(currentTheme());
    if (!button) return;

    button.addEventListener("click", function () {
      var next = currentTheme() === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch (e) {
        /* storage unavailable — the theme still applies for this page view */
      }
      apply(next);
    });
  });
})();
```

- [ ] **Step 4: Style the toggle**

Append to `css/style.css`:

```css
/* --------------------------------------------------------- theme toggle */
.theme-toggle {
  display: inline-grid;
  place-items: center;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-raised);
  color: var(--ink);
  cursor: pointer;
  transition: border-color 140ms ease, background 140ms ease;
}
.theme-toggle:hover { border-color: var(--rule-strong); }
.theme-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.theme-toggle-icon::before { content: "\25CF"; font-size: 12px; }
[data-theme="dark"] .theme-toggle-icon::before { content: "\25D1"; }

@media (prefers-reduced-motion: reduce) {
  .theme-toggle { transition: none; }
}
```

- [ ] **Step 5: Register the script in `index.html`**

Add before `js/data.js`:

```html
  <script src="js/theme.js"></script>
```

- [ ] **Step 6: Verify both themes by hand**

Run: `npm run serve`, open `http://localhost:8000`.

1. Click the toggle — the page switches and `aria-pressed` flips.
2. Hard reload — the chosen theme persists.
3. DevTools → Rendering → Emulate `prefers-color-scheme: dark`, with
   `localStorage.clear()` in the console first. The page loads dark with **no
   flash**. Confirm by throttling the network to Slow 3G in the Network panel
   and reloading.
4. Set the emulation back to light with no stored value — the page loads light.
5. Tab to the toggle and press Enter — the theme changes via keyboard.

- [ ] **Step 7: Commit**

```bash
git add index.html css/style.css js/theme.js
git commit -m "feat: dark mode with token layer and no-flash application"
```

---

# Phase 3 — Navigation rework

### Task 3.1: Six links, no section markers

**Files:**
- Modify: `index.html` (the `.nav-links` list, and the repositories section)
- Modify: `js/main.js` (`setupScrollSpy`)

- [ ] **Step 1: Replace the ten nav links with six**

```html
    <ul class="nav-links" id="nav-links">
      <li><a href="#abstract" data-section="abstract">About</a></li>
      <li><a href="#projects" data-section="projects">Projects</a></li>
      <li><a href="#resources" data-section="resources">Resources</a></li>
      <li><a href="#study-groups" data-section="study-groups">Groups</a></li>
      <li><a href="#events" data-section="events">Events</a></li>
      <li><a href="#join" data-section="join">Join</a></li>
    </ul>
```

- [ ] **Step 2: Rename the repositories section to `projects` and add a resources section**

Change the existing section's id and heading, then insert a new Resources
section directly after it:

```html
    <section class="doc-section" id="projects">
      <h2><span class="sec-num">4</span> Projects</h2>
      <p class="sec-intro">
        Live from
        <a href="https://github.com/TheFreeCodeSyndicate" target="_blank" rel="noopener"
          >github.com/TheFreeCodeSyndicate</a
        >. The record follows the source — push a repository and it appears here.
      </p>

      <p id="repo-status" class="repo-status" role="status" aria-live="polite">
        Reading repository list<span class="cursor" aria-hidden="true">_</span>
      </p>

      <div id="repo-grid" class="repo-grid" hidden></div>
    </section>

    <div class="rule"></div>

    <!-- ========================================================
         RESOURCES — curated learning material, from the database.
         Distinct from Projects, which is the live GitHub list.
         ======================================================== -->
    <section class="doc-section" id="resources">
      <h2><span class="sec-num">5</span> Resources</h2>
      <p class="sec-intro">
        Notes, videos, papers, courses, and tools kept by the group. Curated by
        hand — everything here is meant to be read, not just skimmed.
      </p>

      <div id="resource-grid" class="resource-grid"></div>
    </section>
```

Then renumber the remaining section headings in `index.html`: Study Groups
becomes `6`, Events `7`, Contribution Lanes `8`, Maintainers `9`, Entry `10`.
The nav no longer shows these numbers, but the headings keep the RFC framing.

- [ ] **Step 3: Rewrite `setupScrollSpy` in `js/main.js`**

```js
function setupScrollSpy() {
  const navLinks = Array.from(document.querySelectorAll(".nav-links a"));
  if (!navLinks.length) return;

  const sections = navLinks
    .map((link) => document.getElementById(link.dataset.section))
    .filter(Boolean);
  if (!sections.length) return;

  const setActive = (id) => {
    navLinks.forEach((link) => {
      const active = link.dataset.section === id;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
  };

  const visible = new Set();
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      });

      // Prefer a visible section; otherwise fall back to the last one
      // scrolled past. The previous version let whichever callback fired
      // last win, which could leave zero links highlighted.
      const shown = sections.filter((s) => visible.has(s.id));
      if (shown.length) {
        setActive(shown[0].id);
        return;
      }
      const passed = sections.filter((s) => s.getBoundingClientRect().top < 0);
      setActive(passed.length ? passed[passed.length - 1].id : sections[0].id);
    },
    { rootMargin: "-45% 0px -45% 0px", threshold: 0 }
  );

  sections.forEach((section) => observer.observe(section));
}
```

- [ ] **Step 4: Verify by hand**

Run `npm run serve`, open `http://localhost:8000`.

1. Click each of the six links — each jumps to its section.
2. Scroll slowly top to bottom — exactly one link is active, and it changes as
   sections pass the middle of the viewport.
3. Resize to 380px wide — the hamburger menu opens and the six items fit without
   horizontal overflow.
4. Confirm no `§` character appears in the nav.

- [ ] **Step 5: Commit**

```bash
git add index.html js/main.js
git commit -m "feat: six-link navigation, resources section, and reliable scroll-spy"
```

---

# Phase 4 — Data-backed public sections

The site starts reading Supabase, with seed fallback. Fully functional with no
database.

### Task 4.1: Rename the seed arrays in `data.js`

**Files:**
- Modify: `js/data.js`

- [ ] **Step 1: Rename and mark the fallback arrays**

Rename `EVENTS` to `SEED_EVENTS`, `STUDY_GROUPS` to `SEED_STUDY_GROUPS`, and
`JOIN_LINKS` to `SEED_JOIN_LINKS`. Add a header comment:

```js
/*
 * js/data.js
 * ------------------------------------------------------------------
 * PRINCIPLES, CONTRIBUTION_LANES, and MAINTAINERS are fixed page copy
 * and live here permanently.
 *
 * The SEED_* arrays are a FALLBACK used only when Supabase is
 * unreachable or unconfigured. They are not the source of truth any
 * more — the database is. Edit content in the admin panel at /admin,
 * not in this file.
 * ------------------------------------------------------------------
 */
```

- [ ] **Step 2: Update the seed shapes to match the database columns**

Seed events must use the same field names as the `events` table, so the
renderers work identically against either source:

```js
const SEED_EVENTS = [
  {
    id: "seed-explain-3",
    title: "Explain-3 Session",
    group_name: "Crypto Study Group",
    details: "A study session for the next Explain track discussion.",
    starts_at: "2026-07-28T15:30:00.000Z",
    duration_minutes: 60,
    stage: "done",
    link: "https://github.com/TheFreeCodeSyndicate/CRYPTO_STUDY_GROUP",
    link_text: "Check the repository",
  },
  {
    id: "seed-cryptomeet-3",
    title: "CryptoMeet-3 Session",
    group_name: "Crypto Study Group",
    details: "A meeting for discussing the PCSP project, DES and AES, and some public key cryptography.",
    starts_at: "2026-08-04T15:30:00.000Z",
    duration_minutes: 60,
    stage: "done",
    link: "https://discord.gg/97BAafVesn",
    link_text: "Join Discord",
  },
  {
    id: "seed-pqc",
    title: "Quantum Computing and PQC Session",
    group_name: "Crypto Study Group",
    details: "A meeting for discussing quantum computing and post-quantum cryptography.",
    starts_at: "2026-08-09T15:30:00.000Z",
    duration_minutes: 60,
    stage: "done",
    link: "https://calendar.app.google/4agDYABbWPYyvWQc9",
    link_text: "Add to Calendar",
  },
];
```

Study groups become `link_text` (not `linkText`), and the dead Discord link is
replaced with `https://discord.gg/97BAafVesn`:

```js
const SEED_STUDY_GROUPS = [
  {
    name: "Crypto Study Group",
    topic: "Study cryptography from first principles. Prove before you trust.",
    status: "Completed",
    link: "https://github.com/TheFreeCodeSyndicate/CRYPTO_STUDY_GROUP",
    link_text: "Check the repository",
  },
  {
    name: "Systems Reading Room",
    topic: "Read operating systems, networks, compilers, and the machine layer below user programs.",
    status: "Forming",
    link: "https://discord.gg/97BAafVesn",
    link_text: "Help form the room",
  },
  {
    name: "Anti Aliasing: A Computer Graphics Study Group",
    topic: "Study computer graphics from first principles. Learn to render, shade, and animate.",
    status: "Forming",
    link: "https://github.com/TheFreeCodeSyndicate/anti-aliasing",
    link_text: "Read the repositories",
  },
];

const SEED_JOIN_LINKS = [
  {
    platform: "discord",
    label: "Discord Server",
    url: "https://discord.gg/97BAafVesn",
    hint: "Study rooms, voice rooms, and code help.",
  },
  {
    platform: "instagram",
    label: "Instagram",
    url: "https://www.instagram.com/freecodesyndicate/",
    hint: "Posters, notes, and session announcements.",
  },
  {
    platform: "whatsapp",
    label: "WhatsApp Community",
    url: "https://chat.whatsapp.com/Dks4VUe0E5n7xmilaKTqXS",
    hint: "Daily messages and notices.",
  },
  {
    platform: "github",
    label: "GitHub Organization",
    url: "https://github.com/TheFreeCodeSyndicate",
    hint: "Public repositories and the work record.",
  },
];

const SEED_RESOURCES = [
  {
    title: "CRYPTO_STUDY_GROUP",
    kind: "notes",
    url: "https://github.com/TheFreeCodeSyndicate/CRYPTO_STUDY_GROUP",
    summary: "Public study notes and exercises from the crypto track.",
    group_name: "Crypto Study Group",
  },
];

const SEED_REPO_KINDS = [];
```

- [ ] **Step 3: Delete the stale template comments and fix the field docs**

`data.js` currently ends `STUDY_GROUPS` and `EVENTS` with `// Add the next …`
comment blocks that contain the dead Discord link and the old field names.
Delete both comment blocks outright, and replace the per-array field
documentation with the real column names:

```js
/*
 * SEED_EVENTS — field names match the `events` table exactly:
 *   id               - stable id (real rows use a uuid)
 *   title            - event name
 *   group_name       - study group or room running it
 *   details          - one or two lines
 *   starts_at        - ISO 8601 timestamp, UTC
 *   duration_minutes - length of the live window
 *   stage            - "draft" | "scheduled" | "live" | "done"
 *   link             - optional join or calendar link
 *   link_text        - label for that link
 */

/*
 * SEED_STUDY_GROUPS — field names match the `study_groups` table:
 *   name, topic, status ("Active"|"Forming"|"Paused"|"Completed"),
 *   link, link_text
 */
```

- [ ] **Step 4: Expose the arrays on `window`**

`data.js` is a classic script, so its top-level `const`s are script-scoped, not
global. Add at the very bottom of the file:

```js
/* data.js is a CLASSIC script, so its top-level `const`s live in the
   global lexical environment — which a module (main.js) can NOT read.
   Everything main.js needs must be published on `window` explicitly. */
window.PRINCIPLES = PRINCIPLES;
window.CONTRIBUTION_LANES = CONTRIBUTION_LANES;
window.MAINTAINERS = MAINTAINERS;
window.GITHUB_ORG = GITHUB_ORG;
window.SEED_EVENTS = SEED_EVENTS;
window.SEED_STUDY_GROUPS = SEED_STUDY_GROUPS;
window.SEED_JOIN_LINKS = SEED_JOIN_LINKS;
window.SEED_RESOURCES = SEED_RESOURCES;
window.SEED_REPO_KINDS = SEED_REPO_KINDS;
```

- [ ] **Step 5: Confirm the dead Discord link is gone from the shipped tree**

```bash
grep -rn "nH2PRmbB5" index.html admin.html js css supabase
```

Expected: matches only in `index.html` (the References list, which this phase
empties in Task 4.2). The `js/` matches must now be zero. Do not include
`--include="*.md"` — the spec and this plan document both quote the old link
deliberately, as documentation of what was replaced.

- [ ] **Step 6: Commit**

```bash
git add js/data.js
git commit -m "refactor: rename data arrays to seed fallbacks, fix stale Discord link"
```

### Task 4.2: Add the countdown band markup

**Files:**
- Modify: `index.html` (the Events section)

- [ ] **Step 1: Rewrite the Events section**

```html
    <section class="doc-section" id="events">
      <h2><span class="sec-num">7</span> Events</h2>
      <p class="sec-intro">
        Study sessions, reading rooms, and group work. Status is worked out from
        each event's own time, so this list is never out of date.
      </p>

      <div class="next-band" id="next-session" data-mode="loading">
        <span class="mini-label">next session</span>
        <h3 data-next-title>Loading&hellip;</h3>
        <p class="next-group" data-next-group></p>
        <p data-next-when>&nbsp;</p>
        <p class="next-countdown" data-next-countdown aria-live="off">&nbsp;</p>
      </div>

      <div class="event-toolbar">
        <div class="event-filters" id="event-filters" role="group" aria-label="Filter events by group"></div>
        <button type="button" class="btn-subscribe" id="subscribe-ics">Subscribe (.ics)</button>
      </div>

      <div id="event-list" class="event-list"></div>
    </section>
```

`aria-live="off"` on the countdown is deliberate — a once-per-second live region
would flood a screen reader.

- [ ] **Step 2: Make the References list an empty shell**

The list is now filled from the database:

```html
      <ul class="ref-list" id="ref-list"></ul>
```

- [ ] **Step 3: Style the new pieces**

Append to `css/style.css`:

```css
/* --------------------------------------------------------- next session */
.next-band {
  border: 1px solid var(--rule);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius);
  background: var(--paper-raised);
  box-shadow: var(--shadow);
  padding: 18px 20px;
  margin-bottom: 24px;
}
.next-band h3 { margin: 6px 0 4px; font-size: 20px; }
.next-band p { margin: 0; color: var(--ink-muted); font-size: 14px; }
.next-group:not(:empty) { display: block; margin-bottom: 2px !important; }
.next-countdown {
  margin-top: 10px !important;
  font-size: 28px !important;
  color: var(--ink) !important;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}
.next-band[data-mode="live"] { border-left-color: var(--live); }
.next-band[data-mode="live"] .next-countdown { color: var(--live) !important; }
.next-band[data-mode="none"] { opacity: 0.7; }

.live-dot {
  display: inline-block;
  width: 9px; height: 9px;
  margin-right: 8px;
  border-radius: 50%;
  background: var(--live);
  animation: fcs-pulse 1.4s ease-in-out infinite;
}
@keyframes fcs-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.25; }
}
@media (prefers-reduced-motion: reduce) {
  .live-dot { animation: none; }
}

/* --------------------------------------------------------- event lists */
.event-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
.event-filters { display: flex; flex-wrap: wrap; gap: 8px; }
.chip {
  border: 1px solid var(--rule);
  background: var(--paper-raised);
  color: var(--ink-muted);
  padding: 6px 14px;
  border-radius: 999px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: border-color 140ms ease, color 140ms ease;
}
.chip:hover { border-color: var(--rule-strong); }
.chip.is-active { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
.chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.btn-subscribe {
  border: 1px solid var(--accent);
  background: transparent;
  color: var(--accent);
  padding: 8px 16px;
  border-radius: var(--radius);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.btn-subscribe:hover { background: var(--accent-soft); }

.event-card.is-live { border-color: var(--live); box-shadow: var(--shadow); }
.tag-live { color: var(--live); border-color: var(--live); }
.tag-upcoming { color: var(--ink-muted); }
.tag-finished { color: var(--ink-faint); }

/* Study-group statuses offered by the admin select. Without these the
   seeded "Completed" tag renders unstyled. */
.tag-active { color: var(--done); border-color: var(--done); }
.tag-forming { color: var(--accent); border-color: var(--accent); }
.tag-paused { color: var(--ink-faint); }
.tag-completed { color: var(--done); }

mark { background: var(--mark); color: inherit; }

.event-links { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; }
.link-button {
  border: 0;
  background: none;
  padding: 0;
  font: inherit;
  color: var(--ink-muted);
  text-decoration: underline;
  cursor: pointer;
}
.link-button:hover { color: var(--ink); }
.link-button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.past-events { margin-top: 24px; }
.past-events > summary {
  cursor: pointer;
  color: var(--ink-muted);
  font-size: 13px;
  padding: 8px 0;
}
.past-events .event-card { opacity: 0.6; }

/* ------------------------------------------------------------ resources */
.resource-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}
.resource-card {
  display: block;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-raised);
  box-shadow: var(--shadow);
  padding: 16px;
  color: var(--ink);
  text-decoration: none;
  transition: border-color 140ms ease, transform 140ms ease;
}
.resource-card:hover { border-color: var(--accent); transform: translateY(-2px); }
.resource-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.resource-card h3 { margin: 10px 0 6px; font-size: 15px; }
.resource-card p { margin: 0 0 8px; color: var(--ink-muted); font-size: 13px; }
.resource-card-top { display: flex; gap: 8px; align-items: center; }
.resource-ext { margin-left: auto; color: var(--ink-faint); }
.resource-kind, .resource-origin {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 3px 8px;
  border: 1px solid var(--rule);
  border-radius: 999px;
  color: var(--ink-muted);
}
.resource-origin { border-color: var(--accent); color: var(--accent); }
.join-label { display: inline-flex; align-items: center; gap: 8px; }
```

- [ ] **Step 4: Commit**

```bash
git add index.html css/style.css
git commit -m "feat: countdown band, event filters, ics button, and resources styling"
```

### Task 4.3: Rewrite `main.js` as a module

**Files:**
- Modify: `index.html` (script tags)
- Modify: `js/main.js`

- [ ] **Step 1: Switch `main.js` to a module**

In `index.html`, replace:

```html
  <script src="js/data.js"></script>
  <script type="module" src="js/main.js"></script>
```

with:

```html
  <script src="js/config.js"></script>
  <script src="js/vendor/supabase.min.js"></script>
  <script src="js/data.js"></script>
  <script type="module" src="js/main.js"></script>
```

All four are load-bearing. Dropping `config.js` leaves
`window.FCS_CONFIG` undefined, so `isConfigured()` returns false and the page
stays seed-only forever. Dropping the vendored Supabase client leaves
`window.supabase` undefined, so `getClient()` returns null for the same reason.
Both failures are silent — the page looks fine, it just never updates.

**Ordering:** the two classic scripts run immediately and in order, so
`FCS_CONFIG` and `window.supabase` both exist before the deferred module runs.
`data.js` therefore always executes before `main.js`, which is what lets
`main.js` read the `window.*` values from Task 4.1.

Because this depends on `js/vendor/supabase.min.js`, **do Task 5.1 Step 1
before this step.** If the file is missing, `getClient()` returns null and the
site degrades to seed data rather than erroring.

- [ ] **Step 2: Add the imports and module state to the top of `main.js`**

```js
import { deriveEventState } from "./lib/derive.js";
import { resolveNextSession } from "./lib/schedule.js";
import { formatCountdown } from "./lib/countdown.js";
import { partitionEvents, groupNames, filterByGroup } from "./lib/events-view.js";
import { buildICS } from "./lib/ics.js";
import { splitRepos } from "./lib/repos.js";
import {
  getEvents,
  getClassSessions,
  getResources,
  getStudyGroups,
  getSocialLinks,
  getRepoKinds,
} from "./supabase.js";

let allEvents = [];
let allClassSessions = [];
let githubResources = [];
let activeGroup = "All";
let countdownTimer = null;
let icsBound = false;
```

- [ ] **Step 3: Replace the `DOMContentLoaded` block**

```js
document.addEventListener("DOMContentLoaded", () => {
  renderPrinciples();
  renderContributionLanes();

  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  setupMobileNav();
  setupScrollSpy();

  // Content and repository fetches are deliberately independent: a
  // Supabase outage or a GitHub rate limit degrades one section
  // without touching the other.
  loadContent();
  loadRepositories();
});
```

- [ ] **Step 4: Add the loaders**

```js
async function loadContent() {
  const [events, classSessions, resources, studyGroups, socialLinks] = await Promise.all([
    getEvents(window.SEED_EVENTS || []),
    getClassSessions([]),
    getResources(window.SEED_RESOURCES || []),
    getStudyGroups(window.SEED_STUDY_GROUPS || []),
    getSocialLinks(window.SEED_JOIN_LINKS || []),
  ]);

  allEvents = events;
  allClassSessions = classSessions;
  githubResources = [];

  renderEvents();
  renderResources(resources);
  renderStudyGroups(studyGroups);
  renderJoinLinks(socialLinks);
  renderReferences(socialLinks);
  bindIcs();
}

async function loadRepositories() {
  const statusEl = document.getElementById("repo-status");
  const gridEl = document.getElementById("repo-grid");
  if (!statusEl || !gridEl) return;

  try {
    const res = await fetch(
      `https://api.github.com/orgs/${window.GITHUB_ORG}/repos?per_page=100&sort=updated`,
      { headers: { Accept: "application/vnd.github+json" } }
    );
    if (!res.ok) throw new Error(`GitHub API responded with ${res.status}`);

    const repos = await res.json();
    if (!Array.isArray(repos) || repos.length === 0) {
      statusEl.textContent = "No public repositories were found.";
      return;
    }

    repos.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

    const kinds = await getRepoKinds();
    const curated = kinds.length ? kinds : window.SEED_REPO_KINDS || [];
    const { projects, resources } = splitRepos(repos, curated);

    githubResources = resources.map((repo) => ({
      title: repo.name,
      kind: "tool",
      url: repo.html_url,
      summary: repo.description || repo.curated_note || "Curated as a resource.",
      group_name: null,
      via_github: true,
    }));

    gridEl.innerHTML = projects.map(repoCardHTML).join("");
    statusEl.hidden = true;
    gridEl.hidden = false;

    mergeGithubResources();
  } catch (err) {
    statusEl.innerHTML = `
      The GitHub API cannot be reached now.
      <a href="https://github.com/${window.GITHUB_ORG}" target="_blank" rel="noopener">
        Open the organization on GitHub &rarr;
      </a>
    `;
    console.error("[FCS] Repository fetch failed:", err);
  }
}
```

- [ ] **Step 5: Replace `renderEvents` and `eventCardHTML`**

```js
function renderEvents() {
  const list = document.getElementById("event-list");
  if (!list) return;

  const { upcoming, past } = partitionEvents(allEvents);
  const chipNames = ["All", ...groupNames(allEvents)];

  // If the active group no longer exists, reset the filter.
  if (!chipNames.includes(activeGroup)) activeGroup = "All";

  const chipsEl = document.getElementById("event-filters");
  if (chipsEl) {
    // The visible label is escaped, but `data-group` must hold the RAW
    // value: `dataset` returns the attribute value as parsed, so escaping
    // it would make `filterByGroup` compare "R&amp;D" against "R&D" and
    // match nothing. Assign via the DOM rather than the HTML string.
    chipsEl.innerHTML = chipNames
      .map((name) => `<button type="button" class="chip${name === activeGroup ? " is-active" : ""}">${escapeHTML(name)}</button>`)
      .join("");

    Array.from(chipsEl.querySelectorAll(".chip")).forEach((chip, index) => {
      chip.dataset.group = chipNames[index];
      chip.addEventListener("click", () => {
        activeGroup = chip.dataset.group;
        renderEvents();
      });
    });
  }

  const shownUpcoming = filterByGroup(upcoming, activeGroup);
  const shownPast = filterByGroup(past, activeGroup);

  // Only claim "nothing scheduled" when there is genuinely nothing —
  // including no recurring class. Otherwise a site that only uses the
  // weekly schedule would show an error and stop its countdown.
  if (!shownUpcoming.length && !shownPast.length && !allClassSessions.length) {
    list.innerHTML = `<p class="empty-note">Nothing scheduled right now. Add the next one from the admin panel.</p>`;
    stopCountdown();
    return;
  }

  const pastBlock = shownPast.length
    ? `<details class="past-events">
         <summary>Show ${shownPast.length} past event${shownPast.length === 1 ? "" : "s"}</summary>
         <div class="event-list">${shownPast.map(eventCardHTML).join("")}</div>
       </details>`
    : "";

  list.innerHTML = `
    ${shownUpcoming.length ? `<div class="event-list">${shownUpcoming.map(eventCardHTML).join("")}</div>` : ""}
    ${pastBlock}
  `;

  startCountdown();
}

function eventCardHTML(event) {
  const start = new Date(event.starts_at);
  const state = event.display_state;
  const isLive = state === "live";

  const label = isLive ? "LIVE NOW" : state === "upcoming" ? "UPCOMING" : "FINISHED";
  const href = safeURL(event.link);
  // The `stage` column is a workflow state; `display_state` is what the
  // visitor sees. Never render `event.stage`.
  const tag = isLive
    ? '<span class="tag tag-live"><span class="live-dot" aria-hidden="true"></span>LIVE NOW</span>'
    : `<span class="tag tag-${state}">${label}</span>`;

  const links = [];
  if (href) {
    links.push(
      `<a href="${href}" target="_blank" rel="noopener">${escapeHTML(event.link_text || "Open event")} &rarr;</a>`
    );
  }
  if (state === "upcoming" || isLive) {
    links.push(
      `<button type="button" class="link-button" data-ics-single="${event.id}">Add to calendar</button>`
    );
  }

  return `
    <article class="event-card${isLive ? " is-live" : ""}">
      <div class="event-date">
        <span>${escapeHTML(
          start.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
        )}</span>
        <strong>${escapeHTML(start.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }))}</strong>
      </div>
      <div class="event-main">
        <div class="event-card-top">
          <div>
            ${event.group_name ? `<span class="mini-label">${escapeHTML(event.group_name)}</span>` : ""}
            <h3>${escapeHTML(event.title)}</h3>
          </div>
          ${tag}
        </div>
        ${event.details ? `<p>${escapeHTML(event.details)}</p>` : ""}
        ${links.length ? `<div class="event-links">${links.join("")}</div>` : ""}
      </div>
    </article>
  `;
}
```

- [ ] **Step 6: Add the countdown loop**

```js
function startCountdown() {
  stopCountdown();

  const tick = () => {
    const band = document.getElementById("next-session");
    if (!band) return;

    const titleEl = band.querySelector("[data-next-title]");
    const groupEl = band.querySelector("[data-next-group]");
    const whenEl = band.querySelector("[data-next-when]");
    const countEl = band.querySelector("[data-next-countdown]");
    if (!titleEl || !whenEl || !countEl) return;

    const now = new Date();

    const live = allEvents.find(
      (e) => deriveEventState(now, e.starts_at, e.duration_minutes, e.stage) === "live"
    );
    if (live) {
      band.dataset.mode = "live";
      titleEl.textContent = live.title;
      if (groupEl) groupEl.textContent = live.group_name || "";
      whenEl.innerHTML = '<span class="live-dot" aria-hidden="true"></span>Happening now';
      countEl.textContent = "";
      return;
    }

    const next = resolveNextSession({ events: allEvents, classSessions: allClassSessions });
    if (!next) {
      band.dataset.mode = "none";
      titleEl.textContent = "No session scheduled";
      if (groupEl) groupEl.textContent = "";
      whenEl.textContent = "Add one from the admin panel";
      countEl.textContent = "";
      return;
    }

    band.dataset.mode = "countdown";
    titleEl.textContent = next.title;
    if (groupEl) groupEl.textContent = next.group || "";
    whenEl.textContent =
      next.at.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) +
      " · " +
      next.at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

    // Writes one text node only, so the DOM and the screen reader are not churned.
    const text = formatCountdown(next.at.getTime() - now.getTime());
    if (countEl.textContent !== text) countEl.textContent = text;
  };

  tick();
  countdownTimer = setInterval(tick, 1000);
}

function stopCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}
```

- [ ] **Step 7: Add the `.ics` download**

```js
function downloadICS(events, filename) {
  const ics = buildICS(events, { calendarName: "FCS Events" });
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function bindIcs() {
  if (icsBound) return;

  const whole = document.getElementById("subscribe-ics");
  if (whole) {
    whole.addEventListener("click", () => {
      const { upcoming } = partitionEvents(allEvents);
      if (!upcoming.length) {
        whole.disabled = true;
        whole.textContent = "Nothing to subscribe to";
        return;
      }
      downloadICS(upcoming, "fcs-events.ics");
    });
  }

  // Event cards are re-rendered on every filter change, so this is
  // delegated from the list container rather than bound per card.
  const list = document.getElementById("event-list");
  if (list) {
    list.addEventListener("click", (evt) => {
      const button = evt.target.closest("[data-ics-single]");
      if (!button) return;
      const event = allEvents.find((e) => e.id === button.dataset.icsSingle);
      if (!event) return;
      const safeTitle = String(event.title || "event")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40);
      downloadICS([event], `fcs-${safeTitle || "event"}.ics`);
    });
  }

  icsBound = true;
}
```

- [ ] **Step 8: Add the resources, groups, join, and references renderers**

```js
const RESOURCE_KIND_LABELS = {
  notes: "Notes",
  video: "Video",
  paper: "Paper",
  course: "Course",
  tool: "Tool",
  book: "Book",
};

/* Inline SVG, 16x16, currentColor. Brand-neutral marks rather than
   official logos, so nothing implies endorsement we have not got. */
const PLATFORM_ICONS = {
  discord:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M19.3 5.3A16 16 0 0 0 15.4 4l-.2.4a15 15 0 0 1 3.4 1.1 12.6 12.6 0 0 0-10.8 0A15 15 0 0 1 11.1 4.4L10.9 4a16 16 0 0 0-3.9 1.3C4.3 9.2 3.6 13 4 16.7A16 16 0 0 0 8.8 19l.7-1.2c-.7-.3-1.4-.6-2-1l.5-.4a11.4 11.4 0 0 0 9.6 0l.5.4c-.6.4-1.3.8-2 1L16.8 19a16 16 0 0 0 4.8-2.3c.5-4.3-.6-8-3-11.4ZM9.7 14.5c-1 0-1.7-.9-1.7-2s.8-2 1.7-2 1.8.9 1.7 2c0 1.1-.8 2-1.7 2Zm4.6 0c-1 0-1.7-.9-1.7-2s.8-2 1.7-2 1.8.9 1.7 2c0 1.1-.8 2-1.7 2Z"/></svg>',
  instagram:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.8.2 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.2 1.8-.4 2.2a3.8 3.8 0 0 1-.9 1.4c-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-1.8-.2-2.2-.4a3.8 3.8 0 0 1-1.4-.9 3.8 3.8 0 0 1-.9-1.4c-.2-.4-.4-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c.1-1.2.2-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4C8.4 2.2 8.8 2.2 12 2.2Zm0 3.1a6.7 6.7 0 1 0 0 13.4 6.7 6.7 0 0 0 0-13.4Zm0 11a4.3 4.3 0 1 1 0-8.6 4.3 4.3 0 0 1 0 8.6Zm6.9-11.3a1.6 1.6 0 1 1-3.2 0 1.6 1.6 0 0 1 3.2 0Z"/></svg>',
  whatsapp:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2Zm0 1.8a8.2 8.2 0 1 1-4.2 15.2l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 0 1 12 3.8Zm-3.5 4c-.2 0-.4 0-.6.3l-.8 1c-.2.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.1 1 2.2 1.4 2.5 1.5.3.1.5 0 .7-.2l.7-.9c.2-.2.2-.4.1-.6l-1.7-.9c-.2-.1-.4-.1-.6.1l-.6.8c-.1.1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-3.2c-.1-.2 0-.4.1-.5l.5-.6c.2-.2.2-.4.1-.6l-.8-1.9c-.1-.2-.2-.3-.4-.3Z"/></svg>',
  github:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.3-3.4-1.3-.4-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.7.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .3.3.6.9.6 1.9v2.8c0 .3.2.6.7.5A10 10 0 0 0 12 2Z"/></svg>',
};

function platformIcon(platform) {
  return PLATFORM_ICONS[platform] || "";
}

function resourceCardHTML(resource) {
  const href = safeURL(resource.url);
  if (!href) return "";

  return `
    <a class="resource-card" href="${href}" target="_blank" rel="noopener">
      <span class="resource-card-top">
        <span class="resource-kind">${escapeHTML(RESOURCE_KIND_LABELS[resource.kind] || resource.kind || "Resource")}</span>
        ${resource.via_github ? `<span class="resource-origin">via GitHub</span>` : ""}
        <span class="resource-ext" aria-hidden="true">&#8599;</span>
      </span>
      <h3>${escapeHTML(resource.title)}</h3>
      ${resource.summary ? `<p>${escapeHTML(resource.summary)}</p>` : ""}
      ${resource.curated_note ? `<span class="mini-label">${escapeHTML(resource.curated_note)}</span>` : ""}
      ${resource.group_name ? `<span class="mini-label">${escapeHTML(resource.group_name)}</span>` : ""}
    </a>
  `;
}

function mergeGithubResources() {
  const grid = document.getElementById("resource-grid");
  if (!grid || !githubResources.length) return;
  grid.insertAdjacentHTML("beforeend", githubResources.map(resourceCardHTML).join(""));
}

function renderResources(resources) {
  const grid = document.getElementById("resource-grid");
  if (!grid) return;

  const all = [...(resources || []), ...githubResources];
  if (!all.length) {
    grid.innerHTML = `<p class="empty-note">No resources listed yet.</p>`;
    return;
  }
  grid.innerHTML = all.map(resourceCardHTML).join("");
}

function renderStudyGroups(groups) {
  const grid = document.getElementById("study-group-grid");
  if (!grid) return;

  if (!groups || !groups.length) {
    grid.innerHTML = `<p class="empty-note">No study groups are listed yet.</p>`;
    return;
  }

  grid.innerHTML = groups
    .map((group) => {
      const href = safeURL(group.link);
      return `
      <article class="group-card">
        <div class="group-card-top">
          <h3>${escapeHTML(group.name)}</h3>
          <span class="tag tag-${escapeAttr(String(group.status || "").toLowerCase())}">${escapeHTML(group.status || "")}</span>
        </div>
        <p>${escapeHTML(group.topic)}</p>
        ${href ? `<a href="${href}" target="_blank" rel="noopener">${escapeHTML(group.link_text || "Open")} &rarr;</a>` : ""}
      </article>`;
    })
    .join("");
}

function renderJoinLinks(links) {
  const grid = document.getElementById("join-grid");
  if (!grid) return;

  if (!links || !links.length) {
    grid.innerHTML = `<p class="empty-note">No rooms are open right now.</p>`;
    return;
  }

  grid.innerHTML = links
    .map((item) => {
      const href = safeURL(item.url);
      if (!href) return "";
      return `
      <a class="join-card" href="${href}" target="_blank" rel="noopener">
        <span class="join-card-top">
          <span class="join-label">
            ${platformIcon(item.platform)}
            ${escapeHTML(item.label)}
          </span>
          <span class="join-arrow" aria-hidden="true">&rarr;</span>
        </span>
        ${item.hint ? `<span class="join-hint">${escapeHTML(item.hint)}</span>` : ""}
      </a>`;
    })
    .join("");
}

function renderReferences(links) {
  const list = document.getElementById("ref-list");
  if (!list) return;

  if (!links || !links.length) {
    list.innerHTML = `<li>No external references.</li>`;
    return;
  }

  list.innerHTML = links
    .map((item) => {
      const href = safeURL(item.url);
      if (!href) return "";
      return `
      <li>
        <span class="ref-tag">[${escapeHTML(String(item.platform || "link").toUpperCase())}]</span>
        <a href="${href}" target="_blank" rel="noopener">${escapeHTML(item.label)} &mdash; ${escapeHTML(item.hint || "Community link")}</a>
      </li>`;
    })
    .join("");
}
```

- [ ] **Step 9: Remove the superseded renderers and harden the shared helpers**

Delete the old `renderStudyGroups`, `studyGroupCardHTML`, `renderJoinLinks`,
`renderEvents`, and `eventCardHTML` from `main.js` — the Step 5 and Step 8
versions replace them.

Keep `renderPrinciples`, `renderContributionLanes`, `fetchMaintainers`,
`maintainerCardHTML`, `maintainerFallbackCardHTML`, `repoCardHTML`,
`formatDate`, `escapeHTML`, `setupMobileNav`, `setupScrollSpy`. Two of those
kept functions need changing:

`renderPrinciples` and `renderContributionLanes` currently read the bare
identifiers `PRINCIPLES` and `CONTRIBUTION_LANES`, and `fetchMaintainers` reads
`MAINTAINERS`. Because `main.js` is now a module and `data.js` is a classic
script, those bare names are **not in scope** — it would throw
`ReferenceError: PRINCIPLES is not defined` on every page load and the
Abstract, Protocol, and Maintainers sections would never render. Read them off
`window` instead:

```js
function renderPrinciples() {
  const list = document.getElementById("principle-list");
  if (!list) return;
  const items = window.PRINCIPLES || [];

  if (!items.length) {
    list.innerHTML = `<p class="empty-note">No principles listed.</p>`;
    return;
  }
  list.innerHTML = items
    .map(
      (item, index) => `
      <article class="principle-item">
        <span class="principle-index">${String(index + 1).padStart(2, "0")}</span>
        <div>
          <h3>${escapeHTML(item.title)}</h3>
          <p>${escapeHTML(item.text)}</p>
        </div>
      </article>`
    )
    .join("");
}

function renderContributionLanes() {
  const grid = document.getElementById("lane-grid");
  if (!grid) return;
  const lanes = window.CONTRIBUTION_LANES || [];

  if (!lanes.length) {
    grid.innerHTML = `<p class="empty-note">No contribution lanes listed.</p>`;
    return;
  }
  grid.innerHTML = lanes
    .map(
      (lane) => `
      <article class="lane-card">
        <span class="mini-label">${escapeHTML(lane.label)}</span>
        <h3>${escapeHTML(lane.title)}</h3>
        <p>${escapeHTML(lane.text)}</p>
      </article>`
    )
    .join("");
}
```

And in `fetchMaintainers`, change `MAINTAINERS.map(...)` to
`(window.MAINTAINERS || []).map(...)` in both the success and failure paths.

Finally, replace the existing `escapeHTML` helper with the three-helper set, so
attribute and URL interpolation is safe:

```js
/* ---- output safety -------------------------------------------------
 * These render database- and API-supplied strings. `escapeHTML` covers
 * text nodes. `escapeAttr` additionally escapes quotes so a value
 * cannot break out of an attribute. `safeURL` refuses anything that is
 * not http(s), so a stored `javascript:` URL cannot execute on click.
 * ------------------------------------------------------------------ */

function escapeHTML(value) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}

function escapeAttr(value) {
  return escapeHTML(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function safeURL(value) {
  const raw = String(value == null ? "" : value).trim();
  return /^https?:\/\//i.test(raw) ? escapeAttr(raw) : "";
}
```

- [ ] **Step 10: Expose `GITHUB_ORG` on `window`**

In `data.js`, the `GITHUB_ORG` const is script-scoped. Add it to the `window`
block from Step 4.1:

```js
window.GITHUB_ORG = GITHUB_ORG;
```

- [ ] **Step 11: Verify the seed fallback with no database**

Run `npm run serve`, open `http://localhost:8000`.

Expected:
- Every section renders.
- The countdown band reads "No session scheduled" and is dimmed.
- The Events section shows only the "Show 3 past events" disclosure, expanded it
  shows all three as FINISHED. **No event is labelled UPCOMING.**
- The nav has six links and no `§`.
- The Entry and References sections show Discord, Instagram, WhatsApp, GitHub.
- Resources shows one card.
- Console is clean and there is no request to any `*.supabase.co` host.

- [ ] **Step 12: Commit**

```bash
git add index.html js/main.js js/data.js
git commit -m "feat: database-backed sections with seed fallback, countdown, and ics"
```

---

# Phase 5 — Admin panel

**This is the only phase that needs a real Supabase project.** See the
human-in-the-loop checklist at the end of this plan.

### Task 5.1: Vendor the two libraries

**Files:**
- Create: `js/vendor/supabase.min.js`
- Create: `js/vendor/Sortable.min.js`

- [ ] **Step 1: Download both UMD builds**

```bash
mkdir -p js/vendor
curl -L -o js/vendor/supabase.min.js https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js
curl -L -o js/vendor/sortable.min.js https://cdn.jsdelivr.net/npm/sortablejs@1.15.6/Sortable.min.js
```

- [ ] **Step 2: Confirm both downloaded correctly rather than saving an error page**

```bash
Get-Item js/vendor/*.js | Select-Object Name, Length
Get-Content js/vendor/supabase.min.js -TotalCount 1 | Select-String "supabase"
Get-Content js/vendor/sortable.min.js -TotalCount 1 | Select-String "Sortable"
```

Expected: both files well over 5 KB, and each first line contains its library
name. A tiny file means the download failed — retry before continuing.

- [ ] **Step 3: Commit**

```bash
git add js/vendor/supabase.min.js js/vendor/sortable.min.js
git commit -m "chore: vendor supabase-js and SortableJS, no CDN at runtime"
```

### Task 5.2: `js/lib/forms.js` — datetime conversion

**Files:**
- Create: `js/lib/forms.js`
- Test: `js/lib/forms.test.js`

- [ ] **Step 1: Write the failing test**

`js/lib/forms.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { toLocalInputValue, fromLocalInputValue, formatDateTimeLocal } from "./forms.js";

test("an ISO instant round-trips through the datetime-local value", () => {
  const original = "2026-10-05T18:30:00.000Z";
  assert.equal(fromLocalInputValue(toLocalInputValue(original)), original);
});

test("a blank input produces null rather than an Invalid Date", () => {
  assert.equal(fromLocalInputValue(""), null);
});

test("a malformed input produces null rather than an Invalid Date", () => {
  assert.equal(fromLocalInputValue("nonsense"), null);
});

test("an unparseable ISO string formats as an em dash", () => {
  assert.equal(formatDateTimeLocal("nonsense"), "—");
});

test("a valid ISO string produces readable text containing the year", () => {
  assert.match(formatDateTimeLocal("2026-10-05T18:30:00.000Z"), /2026/);
});

test("a blank ISO string formats as an em dash", () => {
  assert.equal(formatDateTimeLocal(""), "—");
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npm test`
Expected: FAIL — cannot find `forms.js`.

- [ ] **Step 3: Implement**

`js/lib/forms.js`:

```js
/*
 * js/lib/forms.js
 * ------------------------------------------------------------------
 * Conversion between <input type="datetime-local"> values and the UTC
 * ISO strings stored in Postgres. A datetime-local value carries no
 * timezone, so it is read and written in the browser's local zone —
 * which is what a maintainer typing their own session time expects.
 * ------------------------------------------------------------------
 */

/** ISO string -> "YYYY-MM-DDTHH:mm" for a datetime-local input */
export function toLocalInputValue(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";

  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** "YYYY-MM-DDTHH:mm" -> ISO string in UTC, or null if unusable */
export function fromLocalInputValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** ISO string -> readable text for list rows */
export function formatDateTimeLocal(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npm test`
Expected: 6 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add js/lib/forms.js js/lib/forms.test.js
git commit -m "feat(lib): datetime-local conversion for the admin forms"
```

### Task 5.3: `admin.html` and `css/admin.css`

**Files:**
- Create: `admin.html`
- Create: `css/admin.css`

- [ ] **Step 1: Create `admin.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Admin — The Free Code Syndicate</title>

  <link rel="icon" type="image/png" sizes="32x32" href="assets/favicon-32.png" />

  <script>
    (function () {
      try {
        var stored = localStorage.getItem("fcs-theme");
        document.documentElement.setAttribute(
          "data-theme",
          stored || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        );
      } catch (e) {
        document.documentElement.setAttribute("data-theme", "light");
      }
    })();
  </script>

  <link rel="stylesheet" href="css/style.css" />
  <link rel="stylesheet" href="css/admin.css" />
</head>
<body class="admin-body">
  <header class="admin-header">
    <a class="nav-brand" href="./">TFCS<span class="nav-brand-sub">/admin</span></a>
    <div class="admin-header-right">
      <span id="admin-identity" class="admin-identity"></span>
      <button type="button" id="theme-toggle" class="theme-toggle" aria-pressed="false" aria-label="Switch theme">
        <span class="theme-toggle-icon" aria-hidden="true"></span>
      </button>
      <button type="button" id="admin-signout" class="admin-signout" hidden>Sign out</button>
    </div>
  </header>

  <main id="admin-root" class="admin-root">
    <p class="empty-note">Checking your access&hellip;</p>
  </main>

  <div id="admin-toast" class="admin-toast" role="status" aria-live="polite" hidden></div>

  <script src="js/config.js"></script>
  <script src="js/theme.js"></script>
  <script src="js/vendor/supabase.min.js"></script>
  <script src="js/vendor/sortable.min.js"></script>
  <script type="module" src="js/admin.js"></script>
</body>
</html>
```

`theme.js` is a classic script, so it works here unchanged and picks up the
`#theme-toggle` button above.

- [ ] **Step 2: Create `css/admin.css`**

```css
/* css/admin.css — admin panel. Tokens come from style.css. */

.admin-body {
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-mono);
  min-height: 100vh;
}

.admin-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--rule);
  background: var(--paper-raised);
  position: sticky;
  top: 0;
  z-index: 20;
}
.admin-header-right { display: flex; align-items: center; gap: 12px; }
.admin-identity { color: var(--ink-muted); font-size: 13px; }
.admin-signout {
  border: 1px solid var(--rule);
  background: transparent;
  color: var(--ink);
  padding: 6px 12px;
  border-radius: var(--radius);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
}
.admin-signout:hover { border-color: var(--rule-strong); }

.admin-root { padding: 24px 20px 80px; max-width: 1400px; margin: 0 auto; }

/* --------------------------------------------------------------- login */
.admin-login { max-width: 380px; margin: 12vh auto; }
.admin-login h1 { font-size: 20px; margin: 0 0 20px; }
.admin-login label { display: block; margin-bottom: 14px; font-size: 13px; color: var(--ink-muted); }
.admin-login input {
  display: block;
  width: 100%;
  margin-top: 6px;
  padding: 10px;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper-raised);
  color: var(--ink);
  font: inherit;
}
.admin-login input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.admin-error { color: var(--live); font-size: 13px; min-height: 1.4em; margin: 0 0 12px; }

/* ------------------------------------------------------------- buttons */
.btn {
  border: 1px solid var(--rule);
  background: var(--paper-raised);
  color: var(--ink);
  padding: 8px 14px;
  border-radius: var(--radius);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
}
.btn:hover { border-color: var(--rule-strong); }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.btn-primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
.btn-danger { color: var(--live); border-color: var(--live); background: transparent; }
.btn[disabled] { opacity: 0.45; cursor: not-allowed; }

.admin-toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 20px; }

/* -------------------------------------------------------------- kanban */
.board {
  display: grid;
  grid-template-columns: repeat(4, minmax(220px, 1fr));
  gap: 16px;
  align-items: start;
}
@media (max-width: 900px) { .board { grid-template-columns: 1fr; } }

.board-column {
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 12px;
  min-height: 160px;
}
.editor-row.is-editing { border-color: var(--accent); }
.board-column h3 {
  margin: 0 0 12px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ink-muted);
}
.board-count { color: var(--ink-faint); }

.card {
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  padding: 12px;
  margin-bottom: 10px;
  cursor: grab;
}
.card:active { cursor: grabbing; }
.card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.card h4 { margin: 0 0 6px; font-size: 14px; }
.card-meta { margin: 0; font-size: 12px; color: var(--ink-faint); }
.sortable-ghost { opacity: 0.4; }
.card-empty {
  border: 1px dashed var(--rule);
  border-radius: var(--radius);
  padding: 18px;
  text-align: center;
  color: var(--ink-faint);
  font-size: 12px;
}

/* -------------------------------------------------------------- panels */
#edit-panel {
  margin-top: 24px;
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  background: var(--paper-raised);
  padding: 20px;
}
#edit-panel h2 { margin: 0 0 16px; font-size: 16px; }

.admin-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 40px 0 20px;
  border-top: 1px solid var(--rule);
  padding-top: 24px;
}
.admin-tab {
  border: 1px solid var(--rule);
  background: transparent;
  color: var(--ink-muted);
  padding: 8px 14px;
  border-radius: var(--radius);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
}
.admin-tab.is-active { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
.admin-tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 14px;
  margin-bottom: 20px;
}
.field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--ink-muted); }
.field input, .field select, .field textarea {
  padding: 8px;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  background: var(--paper);
  color: var(--ink);
  font: inherit;
  font-size: 13px;
}
.field input:focus-visible, .field select:focus-visible, .field textarea:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.checkbox-row { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink); }

.editor-list { display: flex; flex-direction: column; gap: 10px; }
.editor-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  padding: 12px;
  background: var(--paper-raised);
}
.editor-row .grow { flex: 1 1 220px; min-width: 0; }
.editor-row strong { display: block; font-size: 14px; }
.editor-row .sub { font-size: 12px; color: var(--ink-faint); word-break: break-all; }

/* --------------------------------------------------------------- toast */
.admin-toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  background: var(--ink);
  color: var(--paper);
  padding: 10px 18px;
  border-radius: var(--radius);
  font-size: 13px;
  z-index: 100;
  max-width: 90vw;
}
.admin-toast[data-tone="error"] { background: var(--live); color: var(--accent-ink); }
```

- [ ] **Step 3: Verify the shell loads**

Do this step **after Task 5.4** — at this point `js/admin.js` does not exist yet,
so `/admin` will 404 on the module and sit on "Checking your access…". Once
5.4 is in place: run `npm run serve`, open `http://localhost:8000/admin`, and
with `js/config.js` still blanked, confirm the page renders the "Supabase is
not configured yet" panel with a clean console.

- [ ] **Step 4: Commit**

```bash
git add admin.html css/admin.css
git commit -m "feat(admin): panel shell and styles"
```

### Task 5.4: `js/admin.js` — auth, Kanban, editors

**Files:**
- Create: `js/admin.js`

- [ ] **Step 1: Create the module: imports, state, boot, login**

```js
/*
 * js/admin.js
 * ------------------------------------------------------------------
 * The admin panel. A module, so it imports the same library and
 * adapter the public page uses — a change to event semantics cannot
 * be applied to only one of the two surfaces.
 * ------------------------------------------------------------------
 */

import {
  getClientOrThrow,
  getSession,
  getRole,
  signIn,
  signOut,
  createEvent,
  updateEvent,
  deleteEvent,
  createClassSession,
  updateClassSession,
  deleteClassSession,
  createResource,
  updateResource,
  deleteResource,
  createStudyGroup,
  updateStudyGroup,
  deleteStudyGroup,
  createSocialLink,
  updateSocialLink,
  deleteSocialLink,
  saveRepoKind,
  deleteRepoKind,
} from "./supabase.js";
import { nextOccurrence } from "./lib/schedule.js";
import { toLocalInputValue, fromLocalInputValue, formatDateTimeLocal } from "./lib/forms.js";

const STAGES = ["draft", "scheduled", "live", "done"];

const state = {
  user: null,
  role: null,
  events: [],
  classSessions: [],
  resources: [],
  studyGroups: [],
  socialLinks: [],
  repoKinds: [],
  activeTab: "class-schedule",
  editingId: null,
};

const root = () => document.getElementById("admin-root");

function escapeHTML(value) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}

/* innerHTML escapes & < > but NOT " or '. Every interpolation that
 * lands inside an attribute must go through this instead. */
function escapeAttr(value) {
  return escapeHTML(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* Only allow links we are willing to put in an href. A stored
 * `javascript:` URL would otherwise execute on click. */
function safeURL(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) return "";
  return escapeAttr(raw);
}

function toast(message, tone) {
  const el = document.getElementById("admin-toast");
  if (!el) return;
  el.textContent = message;
  el.dataset.tone = tone === "error" ? "error" : "ok";
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    el.hidden = true;
  }, 3200);
}

async function readTable(name, order) {
  const { data, error } = await getClientOrThrow()
    .from(name)
    .select("*")
    .order(order || "sort_order");
  if (error) throw error;
  return data || [];
}

document.addEventListener("DOMContentLoaded", boot);

async function boot() {
  const signout = document.getElementById("admin-signout");
  if (signout) {
    signout.addEventListener("click", () => signOut().then(() => location.reload()));
  }

  if (!window.FCS_CONFIG || !window.FCS_CONFIG.supabaseUrl) {
    root().innerHTML = `
      <div class="admin-login">
        <h1>Admin panel</h1>
        <p>Supabase is not configured yet.</p>
        <p>Set <code>supabaseUrl</code> and <code>supabaseAnonKey</code> in
           <code>js/config.js</code>, then reload this page.</p>
      </div>`;
    return;
  }

  let session = null;
  try {
    session = await getSession();
  } catch (err) {
    root().innerHTML = `
      <div class="admin-login">
        <h1>Cannot reach the database</h1>
        <p>${escapeHTML(err.message || "Unknown error")}</p>
        <p>The public site is unaffected and still works from its seed data.</p>
      </div>`;
    return;
  }

  if (!session) return renderLogin();
  await onSignedIn(session.user);
}

function renderLogin() {
  root().innerHTML = `
    <form class="admin-login" id="login-form">
      <h1>Admin panel</h1>
      <label>Email
        <input type="email" id="login-email" autocomplete="username" required />
      </label>
      <label>Password
        <input type="password" id="login-password" autocomplete="current-password" required />
      </label>
      <p class="admin-error" id="login-error" role="alert"></p>
      <button type="submit" class="btn btn-primary">Sign in</button>
    </form>`;

  root().querySelector("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorEl = root().querySelector("#login-error");
    errorEl.textContent = "";
    try {
      const user = await signIn(
        root().querySelector("#login-email").value.trim(),
        root().querySelector("#login-password").value
      );
      await onSignedIn(user);
    } catch (err) {
      errorEl.textContent = err.message || "Sign in failed.";
    }
  });
}

async function onSignedIn(user) {
  const role = await getRole(user.id);
  if (!role) {
    // The spec requires this to be a real sign-out, not a soft screen:
    // otherwise the session survives a reload and the account stays in a
    // half-authenticated state with no way forward.
    await signOut().catch(() => {});

    root().innerHTML = `
      <div class="admin-login">
        <h1>No access</h1>
        <p>Your account exists but has no <code>profiles</code> row, so it has
           no role and cannot edit anything.</p>
        <p>You have been signed out. Ask an admin to run:</p>
        <p><code>insert into public.profiles (id, email, role)
           select id, email, 'editor' from auth.users where email = '${escapeHTML(user.email)}';</code></p>
        <button type="button" class="btn" id="back-to-login">Back to sign in</button>
      </div>`;
    root().querySelector("#back-to-login").addEventListener("click", renderLogin);
    return;
  }

  state.user = user;
  state.role = role;

  const identity = document.getElementById("admin-identity");
  if (identity) identity.textContent = `${user.email} · ${role}`;
  const signout = document.getElementById("admin-signout");
  if (signout) signout.hidden = false;

  try {
    await loadAll();
  } catch (err) {
    root().innerHTML = `
      <div class="admin-login">
        <h1>Could not load your content</h1>
        <p>${escapeHTML(err.message || "Unknown error")}</p>
        <button type="button" class="btn" id="retry">Retry</button>
      </div>`;
    root().querySelector("#retry").addEventListener("click", () => location.reload());
    return;
  }

  root().innerHTML = `
    <div class="admin-toolbar">
      <button type="button" class="btn btn-primary" id="new-event">New event</button>
    </div>
    <div class="board" id="board"></div>
    <div id="edit-panel" hidden></div>
    <div class="admin-tabs" id="admin-tabs"></div>
    <div id="tab-panel"></div>`;

  root().querySelector("#new-event").addEventListener("click", () => openEventEditor(null));
  renderBoard();
  renderTabs();
  renderActiveTab();
}

async function loadAll() {
  const [events, classSessions, resources, studyGroups, socialLinks, repoKinds] = await Promise.all([
    readTable("events", "starts_at"),
    readTable("class_sessions"),
    readTable("resources"),
    readTable("study_groups"),
    readTable("social_links"),
    readTable("repo_kinds", "repo_name"),
  ]);
  state.events = events;
  state.classSessions = classSessions;
  state.resources = resources;
  state.studyGroups = studyGroups;
  state.socialLinks = socialLinks;
  state.repoKinds = repoKinds;
}
```

- [ ] **Step 2: Add the Kanban board**

```js
function renderBoard() {
  const board = document.getElementById("board");
  if (!board) return;

  board.innerHTML = STAGES.map((stage) => {
    const inStage = state.events.filter((e) => e.stage === stage);
    return `
      <div class="board-column">
        <h3>${escapeHTML(stage)} <span class="board-count">${inStage.length}</span></h3>
        <div class="board-dropzone" data-stage="${stage}">
          ${
            inStage.length
              ? inStage.map(eventCardAdminHTML).join("")
              : `<p class="card-empty">Nothing here yet.</p>`
          }
        </div>
      </div>`;
  }).join("");

  bindBoard();
}

function eventCardAdminHTML(event) {
  return `
    <article class="card" data-id="${event.id}" tabindex="0" role="button"
             aria-label="Edit ${escapeAttr(event.title)}">
      <h4>${escapeHTML(event.title)}</h4>
      <p class="card-meta">${escapeHTML(formatDateTimeLocal(event.starts_at))}</p>
      ${event.group_name ? `<p class="card-meta">${escapeHTML(event.group_name)}</p>` : ""}
    </article>`;
}

function bindBoard() {
  document.querySelectorAll(".board-dropzone").forEach((zone) => {
    // Without Sortable the board still works: each card's edit form has a
    // stage dropdown, which is also the keyboard-accessible path.
    if (window.Sortable) {
      new window.Sortable(zone, {
        group: "board",
        animation: 150,
        onEnd: async (evt) => {
          const id = evt.item.dataset.id;
          const stage = zone.dataset.stage;
          const previous = (state.events.find((e) => e.id === id) || {}).stage;
          if (previous === stage) return;

          // Optimistic: move now, revert if the write fails.
          state.events = state.events.map((e) => (e.id === id ? { ...e, stage } : e));
          renderBoard();

          try {
            await updateEvent(id, { stage });

            // Persist the within-column order too, so a reload keeps the
            // sequence the maintainer dragged the cards into.
            const order = Array.from(zone.querySelectorAll(".card")).map(
              (card, index) => updateEvent(card.dataset.id, { sort_order: index })
            );
            await Promise.all(order);

            toast("Event moved.");
          } catch (err) {
            state.events = state.events.map((e) => (e.id === id ? { ...e, stage: previous } : e));
            renderBoard();
            toast(err.message || "Could not move the event.", "error");
          }
        },
      });
    }

    zone.addEventListener("click", (evt) => {
      const card = evt.target.closest(".card");
      if (card) openEventEditor(card.dataset.id);
    });
    zone.addEventListener("keydown", (evt) => {
      if (evt.key !== "Enter" && evt.key !== " ") return;
      const card = evt.target.closest(".card");
      if (!card) return;
      evt.preventDefault();
      openEventEditor(card.dataset.id);
    });
  });
}
```

- [ ] **Step 3: Add the event editor form**

```js
function openEventEditor(id) {
  const event = id ? state.events.find((e) => e.id === id) : null;
  if (id && !event) return;

  const panel = document.getElementById("edit-panel");
  if (!panel) return;
  panel.hidden = false;

  panel.innerHTML = `
    <h2>${event ? "Edit event" : "New event"}</h2>
    <form class="form-grid" id="event-form">
      <label class="field">Title
        <input name="title" required value="${escapeAttr((event && event.title) || "")}" />
      </label>
      <label class="field">Group
        <input name="group_name" value="${escapeAttr((event && event.group_name) || "")}" />
      </label>
      <label class="field">Starts at
        <input name="starts_at" type="datetime-local" required
               value="${escapeAttr(toLocalInputValue(event && event.starts_at))}" />
      </label>
      <label class="field">Duration (minutes)
        <input name="duration_minutes" type="number" min="5" step="5"
               value="${escapeAttr((event && event.duration_minutes) || 60)}" />
      </label>
      <label class="field">Stage
        <select name="stage">
          ${STAGES.map(
            (s) => `<option value="${s}" ${event && event.stage === s ? "selected" : ""}>${s}</option>`
          ).join("")}
        </select>
      </label>
      <label class="field">Link label
        <input name="link_text" value="${escapeAttr((event && event.link_text) || "")}" />
      </label>
      <label class="field">Link URL
        <input name="link" type="url" value="${escapeAttr((event && event.link) || "")}" />
      </label>
      <label class="field">Details
        <textarea name="details" rows="3">${escapeHTML((event && event.details) || "")}</textarea>
      </label>
      <div style="display: flex; gap: 10px;">
        <button type="submit" class="btn btn-primary">Save</button>
        ${
          event && state.role === "admin"
            ? `<button type="button" class="btn btn-danger" id="delete-event">Delete</button>`
            : ""
        }
        <button type="button" class="btn" id="cancel-edit">Cancel</button>
      </div>
    </form>`;

  panel.querySelector("#event-form").addEventListener("submit", async (evt) => {
    evt.preventDefault();
    const form = new FormData(evt.target);
    const patch = {
      title: String(form.get("title") || "").trim(),
      group_name: String(form.get("group_name") || "").trim() || null,
      details: String(form.get("details") || "").trim() || null,
      starts_at: fromLocalInputValue(form.get("starts_at")),
      duration_minutes: Number(form.get("duration_minutes")) || 60,
      stage: String(form.get("stage") || "draft"),
      link: String(form.get("link") || "").trim() || null,
      link_text: String(form.get("link_text") || "").trim() || null,
    };

    if (!patch.title || !patch.starts_at) {
      toast("A title and a start time are required.", "error");
      return;
    }

    try {
      if (event) await updateEvent(event.id, patch);
      else await createEvent(patch);
      panel.hidden = true;
      panel.innerHTML = "";
      state.events = await readTable("events", "starts_at");
      renderBoard();
      toast(event ? "Event saved." : "Event created.");
    } catch (err) {
      toast(err.message || "Could not save the event.", "error");
    }
  });

  const cancel = panel.querySelector("#cancel-edit");
  if (cancel) {
    cancel.addEventListener("click", () => {
      panel.hidden = true;
      panel.innerHTML = "";
    });
  }

  const remove = panel.querySelector("#delete-event");
  if (remove) {
    remove.addEventListener("click", async () => {
      if (!confirm(`Delete "${event.title}"? This cannot be undone.`)) return;
      try {
        await deleteEvent(event.id);
        panel.hidden = true;
        panel.innerHTML = "";
        state.events = await readTable("events", "starts_at");
        renderBoard();
        toast("Event deleted.");
      } catch (err) {
        toast(err.message || "Could not delete. Admin role required.", "error");
      }
    });
  }
}
```

- [ ] **Step 4: Add the tabs and the field-schema editors**

```js
const TABS = [
  { id: "class-schedule", label: "Class schedule" },
  { id: "resources", label: "Resources" },
  { id: "study-groups", label: "Study groups" },
  { id: "social-links", label: "Social links" },
  { id: "repo-kinds", label: "Repo curation" },
];

const FIELD_SCHEMAS = {
  resources: {
    table: "resources",
    stateKey: "resources",
    title: (r) => r.title,
    subtitle: (r) => `${r.kind} · ${r.url}`,
    fields: [
      { name: "title", label: "Title", type: "text", required: true },
      { name: "kind", label: "Kind", type: "select", options: ["notes", "video", "paper", "course", "tool", "book"] },
      { name: "url", label: "URL", type: "url", required: true },
      { name: "summary", label: "Summary", type: "text" },
      { name: "group_name", label: "Group", type: "text" },
      { name: "is_published", label: "Published", type: "checkbox", defaultChecked: true },
    ],
  },
  "study-groups": {
    table: "study_groups",
    stateKey: "studyGroups",
    title: (r) => r.name,
    subtitle: (r) => `${r.status} · ${r.topic}`,
    fields: [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "topic", label: "Topic", type: "text", required: true },
      { name: "status", label: "Status", type: "select", options: ["Active", "Forming", "Paused", "Completed"] },
      { name: "link", label: "Link", type: "url" },
      { name: "link_text", label: "Link label", type: "text" },
      { name: "is_published", label: "Published", type: "checkbox", defaultChecked: true },
    ],
  },
  "social-links": {
    table: "social_links",
    stateKey: "socialLinks",
    title: (r) => r.label,
    subtitle: (r) => r.url,
    fields: [
      { name: "platform", label: "Platform", type: "select", options: ["discord", "instagram", "whatsapp", "github", "x", "web"] },
      { name: "label", label: "Label", type: "text", required: true },
      { name: "url", label: "URL", type: "url", required: true },
      { name: "hint", label: "Hint", type: "text" },
      { name: "is_published", label: "Published", type: "checkbox", defaultChecked: true },
    ],
  },
};

function schemaForTab() {
  return FIELD_SCHEMAS[state.activeTab] || null;
}

/* Maps a schema to its named write operations, so the submit handler
 * never has to switch on a table name string. */
const SCHEMA_OPS = {
  resources: { create: createResource, update: updateResource, remove: deleteResource },
  "study-groups": { create: createStudyGroup, update: updateStudyGroup, remove: deleteStudyGroup },
  "social-links": { create: createSocialLink, update: updateSocialLink, remove: deleteSocialLink },
};

function renderTabs() {
  const tabs = document.getElementById("admin-tabs");
  if (!tabs) return;

  tabs.innerHTML = TABS.map(
    (tab) =>
      `<button type="button" class="admin-tab${tab.id === state.activeTab ? " is-active" : ""}" data-tab="${tab.id}">${tab.label}</button>`
  ).join("");

  tabs.querySelectorAll(".admin-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab;
      renderTabs();
      renderActiveTab();
    });
  });
}

function renderActiveTab() {
  const panel = document.getElementById("tab-panel");
  if (!panel) return;

  if (state.activeTab === "class-schedule") panel.innerHTML = renderClassSchedule();
  else if (state.activeTab === "repo-kinds") panel.innerHTML = renderRepoKinds();
  else panel.innerHTML = renderSchemaEditor();

  bindTabPanel();
}

function fieldHTML(field, value) {
  const name = field.name;

  if (field.type === "checkbox") {
    const checked = value === undefined ? field.defaultChecked !== false : value !== false;
    return `<label class="checkbox-row"><input type="checkbox" name="${name}"${
      checked ? " checked" : ""
    } /> ${field.label}</label>`;
  }

  if (field.type === "select") {
    const selected = value === undefined || value === null ? field.options[0] : value;
    return `<label class="field">${field.label}
      <select name="${name}">${field.options
        .map((o) => `<option value="${o}" ${o === selected ? "selected" : ""}>${o}</option>`)
        .join("")}</select>
    </label>`;
  }

  return `<label class="field">${field.label}
    <input name="${name}" type="${field.type}"${field.required ? " required" : ""}
           value="${escapeAttr(value === undefined || value === null ? "" : value)}" />
  </label>`;
}

function renderSchemaEditor() {
  const schema = schemaForTab();
  if (!schema) return "";
  const rows = state[schema.stateKey] || [];
  const editing = state.editingId;

  const formFields = schema.fields
    .map((field) => {
      const row = editing ? rows.find((r) => r.id === editing) : null;
      return fieldHTML(field, row ? row[field.name] : undefined);
    })
    .join("");

  const heading = editing ? `Edit — cancel to discard` : "Add a new row";

  return `
    <h3>${heading}</h3>
    <form class="form-grid" id="new-row-form">
      ${formFields}
      <div style="display: flex; gap: 10px;">
        <button type="submit" class="btn btn-primary">${editing ? "Save changes" : "Add"}</button>
        ${editing ? `<button type="button" class="btn" data-action="cancel-edit">Cancel</button>` : ""}
      </div>
    </form>
    <div class="editor-list">
      ${
        rows.length
          ? rows
              .map(
                (row) => `
        <div class="editor-row${row.id === editing ? " is-editing" : ""}" data-id="${row.id}">
          <span class="grow">
            <strong>${escapeHTML(schema.title(row))}</strong>
            <span class="sub">${escapeHTML(schema.subtitle(row))}</span>
          </span>
          <button type="button" class="btn" data-action="edit">Edit</button>
          <button type="button" class="btn btn-danger" data-action="delete"${
            state.role === "admin" ? "" : ' disabled title="Admin role required"'
          }>Delete</button>
        </div>`
              )
              .join("")
          : `<p class="empty-note">Nothing here yet.</p>`
      }
    </div>`;
}

const CLASS_FIELDS = [
  { name: "title", label: "Title", type: "text", required: true },
  { name: "group_name", label: "Group", type: "text" },
  { name: "weekday", label: "Weekday", type: "weekday-select" },
  { name: "start_time", label: "Start time", type: "time", required: true },
  { name: "duration_minutes", label: "Duration (min)", type: "number" },
  { name: "link", label: "Link", type: "url" },
  { name: "is_active", label: "Active", type: "checkbox", defaultChecked: true },
];

function renderClassSchedule() {
  const weekdays = (window.FCS_CONFIG && window.FCS_CONFIG.weekdays) || [
    "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
  ];
  const editing = state.editingId;
  const row = editing ? state.classSessions.find((r) => r.id === editing) : null;

  return `
    <p class="empty-note">
      A recurring weekly session. The public countdown picks the next occurrence
      automatically.
    </p>
    <h3>${editing ? "Edit session" : "Add a session"}</h3>
    <form class="form-grid" id="new-row-form">
      ${CLASS_FIELDS.map((field) =>
        field.type === "weekday-select"
          ? `<label class="field">${field.label}
              <select name="${field.name}">
                ${weekdays
                  .map(
                    (label, i) =>
                      `<option value="${i}" ${row && Number(row.weekday) === i ? "selected" : ""}>${label}</option>`
                  )
                  .join("")}
              </select>
            </label>`
          : fieldHTML(field, row ? row[field.name] : undefined)
      ).join("")}
      <div style="display: flex; gap: 10px;">
        <button type="submit" class="btn btn-primary">${editing ? "Save changes" : "Add session"}</button>
        ${editing ? `<button type="button" class="btn" data-action="cancel-edit">Cancel</button>` : ""}
      </div>
    </form>
    <div class="editor-list">
      ${
        state.classSessions.length
          ? state.classSessions
              .map((session) => {
                const next = nextOccurrence(session, new Date());
                return `
        <div class="editor-row${session.id === editing ? " is-editing" : ""}" data-id="${session.id}">
          <span class="grow">
            <strong>${escapeHTML(session.title)}</strong>
            <span class="sub">Next: ${
              next ? escapeHTML(next.toLocaleString("en-GB")) : "inactive"
            }</span>
          </span>
          <button type="button" class="btn" data-action="edit">Edit</button>
          <button type="button" class="btn btn-danger" data-action="delete"${
            state.role === "admin" ? "" : ' disabled title="Admin role required"'
          }>Delete</button>
        </div>`;
              })
              .join("")
          : `<p class="empty-note">No recurring sessions yet.</p>`
      }
    </div>`;
}

function renderRepoKinds() {
  return `
    <p class="empty-note">
      Move a GitHub repository between Projects and Resources. Anything not
      listed here is a Project, so a newly pushed repo needs no entry.
    </p>
    <form class="form-grid" id="new-row-form">
      <label class="field">Repository name
        <input name="repo_name" type="text" required placeholder="exact GitHub repo name" />
      </label>
      <label class="field">Kind
        <select name="kind">
          <option value="project">project</option>
          <option value="resource">resource</option>
        </select>
      </label>
      <label class="field">Note<input name="note" type="text" /></label>
      <div><button type="submit" class="btn btn-primary">Save curation</button></div>
    </form>
    <div class="editor-list">
      ${
        state.repoKinds.length
          ? state.repoKinds
              .map(
                (row) => `
        <div class="editor-row" data-id="${escapeHTML(row.repo_name)}">
          <span class="grow">
            <strong>${escapeHTML(row.repo_name)}</strong>
            <span class="sub">${escapeHTML(row.kind)}${row.note ? " · " + escapeHTML(row.note) : ""}</span>
          </span>
          <button type="button" class="btn btn-danger" data-action="delete"${
            state.role === "admin" ? "" : ' disabled title="Admin role required"'
          }>Delete</button>
        </div>`
              )
              .join("")
          : `<p class="empty-note">No curated repositories yet.</p>`
      }
    </div>`;
}
```

- [ ] **Step 5: Add form binding, delete handling, and reload**

```js
function collectForm(form) {
  const data = new FormData(form);
  const out = {};
  for (const [key, value] of data.entries()) {
    out[key] = typeof value === "string" && value.trim() === "" ? null : value;
  }
  form.querySelectorAll('input[type="checkbox"]').forEach((box) => {
    out[box.name] = box.checked;
  });
  return out;
}

function currentRemoveOp() {
  if (state.activeTab === "class-schedule") return deleteClassSession;
  if (state.activeTab === "repo-kinds") return deleteRepoKind;
  const schema = schemaForTab();
  return schema ? SCHEMA_OPS[state.activeTab].remove : null;
}

async function reloadCurrentTab() {
  const map = {
    "class-schedule": ["class_sessions", "classSessions", null],
    resources: ["resources", "resources", null],
    "study-groups": ["study_groups", "studyGroups", null],
    "social-links": ["social_links", "socialLinks", null],
    "repo-kinds": ["repo_kinds", "repoKinds", "repo_name"],
  };
  const entry = map[state.activeTab];
  if (!entry) return;
  const [tableName, stateKey, order] = entry;
  state[stateKey] = await readTable(tableName, order);
  state.editingId = null;
  renderActiveTab();
  if (state.activeTab === "class-schedule") renderBoard();
}

function bindTabPanel() {
  const form = document.getElementById("new-row-form");
  if (form) {
    form.addEventListener("submit", async (evt) => {
      evt.preventDefault();
      const values = collectForm(form);
      const editing = state.editingId;

      try {
        if (state.activeTab === "class-schedule") {
          values.weekday = Number(values.weekday);
          values.start_time = String(values.start_time).slice(0, 5);
          values.duration_minutes = Number(values.duration_minutes) || 60;
          if (!values.title) throw new Error("A title is required.");
          if (editing) await updateClassSession(editing, values);
          else await createClassSession(values);
        } else if (state.activeTab === "repo-kinds") {
          if (!values.repo_name) throw new Error("A repository name is required.");
          values.kind = values.kind || "project";
          await saveRepoKind(values);
        } else {
          const ops = SCHEMA_OPS[state.activeTab];
          if (!ops) return;
          if (editing) await ops.update(editing, values);
          else await ops.create(values);
        }

        await reloadCurrentTab();
        toast(editing ? "Changes saved." : "Saved.");
      } catch (err) {
        toast(err.message || "Could not save.", "error");
      }
    });
  }

  const cancel = document.querySelector("[data-action='cancel-edit']");
  if (cancel) {
    cancel.addEventListener("click", () => {
      state.editingId = null;
      renderActiveTab();
    });
  }

  document.querySelectorAll(".editor-row [data-action='edit']").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingId = button.closest(".editor-row").dataset.id;
      renderActiveTab();
      const first = document.querySelector("#new-row-form input, #new-row-form select");
      if (first) first.focus();
    });
  });

  document.querySelectorAll(".editor-row [data-action='delete']").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("Delete this row?")) return;
      try {
        const id = button.closest(".editor-row").dataset.id;
        await currentRemoveOp()(id);
        await reloadCurrentTab();
        toast("Deleted.");
      } catch (err) {
        toast(err.message || "Could not delete. Admin role required.", "error");
      }
    });
  });
}
```

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: every test passes, including the six new `forms.test.js` cases.

- [ ] **Step 7: Verify the panel against a live project**

With `js/config.js` filled in:

1. Visit `/admin` — the login form appears.
2. Sign in as an admin — the board appears with the 3 seeded events, all in
   Done, and each column shows its count.
3. Click "New event", create one for tomorrow at 21:00, save. It appears in
   Draft and the count updates.
4. Drag it Draft → Scheduled. Sign out, sign back in, reload — still Scheduled.
5. Open the public site in a second tab and reload — the event is under
   Upcoming and the countdown band names it.
6. Set the event's start to 2 minutes from now and reload the public page — it
   shows a pulsing LIVE NOW badge and the band switches to live mode.
7. Click the `.ics` button and import the file into a calendar — the event has
   the right start and duration.
8. Add a recurring class session (Wednesday 21:00, active). The admin list
   shows a "Next:" preview. The public countdown falls back to it when no
   event is pending.
9. Sign in as an `editor`. Delete buttons are disabled, and calling
   `deleteEvent` from the console raises a Postgres permission error — not
   merely a UI block.
10. Sign in with an account that has no `profiles` row — the "No access" screen
    appears **and you are signed out**; reloading the page shows the login form
    again rather than the same dead end.
11. **RLS, signed out.** In the console on any page: reading
    `supabase.from('events').select('*')` succeeds (the public page depends on
    it), while `supabase.from('events').insert({ title: 'x' })` rejects with
    Postgres error `42501` / `new row violates row-level security policy`.
12. **Editing a non-event row.** On the Resources tab, click Edit on a row,
    change the title, save, and confirm the list shows the new value and a
    reload preserves it. Repeat once on Social links and once on Class
    schedule.
13. Turn off wifi and reload the public site — every section still renders from
    seed data.
12. On a repo-curation tab, mark an existing repo as `resource`. Reload the
    public site: it disappears from Projects and appears in Resources with a
    `via GitHub` marker.
13. Block `js/vendor/sortable.min.js` in DevTools and reload `/admin` — the
    board renders, and moving a card's stage via the edit form still works.
14. A group whose name contains `&` (e.g. "R&D") renders as a filter chip that
    actually filters, rather than producing an empty list.

- [ ] **Step 8: Commit**

```bash
git add admin.html css/admin.css js/admin.js js/lib/forms.js js/lib/forms.test.js
git commit -m "feat(admin): kanban board, editors, and role-gated writes"
```

---

# Phase 6 — Cutover, link sweep, documentation

### Task 6.1: Sweep the dead Discord link

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Confirm the References list is database-driven**

Verify the section reads:

```html
      <ul class="ref-list" id="ref-list"></ul>
```

- [ ] **Step 2: Confirm no stale link survives in the shipped tree**

```bash
grep -rn "nH2PRmbB5" index.html admin.html js css supabase
```

Expected: **no matches.** The only hard-coded instance was in `index.html`'s
References list, which Phase 4 emptied. If anything remains, replace it with
`https://discord.gg/97BAafVesn`.

Do **not** add `--include="*.md"`. `docs/superpowers/specs/` and this plan both
quote the old invite on purpose, as a record of what was replaced — including
them would make this check permanently fail.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "chore: references render from the database; dead Discord link removed"
```

### Task 6.2: Rewrite the README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the README**

````markdown
# The Free Code Syndicate — website

A static, frontend-only site for The Free Code Syndicate, with a
Supabase-backed admin panel so a maintainer can update content without
touching code. No build step, no framework, no bundler.

## Run it locally

```bash
python -m http.server 8000    # Windows: `python`, not `python3`
```

Then open <http://localhost:8000>. The site runs entirely from the seed
data in `js/data.js` when no database is configured, so you can develop
the front end before Supabase exists.

Run the tests with:

```bash
npm test
```

## The admin panel

<http://localhost:8000/admin> — sign in with a Supabase account.

| Column | Meaning on the public site |
|--------|----------------------------|
| Draft  | Being written. Not shown. |
| Scheduled | Shown as **UPCOMING**. |
| Live | Shown as **LIVE NOW** during the session window. |
| Done | Shown as **FINISHED**. |

Dragging a card between columns updates the public site on the next visitor
reload. **The public page derives the displayed status from each event's own
timestamp**, so a past event shows FINISHED even if nobody moved its card, and
the list can never present a month-old event as upcoming.

## Where content lives

| Content | Source |
|---------|--------|
| Principles, contribution lanes, maintainers | `js/data.js` — fixed page copy |
| Events, class schedule, resources, study groups, social links | Supabase, editable at `/admin` |
| Projects | GitHub API, live at page load |
| Fallback for all database content | the `SEED_*` arrays in `js/data.js` |

The `SEED_*` arrays are a **fallback only**. Edit content in the admin panel,
not in code.

## Setting up Supabase

1. Create a free project at <https://supabase.com>.
2. Run `supabase/schema.sql` in the SQL editor.
3. Paste the project URL and anon key into `js/config.js`.
4. Sign up, then promote yourself to admin:
   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```
5. For each other maintainer, create an account under **Authentication →
   Users**. Every new signup gets an `editor` profile automatically. Editors can
   add and edit; only admins can delete.

The anon key is designed to be public and is safe to commit. All authorisation
is enforced by Row Level Security in Postgres. **Never put the service-role key
in `js/config.js`** — it would be readable by anyone who visits the site.

## Deploying to GitHub Pages

1. Push to the root of a repository, a `/docs` folder, or a dedicated branch.
2. Set **Settings → Pages** to that location.

`.nojekyll` makes Pages serve the files as-is.

## Notes and limits

- The GitHub API call is unauthenticated and rate-limited to 60 requests per
  hour per visitor IP. Each visitor's browser makes one request, so this is fine
  at community scale. If it is hit, the Projects section degrades to a link to
  the organisation page and every other section is unaffected.
- The Supabase free project pauses after a period of inactivity. Because every
  read falls back to seed data, that degrades to a stale-but-working page rather
  than a broken one. Reactivate it from the Supabase dashboard.
- Schedule edits appear on the next visitor reload. There is no live push.
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for the Supabase-backed admin panel"
```

### Task 6.3: Final verification pass

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: every test passes, 0 failures.

- [ ] **Step 2: Verify the site works with `js/config.js` blanked**

Temporarily blank both values, run `npm run serve`, and check every section
renders from seed data with no console errors and no `*.supabase.co` request.
Restore the values afterwards.

- [ ] **Step 3: Verify the accessibility and contrast commitments**

- Both themes: body text, `--ink-muted`, and `--ink-faint` on `--paper` and
  `--paper-raised` all pass WCAG AA (4.5:1 for body, 3:1 for large text).
- `--accent-ink` on `--accent` passes AA in both themes.
- Tab through the page: the theme toggle, nav links, filter chips, and the
  subscribe button are all reachable and show a visible focus ring.
- The countdown band is `aria-live="off"` and does not spam a screen reader.
- The admin board is fully operable with the keyboard via each card's stage
  dropdown, with drag-and-drop as the enhancement.

- [ ] **Step 4: Commit any fixes found**

```bash
git add -A
git commit -m "fix: verification pass findings"
```

---

## Human-in-the-loop checklist

Everything below requires you. Nothing else in the plan does.

### Blocked until a Supabase project exists (Phase 5 onward)

- [ ] **Create a free Supabase project** at <https://supabase.com>
- [ ] **Run `supabase/schema.sql`** in the project's SQL editor
- [ ] **Send me the project URL and the anon key** (Project Settings → API).
      The anon key is safe to share — it is designed to be public. Do not send
      the service-role key.
- [ ] **Sign up** on the live site once it is deployed
- [ ] **Run the promote statement** in the SQL editor:
      `update public.profiles set role = 'admin' where email = 'you@example.com';`
- [ ] **Create an account for your friend** under Authentication → Users, then
      send them the email and let them set a password. They land in as `editor`
      automatically.
- [ ] **Verify the invite links resolve** — open the Instagram and the new
      Discord link from the live site and confirm both work.

### Optional, for you to decide

- [ ] **Whether the three historical events should be seeded as `Done`.** The
      plan seeds them that way. If you would rather not show them at all, delete
      the three `events` rows in the SQL editor after setup.

### At the end

- [ ] **Deploy** by pushing to the branch your Pages settings use
- [ ] **Tell your friend the URL** of `/admin` and that they sign in with the
      account you created

### Not needed at any point

- No build step, no npm install, no bundler, no local database.
- Phases 0–4 need none of the above.

