# FCS Site — Admin CMS, Events Revamp, Resources Split, Dark Mode

- **Date:** 2026-09-28
- **Author:** Jyotirmoy Das
- **Status:** Approved for implementation planning
- **Repo:** `fcs-site` (static site on GitHub Pages)

---

## 1. Problem statement

The Free Code Syndicate site is a static, dependency-free HTML/CSS/JS page
deployed to GitHub Pages. It works, but content changes require someone to edit
`js/data.js` and push. Three concrete failures have accumulated:

1. **No social presence.** Instagram is missing entirely. The Discord invite
   (`discord.gg/nH2PRmbB5`) has expired and 404s.
2. **Events go stale.** All three events are dated Jul–Aug 2026 and hand-marked
   `"Done"`. `status` is a typed string, never checked against the clock, so the
   page can show only stale content with no indication that anything is coming.
3. **Navigation is noisy.** Ten `§N` links in the header compete for attention.

Two further requests: separate *resources* (non-GitHub learning material) from
*GitHub project repositories*, and a real-time view of the class schedule.

### Goals

| # | Goal | Measure |
|---|------|---------|
| G1 | A non-technical maintainer can update events, class schedule, resources, study groups, and social links without touching code | Friend updates an event and it appears on the public site without a deploy |
| G2 | Events can never appear stale | Public page derives event state from timestamps, not from hand-typed status |
| G3 | Resources and GitHub projects are visually and structurally distinct | Two separate sections with separate data sources |
| G4 | Members see the next session and a live countdown | Countdown visible without interaction; ticks every second |
| G5 | Dark mode with no flash of wrong theme | Theme applied before first paint; respects OS default |
| G6 | Navigation is scannable | Six top-level links, no `§` markers |

### Non-goals

- Moving the Abstract, Icarus Mark, Operating Protocol, or Contribution Lanes
  copy into the database. This is fixed page copy that changes rarely; keeping it
  in `index.html` keeps the page structurally simple.
- Replacing GitHub Pages hosting.
- A general-purpose CMS or multi-page content system.
- Notification/email of schedule changes. Out of scope for v1.

---

## 2. Chosen architecture

### 2.1 Decision

**Supabase (free tier) for data and auth; GitHub Pages for hosting; static site
unchanged in nature.**

The site remains a static bundle. It gains a client-side data layer that talks
to Supabase over its REST API at page load. No build step, no bundler, no
server-side code, no new hosting bill.

### 2.2 Alternatives considered

| Option | Why not chosen |
|--------|-----------------|
| Render (Node/Express) + Neon Postgres | Free Render services sleep after ~15 min idle, so the first visitor after a quiet period waits 30–60 s. Free-tier filesystem is ephemeral, so events cannot live in a local SQLite file. Adds a server to keep alive and a database that can be paused — strictly more failure modes than Supabase, which covers both needs. |
| Decap CMS (git-based) | Editing saves a git commit, which triggers a Pages rebuild — roughly a minute before members see the change. That directly conflicts with G2/G4 (real-time). Login on plain GitHub Pages also requires an OAuth bridge or a paid plan. |
| Google Sheet as the database | Reads are easy, but writes need a separate Apps Script bridge, there is no clean "only admins" authorisation, and the setup is fragile. |
| Single shared admin password | Cannot audit who changed what, and anyone with the link can edit. The user chose per-user accounts. |

### 2.3 Files

```
fcs-site/
├── index.html              public page
├── admin.html              NEW — login + Kanban board + resource editors
├── css/
│   ├── style.css           restyled onto a design-token layer
│   └── admin.css           NEW — admin panel styles
├── js/
│   ├── config.js           NEW — Supabase project URL + anon key
│   ├── supabase.js         NEW — client init, auth, typed data access
│   ├── data.js             slimmed to fixed page copy only
│   ├── main.js             public page rendering
│   ├── admin.js            NEW — Kanban board + CRUD
│   └── vendor/
│       └── sortable.min.js NEW — vendored drag-and-drop
└── assets/                 unchanged
```

`js/data.js` keeps the fixed page copy — `PRINCIPLES`, `CONTRIBUTION_LANES`,
`MAINTAINERS` — and additionally retains the current events, study groups, and
join links **renamed to `SEED_EVENTS`, `SEED_STUDY_GROUPS`, `SEED_JOIN_LINKS`**
as an offline fallback only (see §6.2). They are no longer the primary source;
the database is. `GITHUB_ORG` stays a constant.

### 2.4 Security model

The Supabase **anon key is designed to be public** and is committed to the repo.
It is not a secret. All real authorisation happens in Postgres via Row Level
Security:

