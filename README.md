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
| Repositories | Every repo in the GitHub organisation: show it under Projects, under Resources, or hide it |
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

## Repositories page

Admin > **Repositories** lists every public repo in the GitHub
organisation. For each: show it under Projects, under Resources, or hide
it; **Pin to top** (pinned projects come first on the site, in the order
set with the arrows); and link it to a **study group**, which lists it on
that group's card. New repos show as Projects and archived ones are
hidden until someone chooses otherwise.

**Refresh now** re-reads GitHub and redeploys the site through the
`refresh-site` Edge Function, so a new repo shows without waiting for the
30-minute run. It needs one secret, set once:

1. GitHub > Settings > Developer settings > Fine-grained tokens > Generate:
   resource owner **TheFreeCodeSyndicate**, only the **fcs-site**
   repository, permission **Actions: Read and write**, nothing else.
2. Supabase > Edge Functions > Secrets: `GITHUB_DISPATCH_TOKEN` = the token.

## Blog

Admin > **Blog** opens each post as a full, Notion-style page
(`js/blog-editor.js`): a cover you can upload and drag to reposition, an
icon (emoji, one of the site's icons, or an uploaded image), the title,
properties (address, author, summary), then blocks. Type `/` for the block
menu: text, headings, bulleted, numbered and to-do lists, toggles, quotes,
callouts, dividers, images, YouTube videos, web bookmarks, code (with
syntax highlighting), LaTeX equations (block and inline, via KaTeX),
tables and a table of contents. Markdown shortcuts work as you type
(`# `, `- `, `1. `, `[] `, `> ` toggle, `" ` quote, ```` ``` ````, `---`,
`$$ `, and inline `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`,
`==highlight==`, `$math$`). Selecting text shows a formatting bar; blocks
drag by their handle; Tab nests list items; Ctrl+Z undoes; pasting or
dropping images uploads them. Drafts save as you type; a published post
changes only when you press **Update**.

Posts are stored as Markdown (the syntax is listed at the top of
`js/lib/markdown.js`). The deploy turns each published post into a static
page, `blog/<slug>/`, with its own title and link preview, and writes
`sitemap.xml` (`tools/blog-build.mjs`; neither is committed). Publishing
or updating a live post starts a deploy through `refresh-site`, so it
shows in about a minute. `node tools/blog-build.mjs` previews locally.
KaTeX and highlight.js are vendored under `js/vendor/`, so there is still
no build step or npm dependency.

Page and callout icons: emoji are drawn with [Twemoji](https://github.com/jdecked/twemoji)
(CC-BY 4.0, credited in the blog footer) from jsDelivr, so they look the same on
every system; the picker's list is `js/vendor/emoji/emoji-groups.json` (from
`unicode-emoji-json`, MIT). The Icons tab is every pixelarticons icon
(`assets/pixel-icons.svg`, rebuilt by `tools/build-pixel-icons.mjs`), in
Notion's ten colours (`icon:<name>:<colour>`, migration `024`).

Post text lives in Supabase (`blog_posts`, migration `022`). **Images**
are committed to the public `TheFreeCodeSyndicate/fcs-assets` repository
by the `upload-asset` Edge Function and served by jsDelivr at an address
pinned to the commit, so it never changes and never needs a cache purge.
Only editors and admins can upload; JPG, PNG or WebP up to 2 MB (the
panel shrinks pictures to WebP first). Everything in that repository is
public and permanent, so never upload anything private. Set once:

1. Run `supabase/migrations/022_blog_posts.sql`, `023_blog_page_look.sql` and
   `024_blog_icon_colors.sql` in the SQL editor.
2. GitHub > Fine-grained tokens > Generate: resource owner
   **TheFreeCodeSyndicate**, only the **fcs-assets** repository,
   permission **Contents: Read and write**, nothing else.
3. Supabase > Edge Functions > Secrets: `GITHUB_ASSETS_TOKEN` = the token.

## Analytics

Admin > **Analytics** shows how the public site is used, over the last
24 hours, 7, 30 or 90 days, compared with the period before: visitors,
new visitors, visits, page views, bounce rate (one page, under 10
seconds), time in view, pages per visit; Visitors by device (stacked areas)
and Page views or Visits (bars), by hour or day;
new vs returning and devices; what people did (join links, copy, email
signup, calendar, projects...), which sections they stopped on,
referrers, `utm_` campaigns, pages and rough regions.

How it works, all first-party and free:

- `js/track.js` (public pages only, never the admin) sends small beacons
  to the `collect` Edge Function: a page view, the time the tab was
  actually visible (on leaving, and every 30 seconds), named clicks, and
  sections that stayed mid-screen for a second.
- No cookies. A visitor is a hash of a random daily salt + IP + browser,
  made on the server; the IP is never stored and old salts are deleted,
  so visitors cannot be followed across days. "New" comes from a single
  "been here before" flag in the browser's localStorage.
- Not counted: bots, other sites,
  and localhost (add `?track=1` to test locally). Do Not Track and Global
  Privacy Control are not applied (Brave and Firefox send them by default,
  which would hide most phone visitors); nothing personal is stored.
  Regions come from the browser's timezone, because the host passes no
  country and a VPN would hide the real one anyway. Add `?trackdebug=1` to
  the site address to see on screen whether a visit is being counted.
- Raw rows are readable only through `analytics_report()`, and only by
  admins and editors an admin has switched on (Team page, "Analytics:
  on/off"). Rows older than 13 months are deleted nightly (`pg_cron`).
- Charts follow the look of neobrutalism.dev/charts, drawn in plain SVG.

**Campaigns:** Analytics > *Make a tagged link* builds the address to
share for each place (Instagram, WhatsApp, Discord, YouTube, LinkedIn, X,
Facebook, Telegram, Reddit, Threads, Snapchat, Pinterest, TikTok, email,
QR codes and print, or any name): it adds `utm_source`, `utm_medium` and
an optional `utm_campaign`, lowercased and hyphenated, and copies it.
Visits through it appear under Campaigns.

Migrations `016`-`019`; Edge Function `supabase/functions/collect`.

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
