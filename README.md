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
node tools/verify-page.mjs      http://localhost:8000/
node tools/verify-admin.mjs     http://localhost:8000/
node tools/verify-deeplinks.mjs http://localhost:8000/
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
| Subscribers (admins only) | Email lists per event and for all events; send updates |
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
- **Remove** on the Team page deletes someone's login entirely, which ends
  their sessions; the content they edited stays. Admins only, and never
  yourself (`009_remove_member.sql`). Invite them again to bring them back.
- Removing someone, or setting them to **No access**, signs them out at once
  if they have the panel open (Realtime on `profiles`, `010_realtime_profiles.sql`),
  and the sign-in screen tells them why.
- To stop strangers creating accounts at all, turn off **Authentication →
  Sign In / Providers → Allow new users to sign up** in Supabase and invite
  people from **Authentication → Users** instead.

## Link icons

Every link on the site and in the panel (social links, a core member's
website, resources, event and study-group links) gets its icon the same
way (`linkIcon` in `js/render.js`):

1. a **pixel icon** when the site is known from the link itself: Discord,
   Instagram, WhatsApp, GitHub, X/Twitter, LinkedIn, YouTube, and email;
2. otherwise that site's **favicon**, from Google's favicon service (only
   the domain is sent);
3. otherwise, if the site has no favicon, the **default** link icon.

To add a known site: draw a 24px symbol in `assets/icons.svg` and add its
domain to `KNOWN_SITES`.

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

### Email: password resets and invites

Both the **Email me a reset link** button and **Send invite** on the Team
page send email through Supabase Auth. Supabase's built-in email service
only delivers to members of your Supabase organisation's team, a few an
hour, and is not meant for production. To email anyone else, give Supabase
an SMTP server. Free, with no domain needed, using the club Gmail:

1. On the Google account (`thefreecodesyndicate@gmail.com`) turn on
   **2-Step Verification**, then create an **App password**
   (Google Account → Security → App passwords).
2. Supabase → **Authentication → Emails → SMTP Settings** → enable custom SMTP:
   - Host `smtp.gmail.com`, port `465`
   - Username: the full Gmail address; password: the app password
   - Sender email: the same Gmail address; sender name: `The Free Code Syndicate`
3. Install the branded email templates (invite, reset password, password
   changed, email changed, confirm signup, magic link, change email,
   verification code). They live in `tools/email-templates.mjs`; the
   generated HTML is in `supabase/email/`. Either paste each file into
   **Authentication → Emails → Templates**, or push them all at once with a
   personal access token from <https://supabase.com/dashboard/account/tokens>:
   ```bash
   SUPABASE_ACCESS_TOKEN=sbp_... node tools/email-templates.mjs --push
   ```
   Pushing also turns on the "password changed" and "email changed"
   security notices.

An invited person accepts the invite, chooses a password (typed twice), and
lands back on the sign-in page with their email filled in. From then on
they sign in with that email and password, with the role the admin chose.

Gmail allows about 500 emails a day, far more than a club needs. The invite
and reset links return to `/admin.html`, which must be listed under
**Authentication → URL Configuration → Redirect URLs** (it is, for both
localhost and the Pages URL).

Invites go through the `invite-member` Edge Function
(`supabase/functions/invite-member/`): it checks the caller is an admin,
sends the invite and sets the chosen role. The service-role key it uses
stays inside Supabase. Deploy changes with the Supabase CLI or MCP.

### Event updates: calendar feed and email lists

**Calendar.** The deploy workflow writes `events.ics` every 30 minutes
(`tools/events-feed.mjs`). "Add to your calendar" on the events section
subscribes Google, Apple or Outlook Calendar to it, so new and changed
events appear on their own. Each event card still offers a one-off
"Add to calendar".

**Email.** "Email me about events" and each event's "Email me updates"
sign people up through the `event-mail` Edge Function
(`supabase/functions/event-mail/`). They get a confirmation email and
count only once they click it. Admins see the lists on the **Subscribers**
page, can add addresses directly (counted straight away, no confirmation),
send a test to themselves, and send a plain-text update:

- an event's update goes to that event's list and the all-events list;
- an "all events" update goes to everyone on any list;
- one email per person, each with its own unsubscribe link
  (`subscribe.html`), and the send is recorded in the activity log.

The function sends through Gmail with the club's app password. Set it once
under **Supabase → Edge Functions → Secrets**:

| Name | Value |
|------|-------|
| `GMAIL_USER` | `thefreecodesyndicate@gmail.com` |
| `GMAIL_APP_PASSWORD` | the 16-character app password (the same one as the Auth SMTP settings) |

Lists and sends are admin-only in the database
(`011_event_subscriptions.sql`): visitors and editors cannot read them.
Signups are capped at 100 unconfirmed an hour, one confirmation email per
address every 10 minutes, and Gmail allows about 500 emails a day.

### Security model

- The anon key in `js/config.js` is public by design. Everything it can do
  is decided by Row Level Security in Postgres:
  - visitors read only published rows (no drafts, hidden members or
    inactive sessions; `004_hide_unpublished.sql`);
  - editors add and edit, admins also delete, and new accounts have no
    access until approved (`003_team_roles.sql`);
  - the anon role has no write grants at all;
  - the role helper lives in a `private` schema the API does not expose,
    and trigger functions cannot be called over RPC (`005_advisor_fixes.sql`).
- Supabase's security and performance advisors report nothing to fix
  except leaked-password protection, which is a password-policy choice.
- Both pages carry a Content-Security-Policy `<meta>`: scripts from this
  site only, network calls only to Supabase, GitHub and Discord. If you add
  another service, add its origin to `connect-src` in both `index.html`
  and `admin.html`.
- The admin panel refuses to run inside another site's frame.

The anon key is designed to be public and is safe to commit. All authorisation
is enforced by Row Level Security in Postgres. **Never put the service-role key
in `js/config.js`** — it would be readable by anyone who visits the site.

## Deploying to GitHub Pages

The site deploys with GitHub Actions (`.github/workflows/pages.yml`), on
every push to `master`, every 30 minutes, and on demand from the Actions
tab.

One-time setup: **Settings → Pages → Build and deployment → Source:
GitHub Actions**.

Each run runs the unit tests, then writes `data/github.json` (the
organisation's repositories and the latest commit) with the workflow's own
token, and publishes it with the site. Visitors read that file instead of
calling GitHub's API, so the 60-requests-an-hour limit per visitor no
longer applies. The committed `data/github.json` is a placeholder: locally,
or if the workflow ever stalls for more than three hours, the page falls
back to the live API.

GitHub pauses scheduled workflows in repositories with no activity for 60
days; any push re-enables them, and the page falls back to the live API in
the meantime.

`.nojekyll` makes Pages serve the files as-is.

## Notes and limits

- Visitors read GitHub data from `data/github.json`, refreshed by the deploy
  workflow every 30 minutes. Only if that file is missing or stale does the
  browser call GitHub's API directly (60 requests an hour per visitor IP);
  those answers are cached for ten minutes, and if the limit is hit the
  Projects section degrades to a link to the organisation page.
- The Supabase free project pauses after a period of inactivity. Because every
  read falls back to seed data, that degrades to a stale-but-working page rather
  than a broken one. Reactivate it from the Supabase dashboard.
- Schedule edits appear on the next visitor reload. There is no live push.