- `select` — allowed for everyone, including logged-out visitors. Required so the
  public page can read.
- `insert` / `update` — allowed only for a row in `profiles` with role `admin`
  or `editor` belonging to the requesting `auth.uid()`.
- `delete` — allowed only for role `admin`.
- `profiles` — readable and writable only by the owning user, plus all admins.

No table is ever left without RLS enabled. The service-role key is never used
and never shipped to the browser.

---

## 3. Data model

All tables: `created_at timestamptz not null default now()`, `updated_at
timestamptz not null default now()` maintained by trigger. IDs are
`uuid primary key default gen_random_uuid()` unless stated.

### 3.1 `events`

The Kanban cards. `starts_at` is the single source of truth for when something
happens; the public page derives display state from it.

| Column | Type | Notes |
|--------|------|-------|
| `title` | `text not null` | Event name |
| `group_name` | `text` | Study group or room running it |
| `details` | `text` | One or two lines |
| `starts_at` | `timestamptz not null` | When it starts, with offset |
| `duration_minutes` | `int not null default 60` | Used for the live window |
| `stage` | `text not null default 'draft'` | `draft` \| `scheduled` \| `live` \| `done` — the Kanban column |
| `link` | `text` | Optional join/calendar link |
| `link_text` | `text` | Label for the link |
| `sort_order` | `int not null default 0` | Manual tiebreak within a column |

`stage` is a *workflow* state chosen by the maintainer. It is deliberately not
the same thing as the public display state (§5.2).

### 3.2 `class_sessions`

The standing weekly schedule.

| Column | Type | Notes |
|--------|------|-------|
| `title` | `text not null` | e.g. "Explain-3 Session" |
| `group_name` | `text` | Owning group |
| `weekday` | `int not null` | `0`–`6`, `0` = Sunday, stored as `int` because Postgres has no `time` weekday |
| `start_time` | `time not null` | Local wall-clock start |
| `duration_minutes` | `int not null default 60` | |
| `timezone` | `text not null default 'Asia/Kolkata'` | IANA name, used for the next-occurrence calculation |
| `link` | `text` | Room link |
| `is_active` | `boolean not null default true` | Inactive rows are ignored publicly |
| `sort_order` | `int not null default 0` | |

`weekday` is an `int` because Postgres has no time-with-weekday type. The
mapping matches JavaScript's `Date.getDay()`, so **no conversion is needed** in
the client: `0` = Sunday, `1` = Monday, … `6` = Saturday. The admin panel's
weekday dropdown must use this same order so the value is written correctly the
first time.

Next occurrence of a `class_sessions` row is computed in the browser as
"the next date whose `getDay()` equals `weekday`, at `start_time` in
`timezone`". This computation is duplicated in exactly two places —
`admin.js` for the maintainer's preview and `main.js` for the public band — and
both call a single shared helper in `supabase.js` so they cannot drift.

### 3.3 `resources`

Non-GitHub learning material. This is the table that creates separation (G3).

| Column | Type | Notes |
|--------|------|-------|
| `title` | `text not null` | |
| `kind` | `text not null` | `notes` \| `video` \| `paper` \| `course` \| `tool` \| `book` |
| `url` | `text not null` | |
| `summary` | `text` | One line |
| `group_name` | `text` | Optional owning group |
| `sort_order` | `int not null default 0` | |
| `is_published` | `boolean not null default true` | Draft resources stay hidden |

### 3.4 `study_groups`

| Column | Type | Notes |
|--------|------|-------|
| `name` | `text not null` | |
| `topic` | `text not null` | |
| `status` | `text not null default 'Forming'` | `Active` \| `Forming` \| `Paused` \| `Completed` |
| `link` | `text` | |
| `link_text` | `text` | |
| `sort_order` | `int not null default 0` | |
| `is_published` | `boolean not null default true` | |

### 3.5 `social_links`

| Column | Type | Notes |
|--------|------|-------|
| `platform` | `text not null` | `discord` \| `instagram` \| `whatsapp` \| `github` \| `x` \| `web` |
| `label` | `text not null` | |
| `url` | `text not null` | |
| `hint` | `text` | Short line under the label |
| `sort_order` | `int not null default 0` | |
| `is_published` | `boolean not null default true` | |

### 3.6 `repo_kinds`

Curation of the live GitHub repository list. Keyed by repo name because GitHub
repo names are unique within an org and are stable.

| Column | Type | Notes |
|--------|------|-------|
| `repo_name` | `text primary key` | Matches `repo.name` from the GitHub API |
| `kind` | `text not null` | `project` (default) \| `resource` |
| `note` | `text` | Optional maintainer note |

