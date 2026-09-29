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

Two headless browser checks live in `tools/`. They need Playwright, which is
deliberately not a project dependency:

```bash
npm install --no-save --no-package-lock playwright
node tools/verify-page.mjs  http://localhost:8000/
node tools/verify-admin.mjs http://localhost:8000/
```

## The admin panel

<http://localhost:8000/admin.html> locally, `/admin` once deployed. Sign in
with a Supabase account.

A sidebar lists one page per kind of content, each at its own address
(`admin.html#/core`, `#/events`, ...):

| Page | What it edits |
|------|---------------|
| Events | The Kanban board: Draft, Scheduled, Live, Done |
| Class schedule | Weekly recurring sessions (the countdown and week strip) |
| Core members | Leads and mentors, including Move to alumni |
| Study groups, Resources, Social links | The matching public sections |
| Repo curation | Which GitHub repos show under Resources instead of Projects |
| Team (admins only) | Who has access, and approving new accounts |

Clicking a row opens an editing drawer with a **live preview** of the card,
drawn by the same code as the public page (`js/render.js`). Lists reorder
by dragging the handle or with the arrow buttons. Delete asks for a second
click. `/` focuses search and `n` starts a new item.

**The public page derives each event's status from its own timestamp**, so
a past event shows FINISHED even if nobody moved its card.

### Access

- New accounts start with **no access** until an admin approves them on the
  Team page. Editors add and edit; admins can also delete and manage the team.
- The database refuses role changes by anyone but an admin, and never lets
  the last admin be removed (`supabase/migrations/003_team_roles.sql`).
- To stop strangers creating accounts at all, turn off **Authentication →
  Sign In / Providers → Allow new users to sign up** in Supabase and invite
  people from **Authentication → Users** instead.

## Where content lives

| Content | Source |
|---------|--------|
| Principles, contribution lanes | `js/data.js`, fixed page copy |
| Events, class schedule, resources, study groups, social links, core members | Supabase, editable at `/admin` |
| Projects | GitHub API, live at page load |
| Fallback for all database content | the `SEED_*` arrays in `js/data.js` |

The `SEED_*` arrays are a **fallback only**. Edit content in the admin panel,
not in code.

## Setting up Supabase

1. Create a free project at <https://supabase.com>.
2. Run `supabase/schema.sql` in the SQL editor, then each file in
   `supabase/migrations/` in number order.
3. Paste the project URL and anon key into `js/config.js`.
4. Sign up, then promote yourself to admin:
   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```
5. For each other maintainer, create an account under **Authentication →
   Users**, then approve it on the admin panel's Team page. New accounts have
   no access until approved.

The anon key is designed to be public and is safe to commit. All authorisation
is enforced by Row Level Security in Postgres. **Never put the service-role key
in `js/config.js`** — it would be readable by anyone who visits the site.

## Deploying to GitHub Pages

1. Push to the root of a repository, a `/docs` folder, or a dedicated branch.
2. Set **Settings → Pages** to that location.
3. In Supabase → Authentication → URL Configuration, set **Site URL** to the
   published Pages URL. Left on localhost, password-reset emails point at a
   dead page.

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
