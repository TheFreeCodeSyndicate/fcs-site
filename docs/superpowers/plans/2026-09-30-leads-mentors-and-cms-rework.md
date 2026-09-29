# Leads & Mentors section, and the admin CMS rework

- **Date:** 2026-09-30
- **Status:** Approved. Phases 1 and 2 built; 3 to 5 next
- **Builds on:** `2026-09-28-fcs-cms-dashboard.md` (Phases 0 to 6, done)

## Why

1. Section 09 "Maintainers" is three hard-coded people in `js/data.js`.
   Nobody can update it without a commit, and the club wants it to be a
   **Leads & Mentors** (core member) section.
2. Each card spends most of its space on GitHub trivia: "profile name",
   "location not listed", public repo count, follower count. None of it
   says what the person does in the club. It also costs one GitHub API
   call per person, which is what emptied the page under the 60/hour
   rate limit.
3. The admin panel works, but it is one long page: the event board,
   then an edit form, then tabs, then more forms. There is no place for
   core members, no way to reorder lists, no preview, and deletes use
   the browser's `confirm()` dialog.

## Research: what good team sections do

Verified live on 2026-09-30 (Sonnet research agent; details marked
"seen" were read from the page or its Awwwards write-up):

| Site | Pattern | Holds up as the roster grows (3 to 30+)? |
|---|---|---|
| [Hack Club team](https://hackclub.com/team) | People grouped by team (Board, Core, Community), photo, name, role. Seen. | Yes. Grouping by role keeps a long roster scannable. |
| [Trimble Group](https://www.trimblegroup.io/about) | Hover a person and the photo swaps to an alternate. Seen (Awwwards). | Yes, the swap is per person and costs nothing at any count. |
| [Roche Musique](https://roche-musique.com) | Index list; hovering a row shows its image. Seen (Awwwards). | **Yes, this is the pattern built for growth.** A list stays compact where cards turn into a wall. |
| [27 Nerds](https://27n.gg/), Orkestra (Locomotive) | Cursor-follow portrait / spotlight. Seen (Awwwards). | Scales, but does nothing on touch and nothing for keyboard users. We take its payoff through a preview panel instead (A2). |
| [PostHog people](https://posthog.com/people) | List / map toggle. Seen. | Built for 200+ people; a map is more than a club needs. |

**Design principle: one layout that works at every size, not a design
that switches at a threshold.** The CMS exists because the team will
grow and change, so the section must look intentional with 3 people and
still read cleanly with 30, without anyone touching code. Two layouts
that swap at "6 people" would be two things to maintain and a visible
jump the day someone is added.

## Part A. The public section

### A1. Layout: featured leads, then a roster

Two tiers, because the club has two tiers and they grow at different
rates. Leads stay few; mentors and future roles are what grows.

**Leads: personnel-file cards.** There are only ever a handful, so each
gets room. Two per row on desktop, one on mobile.

```
┌──────────────────────────────────────────────┐
│ ┌────────┐  LEAD                             │  ← yellow stamp
│ │ pixel  │  Jyotirmoy Das                    │  ← Archivo 800
│ │portrait│  @JyotirmoyDas05                  │
│ └────────┘                                   │
│ $ whois jyotirmoy                            │
│   runs    Anti Aliasing study group          │
│   focus   graphics, web, tooling             │
│   since   2025                               │
│ One or two lines of bio, written for the     │
│ club, not pulled from GitHub.                │
│ [github] [linkedin] [site]                   │  ← pixel icons, 44px targets
└──────────────────────────────────────────────┘
```

**Everyone else: the roster** (Roche Musique's index list). One row per
person, compact at any length:

```
 NO.  NAME                 ROLE      RUNS                  FOCUS
 ─────────────────────────────────────────────────────────────────────
 01   ▣ Ved Bhandary       MENTOR    Systems Reading Room  os, compilers   ▸
 02   ▣ …                  MENTOR    Crypto Study Group    crypto          ▸
```

- `▣` is the 24px pixel portrait, so every row has a face without
  loading a full photo.
- A row is a button: clicking or pressing Enter expands it in place into
  the same personnel file the leads get (bio, whois, links). Only one is
  open at a time.
- **Preview panel on desktop:** beside the roster, a sticky panel shows
  the hovered or focused row's portrait large, developing into the photo
  (A2). It follows focus, not the cursor, so keyboard users get it too.
  On touch screens the panel is hidden and tapping expands the row.
- **Filter chips appear once the roster passes 8 people**: All, then one
  chip per role and per group. It reuses the event filter component, so
  it is not new UI. Below 8 they would be clutter.
- **Past members** (status `alumni`) sit in a collapsed "Past leads and
  mentors (N)" disclosure at the end, like past events. People who step
  down keep their credit without crowding the current team.
- Count in the heading: "Leads & Mentors, 14 people", updated from the
  data.

The roster and the Projects index are both tables, which the taste
skill's layout-repetition rule warns about. They stay distinct: the
roster has portraits, stamps, expanding rows and the preview panel;
Projects is plain text rows that invert on hover.

### A2. Interactions

1. **Pixel portrait that develops into a photo** (Trimble's swap, made
   ours). The default portrait is the GitHub avatar at 24x24
   (`github.com/<user>.png?size=24`) scaled up with
   `image-rendering: pixelated`. That makes a genuine pixel-art face that
   matches the pixelarticons. On hover or keyboard focus, the real
   photo wipes in from top to bottom in 8 hard steps (`clip-path` with
   `steps(8)`), like a scanline. Used on lead cards and in the roster's
   preview panel. With reduced motion on, it swaps instantly.
2. **Focus-driven preview panel** (the payoff of Orkestra's cursor
   spotlight, without its touch and keyboard problems).
3. **Row expands in place**: height animates with `grid-template-rows`
   from `0fr` to `1fr`, so there is no JavaScript height measuring.
4. **Press and lift** and the **staggered reveal** the page already has.
5. Deliberately **not** doing cursor-follow portraits, flip cards or a
   marquee of faces: they hide content or break keyboard and touch use.

### A3. Data and performance

- Avatars come from `github.com/<user>.png`, which is a plain image
  redirect and **not** a rate-limited API call. Section 09 makes
  **zero** GitHub API requests (today it makes one per person, so it
  would get worse with every new member).
- Roster rows load only the 24px avatar (about 1 KB each). The full
  photo loads the first time a row is previewed or expanded, so 30
  people cost about 30 KB up front.
- A `SEED_CORE_MEMBERS` array replaces `MAINTAINERS` in `data.js` as the
  offline fallback, like the other sections.
- Rename the section to **"Core Members"**. The anchor becomes `#core`.
  It is not in the nav, so no nav change is needed.

## Part B. Database

New table `core_members`. The file will be
`supabase/migrations/002_core_members.sql`; you run it once in the SQL
editor.

| Column | Type | Notes |
|---|---|---|
| `name` | text, required | |
| `github_username` | text | Avatar source and the GitHub link |
| `role` | text, required | `lead` or `mentor`. A check constraint, so a new role later is a one-line migration |
| `title` | text | Optional specific title, e.g. "Events lead" |
| `status` | text, required | `active` (default) or `alumni` |
| `group_name` | text | "Runs" line, e.g. a study group |
| `focus` | text[] | Up to 4 short tags |
| `bio` | text | 280 characters max, enforced by a check constraint |
| `photo_url` | text | Optional override if someone won't use their GitHub avatar |
| `linkedin_url`, `website_url` | text | Optional links |
| `joined_on` | date | The "since" line |
| `ended_on` | date | Set when someone moves to alumni |
| `sort_order`, `is_published` | int, boolean | Same as the other tables |

RLS uses the same four policies as every other content table: public
read, editors insert and update, admins delete. It is seeded with
Ronit, Jyotirmoy and Ved.

## Part C. The admin CMS rework

The admin is a tool you operate, not a page you market, so this favours
clarity and speed over decoration. It keeps the site's look.

### C1. Structure

- **Sidebar with one entry per content type**: Events, Class schedule,
  Leads & Mentors, Study groups, Resources, Social links, Repo curation,
  and (admins only) Team. It collapses to a top menu on phones.
- **Each page has its own URL** (`admin.html#/leads`), so a reload or a
  shared link lands in the right place.
- **Each page shows a list, and editing happens in a slide-over drawer**
  on the right, instead of a form at the top of the page:
  - Esc closes it, and keyboard focus stays inside it while it is open.
  - Closing with unsaved changes asks first.
  - Errors show under the field they belong to, not only in a toast.
- **Live preview in the drawer** for people, events and resources. The
  preview uses the same render function as the public page, moved into
  a shared `js/render.js`, so what you see is exactly what gets
  published.
- **Drag to reorder** every list (SortableJS is already vendored), which
  writes `sort_order`. Up and down buttons do the same from the keyboard.
- **Delete without `confirm()`**: the first click turns the button into
  "Click again to delete" for 3 seconds.
- **Empty states** with an "Add the first …" button.

### C2. New pages

- **Leads & Mentors**, built for a list that keeps changing:
  - Fields from Part B, the photo previewed from the GitHub username as
    you type, and the live card preview.
  - A search box and filters (role, status) over the list, so finding
    one person among 30 is instant.
  - Drag to reorder within each role; the public page follows the order.
  - A **"Move to alumni"** action that sets `status` and `ended_on` in
    one click, instead of deleting someone's history.
  - Duplicate GitHub usernames are refused with an inline message.
- **Team** (admins only): everyone with access, their role, and a
  switch between editor and admin. This needs one new RLS policy,
  "admins update profiles", and a guard so an admin cannot demote
  themselves out of the last admin seat.

### C3. Kept

The event Kanban board, the role checks, the RLS-refusal detection in
`supabase.js`, and `tools/verify-admin.mjs`, which is extended to cover
the new pages.

## Phases

Each phase is shippable on its own.

1. **Database.** Migration, seed, adapter functions
   (`getCoreMembers`, `createCoreMember`, …), seed fallback in
   `data.js`. *You:* run the SQL.
2. **Public section.** Lead cards, the roster with expanding rows and
   the preview panel, filter chips above 8 people, the alumni
   disclosure, and the pixel-to-photo portrait; drop the GitHub profile
   fetches. Checked with seed data at 3, 12 and 30 people, in both
   themes and on mobile.
3. **Admin shell.** Sidebar, per-page URLs, drawer, shared `render.js`;
   move the existing editors into it with no behaviour lost.
4. **Leads & Mentors editor.** Drawer form, live preview, search and
   filters, drag reorder, move to alumni.
5. **Team page and polish.** Role switching with the last-admin guard,
   click-again delete, empty states, and an extended `verify-admin.mjs`.

## Decisions (2026-09-30)

1. The section is called **Core Members** (anchor `#core`).
2. Portraits are **pixel art by default**; the photo develops on hover,
   focus or tap.
3. **Links are whatever is filled in** in the CMS: GitHub, LinkedIn,
   Instagram, X, website, email, each an optional column with its pixel
   icon. Discord has no linkable profile, so it is a handle shown as a
   copy button.
4. **GitHub stats are dropped** (repos, followers, location).