**How the split works (G3).** The public page renders two sections from two
sources:

- **Resources** — rows from `resources`, *plus* any GitHub repo whose name
  appears in `repo_kinds` with `kind = 'resource'`, tagged `via GitHub`.
- **Projects** — the GitHub API list with those curated resource repos removed.

A repo absent from `repo_kinds` defaults to `project`, so a newly pushed repo
appears automatically without anyone touching the CMS. The table only exists to
*move* something across the line.

### 3.7 `profiles`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid primary key` | References `auth.users(id)` on delete cascade |
| `email` | `text` | Mirrored for the admin user list |
| `display_name` | `text` | |
| `role` | `text not null default 'editor'` | `admin` \| `editor` |

A trigger on `auth.users` inserts a row with role `editor` on signup; the first
user is promoted to `admin` manually.

### 3.8 Row Level Security

Enabled on all seven tables. Written as policies referencing a helper:

```sql
create or replace function public.current_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'anon');
$$;

create policy "read published content" on public.events
  for select using (true);

create policy "editors insert events" on public.events
  for insert to authenticated
  with check (public.current_role() in ('admin','editor'));

create policy "editors update events" on public.events
  for update to authenticated
  using (public.current_role() in ('admin','editor'))
  with check (public.current_role() in ('admin','editor'));

create policy "admins delete events" on public.events
  for delete to authenticated
  using (public.current_role() = 'admin');
```

The same four policies are created for `class_sessions`, `resources`,
`study_groups`, and `social_links`. `profiles` gets "read own" and "admin reads
all". `repo_kinds` gets read-public plus editor write, delete admin-only.

---

## 4. Admin panel (`admin.html`)

### 4.1 Access

Not linked from the public navigation. Reached by typing `/admin`. The page
checks for a session on load; if none, it renders a login form. The client
requests a `profiles` row for the session user; if none exists the user is
signed out with a "no access" message rather than silently admitted.

### 4.2 Event Kanban board

Four columns rendered from `events` grouped by `stage`, in the fixed order
Draft → Scheduled → Live → Done.

- **Drag a card** to another column → `update events set stage = $new` on drop.
  Optimistic: the card moves immediately and reverts with an inline error toast
  if the write fails.
- **Click a card** → edit panel with title, group, details, start date+time
  (local input converted to a full ISO timestamp with the configured timezone
  offset), duration, link, link text.
- **New event** button → blank card in Draft.
- Within-column ordering is manual via `sort_order`; the vendored sortable
  library writes the new order back on drop.
- Columns show a count badge.

### 4.3 Other editors

Tabs below the board, each a sortable list with add / edit / delete:

- **Class schedule** — rows of weekday + start time + duration, with a live
  "next occurrence" preview computed in the browser so the maintainer can
  confirm the schedule is right.
- **Resources** — title, kind (select), URL, summary, group, published toggle.
- **Study groups** — name, topic, status (select), link, link text.
- **Social links** — platform (select with inline SVG icon set), label, URL,
  hint, published toggle.

Delete is admin-only; editors see the button disabled with a tooltip.

### 4.4 Error and empty states

- Write failure → inline toast, the change reverts, the underlying data is
  untouched.
- Empty column → dashed placeholder reading "Nothing here yet."
- Network failure on load → full-panel message with a Retry button rather than
  a blank board.

---

## 5. Public page (`index.html`)

### 5.1 Navigation

Six links: **About · Projects · Resources · Groups · Events · Join**. The `§N`
prefixes are removed from the nav. Section numbers remain as small mono labels
in the section headings themselves, so the RFC framing survives without the
header noise. A theme toggle button sits at the right of the nav bar.

Scroll-spy is rewritten to observe only the six target sections and to activate
nav links via an `IntersectionObserver` with the existing root margin.

### 5.2 Event state derivation — the fix for G2

`stage` is a workflow state. The **display** state is computed in the browser
from `starts_at` and `duration_minutes` against the current clock:

```
start       = starts_at
end         = starts_at + duration_minutes
liveWindow  = [start - 15 min, end]
```

| Condition | Display state |
|-----------|---------------|
| now < `liveWindow.start` | `UPCOMING` |
| now within `liveWindow` | `LIVE NOW` (pulsing) |
| now > `end` | `FINISHED` |

Consequences:

- An event whose time has passed shows `FINISHED` whether or not anyone moved its
  card. The page cannot present a month-old event as upcoming.
- A maintainer who forgets to drag a card to Done still gets a correct page.
- `stage = 'done'` forces `FINISHED` regardless of the clock, so a cancelled or
  abandoned event can be retired early.

### 5.3 Events section revamp

- **Next-session band** at the top of the section. Resolves the soonest future
  occurrence across both `events` (by `starts_at`) and `class_sessions` (by
  weekly recurrence). Shows title, group, absolute date, and a countdown in
  `2d 04h 13m` form.
- **Countdown** ticks every second via a single `setInterval` that writes only
  to the one text node, not the whole subtree.
- **LIVE NOW** badge replaces the countdown during a live window, with a
  pulsing dot. Uses `prefers-reduced-motion` to swap the pulse for a static dot.
- **Subscribe** button generates a `.ics` file client-side from all future
  events via a `Blob` URL and triggers a download. No server, no account, no
  tracking pixel. Single event and whole-schedule both supported.
- **Group filter chips** above the list, generated from the distinct
  `group_name` values present. Single-select, with an "All" chip.
- **Upcoming** and **Past** are separate groups. Upcoming sorts ascending by
  `starts_at`; Past sorts descending. Past cards are visually dimmed and
  collapsed behind a "Show N past events" disclosure.

### 5.4 Resources and Projects as separate sections

Two distinct top-level sections replace the current single "Repositories"
section.

- **Resources** — cards from the `resources` table, each showing a `kind` chip
  (notes / video / paper / course / tool / book) and an external-link marker.
  GitHub-sourced resources additionally carry a `via GitHub` marker so members
  always know the provenance.
- **Projects** — the existing live GitHub API grid, unchanged in behaviour,
  with curated resource repos filtered out.

Both are rendered in parallel after their fetches resolve; neither blocks the
other, so a GitHub rate limit cannot suppress the resources section.

### 5.5 Social links

Instagram (`https://www.instagram.com/freecodesyndicate/`) and the new Discord
(`https://discord.gg/97BAafVesn`) are seeded into `social_links`. The Entry
section and the References list both render from that table rather than from
hard-coded markup.

The dead `discord.gg/nH2PRmbB5` is swept from every remaining hard-coded
location: the References list in `index.html`, the Systems Reading Room entry in
`data.js`, and the CryptoMeet-3 event link.

### 5.6 Dark mode

Tokens are declared on `:root` and overridden under `[data-theme='dark']`. Every
colour in the stylesheet resolves through a variable; no literal colours remain
outside the token block.

- A small inline script in `<head>` reads `localStorage.theme`, falls back to
  `prefers-color-scheme`, and sets `data-theme` on `<html>` **before first
  paint**. No flash of the wrong theme.
- The toggle switches between light and dark and persists the choice. It
  overrides the OS setting until the visitor clears storage.
- The OS setting is followed whenever no explicit choice has been stored.
- `color-scheme` is set alongside `data-theme` so native UI elements — scrollbars,
  form controls in the admin panel — match.

---

## 6. Data flow

### 6.1 Public read

```
DOMContentLoaded
  ├─ renderPrinciples / renderContributionLanes   (sync, from data.js)
  ├─ supabase.connect()                          (async)
  ├─ loadContent()  ─┬─ getEvents()        → renderEvents()   + startCountdown()
  │                  ├─ getClassSessions() → mergeNextSession()
  │                  ├─ getResources()    → renderResources()
  │                  ├─ getStudyGroups()  → renderStudyGroups()
  │                  └─ getSocialLinks()  → renderJoinLinks() + renderReferences()
  ├─ fetchRepositories() ── getRepoKinds() → split → renderProjects() + renderResources()
  └─ fetchMaintainers()
```

Content and repository fetches are independent, so a failure in one never blanks
the other. Every fetch failure has a designed fallback: DB failures fall back to
the hard-coded seed values bundled in `data.js`, so the page is never empty.
This is also what makes the site previewable with no Supabase project at all.

### 6.2 Seed fallback

`data.js` retains the current `EVENTS`, `STUDY_GROUPS`, and `JOIN_LINKS` arrays
renamed `SEED_EVENTS`, `SEED_STUDY_GROUPS`, `SEED_JOIN_LINKS`, used only when
Supabase is unreachable or unconfigured. This is what allows local development
before the Supabase project exists, and it is a genuine resilience feature, not
just a dev convenience.

### 6.3 Writes (admin only)

All writes go through `supabase.js`, which exposes one function per operation and
never leaks a raw query builder to the UI. Every write updates
`updated_at` via trigger and returns the updated row, which the admin re-renders
from so the displayed state always matches the database.

---

## 7. Testing and verification

| Area | Method | Pass condition |
|------|--------|----------------|
| SQL / RLS | Execute each policy as `anon`, as a signed-in `editor`, and as `admin` via the Supabase SQL editor | `anon` can read; `editor` can write but not delete; `admin` can delete; `anon` write attempts raise `42501` |
| Public rendering | Load `index.html` with no Supabase configured | Every section renders from seed data; no console errors |
| Public rendering | Load with a live project | Sections render from the database; a DB outage still renders from seed |
| State derivation | Unit-check `deriveEventState(now, starts_at, duration)` at start−16 min, start−15 min, end, and end+1 min | `UPCOMING` / `LIVE NOW` / `FINISHED` / `FINISHED` at those four points |
| Countdown | Advance the clock; observe the band | Text ticks each second; DOM outside the one text node is untouched |
| `.ics` | Generate a schedule, open it in a calendar client | Events import with correct start, duration, and timezone |
| Kanban | Drag a card Draft → Scheduled; sign out; reload | Card is in Scheduled; public site reflects the new stage |
| Roles | Sign in as `editor`, attempt to delete | Delete is blocked by both the UI and RLS |
| Dark mode | Load with `prefers-color-scheme: dark`; toggle; reload | Correct theme on first paint, no flash; choice persists |
| Nav | Scroll the full page; click each nav link | Exactly one nav link active; all six jump correctly |
| Repo split | Mark one repo `resource` in `repo_kinds` | It appears under Resources with a `via GitHub` marker and is gone from Projects |
| Links | Click every social and reference link | Instagram and the new Discord resolve; no `nH2PRmbB5` remains anywhere in the repo |

Accessibility is checked throughout: the countdown band is `aria-live="off"` so
it does not spam a screen reader once per second, the `LIVE NOW` badge is
announced via a polite live region only on entry, drag-and-drop has a keyboard
alternative (a stage `select` on each card's edit panel), and the theme toggle
is a real `<button>` with `aria-pressed`.

---

## 8. Rollout

### 8.1 One-time setup by the maintainer

1. Create a free project at supabase.com.
2. Run `supabase/schema.sql` in the SQL editor. Included: tables, indexes, RLS
   policies, `updated_at` trigger, the signup trigger, and the seed rows for
   Instagram, Discord, WhatsApp, GitHub, the three study groups, and the three
   existing events.
3. Copy the project URL and anon key into `js/config.js`.
4. Create an account, then run the provided `promote admin` statement.

### 8.2 Rollout order

1. `config.js`, `supabase.js`, `schema.sql` — land dark; nothing reads them yet.
2. Dark mode tokens and the inline no-flash script — visible immediately,
   independently shippable.
3. Nav rework.
4. Data-backed public sections with seed fallback — site is fully functional
   before the database is even connected.
5. `admin.html` and the Kanban board.
6. Cut over — once the database is populated and verified against the real
   Supabase project, confirm every read path prefers the database and only falls
   back to seed data on failure. The seed arrays stay in the repo permanently as
   the offline fallback and must not be deleted; they are the reason the site
   still works with no database at all.

Each step is independently shippable, so a failure at step 5 does not strand
steps 2–4.

### 8.3 Risk and mitigation

| Risk | Mitigation |
|------|------------|
| Supabase free project paused after inactivity | The page has no hard dependency on the database — it falls back to seed data, so a paused project degrades to a stale-but-working page rather than a broken one |
| Friend's first login shows "no access" | Provision their `profiles` row during rollout, before announcing the panel |
| Anonymous GitHub API rate limit (60/hr per visitor IP) | Already handled by the existing graceful fallback; unchanged |
| Vendored drag-and-drop library becomes a maintenance burden | It is one pinned file under `js/vendor/`; the board degrades to a stage dropdown, which is a keyboard-accessible path that already exists in the edit panel |
| The `.ics` generator mishandles timezones | Emit UTC (`Z`) timestamps computed from the stored offset, so the calendar client needs no timezone database |

---

## 9. Decisions deferred to implementation

These are execution details, not open questions — each has a stated default so
implementation is not blocked.

1. **Colour tokens and type scale.** Settle the final values while writing
   `style.css`, applying the `better-ui` and `high-end-visual-design` skills.
   Constraint: both themes must pass WCAG AA for body text and for all text on
   the accent background, verified with a contrast check before sign-off.
2. **Drag-and-drop library.** Pick at implementation time against these
   requirements: no CDN, no build step, actively maintained, small enough to
   vendor as a single file. Default if undecided: SortableJS. The board must
   remain fully usable via the stage dropdown if the library fails to load.
3. **Historical events.** The three existing events are seeded with
   `stage = 'done'` so the board starts clean and they appear only in the
   collapsed Past group.
4. **Scope note.** This is a large change and must be delivered as the six
   phases in §8.2, one at a time, each independently shippable — not as a single
   commit. The implementation plan should be written per-phase.
