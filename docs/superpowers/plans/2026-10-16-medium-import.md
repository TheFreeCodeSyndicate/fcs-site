# Import from Medium — implementation plan

- **Date:** 2026-10-16
- **Status:** Implementation complete on `feat/medium-import`, reviewed task by task;
  the evidence for each task is in the SDD ledger,
  `.superpowers/sdd/2026-10-16-medium-import/progress.md`. The boxes below were
  ticked at hand-off to match the delivered tasks. **Twenty-two boxes stay open
  because only a human can close them**: Task 0.1 Steps 2–3 (run migration 033),
  Task 2.1 Steps 3–4 (deploy the function; smoke it from the browser), the four
  in-browser verifications (3.1 Step 6, 4.1 Step 4, 4.2 Step 3, 4.3 Step 4), all
  seven steps of Task 6.2, and the three external gates at the end of this file.
- **Spec:** `docs/superpowers/specs/2026-10-16-medium-import-design.md`
- **Builds on:** `2026-09-28-fcs-cms-dashboard.md` (the admin panel, the blog
  editor, `js/lib/markdown.js`, the `upload-asset` Edge Function and its
  `asset.js` helpers, and the `npm test` harness)

## Scope decomposition — read this first

Seven task groups. Phase 0 needs you (one SQL statement); **everything else is
buildable and verifiable without you**, and Phases 1–5 each leave the site in a
working state. Do not merge them into one commit.

| Phase | Ships | Needs a human? |
|-------|-------|----------------|
| 0 | `blog_posts.source_url` (migration 033) | **Yes — run one SQL statement** |
| 1 | The pure conversion module + its tests | No |
| 2 | The `medium-import` Edge Function + client wrappers | Partly — deploy the function |
| 3 | The import wizard | No |
| 4 | Both entry points | No |
| 5 | Provenance, duplicate warning, attribution line | No |
| 6 | Verification pass and README | No |

**Phase 1 is the load-bearing phase.** The conversion module is where all the
fidelity lives, it is pure, and it is the only part with real tests. Get it right
against a real captured feed before anything is wired to a button.

**The one thing to do first:** capture a real story's HTML and commit it as a
test fixture (Task 1.0). Everything downstream is measured against it.

## File map

| File | Responsibility |
|------|----------------|
| `supabase/functions/medium-import/index.ts` | The HTTP entry: CORS, auth, the three actions, image re-hosting |
| `supabase/functions/medium-import/medium.js` | **Pure.** Nothing but `URL`, `Date` and `JSON`: input parsing, feed parsing, boilerplate stripping, HTML→blocks, serialisation, fitting, image addresses |
| `js/lib/medium.test.js` | The pure module's tests, driven by a real captured story |
| `js/medium-import.js` | The three-step wizard overlay (Find / Choose / Confirm) + live preview |
| `js/supabase.js` | Three new wrappers: `mediumFeed`, `mediumStory`, `mediumImport` |
| `js/admin.js` | `pageHead`'s new `extra` slot, the Blog-page button, the wizard's wiring, the new-draft hand-off |
| `js/blog-editor.js` | `opts.initial` for a pre-filled new post; `opts.importMedium`; the ⋯ menu item; insert-at-cursor |
| `css/admin.css` | Wizard styles |
| `supabase/migrations/033_blog_source_url.sql` | The provenance column |
| `README.md` | One section on the Medium importer and its limits |

**Deliberately not touched:** `admin.html`'s Content-Security-Policy (nothing new
is ever contacted from the browser), `js/lib/markdown.js` (reused as-is, and it
is the reference the tests check against), and `upload-asset` (its `asset.js`
helpers are imported, not edited).

## Repository facts this plan is built on

Verified against the files on disk on 2026-10-16.

- `npm test` runs `node --test js/lib/*.test.js`; **140 tests currently pass**,
  and `js/lib/markdown.js` imports cleanly under Node despite pulling in KaTeX
  and highlight.js — so a test may import the real `parseBlocks`.
- The repo's convention for an Edge Function's pure logic: keep it in the
  function's own folder, free of Deno APIs, and test it from `js/lib/*.test.js`
  via a relative path. `js/lib/asset.test.js` line 3 imports
  `../../supabase/functions/upload-asset/asset.js`. Follow that exactly.
- `upload-asset/index.ts` gives the auth pattern to copy: anon client + the
  caller's bearer token → `auth.getUser()` → 401; service-role client reading
  `profiles.role` → 403 unless `admin`/`editor`; a missing
  `GITHUB_ASSETS_TOKEN` → 501.
- `upload-asset/asset.js` exports `REPO`, `MAX_BYTES` (2 MB), `sniffType`
  (PNG/JPEG/WebP only), `refusal`, `assetPath(bytes, now, id)`,
  `cdnURL(sha, path)`.
- `js/lib/markdown.js` block types the converter must emit: `p`, `h1`–`h4`,
  `bullet`, `number`, `quote`, `code`, `image`, `divider`, `video`. Blocks
  `h1`–`h4` render as page `h2`–`h5`; a `code` block with an empty `lang`
  renders with no caption and no highlighting; a `p` whose first line would look
  like a block start is escaped with `\` by `serializeBlocks`.
- `blog-editor.js`: `post` is built at ~line 309 as `{...defaults, ...opts.row}`;
  the initial render is `titleEl.textContent = post.title` (3982),
  `loadBody(post.body)` (3984), `paintProps()` (3987). `importMarkdown(file)`
  (3158) appends and calls `changed({ structural: true })`. `blockEl`,
  `blockOfCaret`, `focusBlock` and `changed` are in the same closure as the ⋯
  menu's `run` handlers (2826+). `CONTENT_KEYS` (244) lists the keys drafts and
  versions snapshot; `values()` (1002) builds the write payload.
- `admin.js`: `pageHead(page, { count, newLabel, search })` (733) renders
  `.page-actions` with `#page-new`; `renderBlogPage` (1397) calls it at 1438 and
  binds `#page-new` at 1457; `openEditor(id, row)` is at 1630; `openPostEditor`
  (1006) assembles the editor's options and receives `row`.
- `js/supabase.js`'s `invokeFunction(name, body)` (396) unwraps the function's
  JSON `{ error }` and throws an `Error` with that text.
- `blog_posts` limits: `title` 1–160 chars, `excerpt` ≤300, `slug` matching
  `^[a-z0-9]+(-[a-z0-9]+)*$` and ≤80, `cover_url` matching `^https://\S+$`,
  `body` ≤200,000 chars. `duplicate` in `openPostEditor` shows the slug-uniquifying
  pattern to copy (1055–1061).
- `js/member-picker.js` is the template for a small overlay that cleans up after
  itself: a container element, `role="dialog"`, capture-phase `pointerdown` to
  close on outside clicks, capture-phase `keydown` for Escape, and a
  module-level `open` handle.

## Medium facts this plan is built on

Probed live on **2026-10-16**; the spec's §4 holds the full table. These are the
ones that change the code:

- The feed is the only reachable surface — `medium.com/feed/@handle`, or
  `<custom-domain>/feed` — and it is always the newest **ten** items. There is no
  pagination: `?limit`, `?page`, `?p`, `?offset`, `?count`, `?before`, `?after`
  all return byte-identical bodies, and the Atom `<link>` carries only `self` and
  `hub`.
- `medium.com/feed/@handle/tagged/<tag>` is a **404**. Publication tag feeds
  (`medium.com/feed/<publication>/tagged/<tag>`) work but are not author-scoped.
  Never offer a tag as a fallback for older work.
- **Embeds come in two shapes.** A third-party Embedly frame carries the real
  target in its `src`'s `url` parameter and **is recoverable** — 8 of 15 frames
  in one real feed. A gist or a native Medium embed has `src=""` and is not.
  Handle the recoverable case *before* the drop rule runs, or the importer
  discards embeds it could have kept.
- **A paywalled item has no `<content:encoded>`** — only a teaser. That is 1 of
  10 personal items, 2 of 10 in an open publication, and **all 10** in a
  Partner-Program publication. One `importable: false` covers every case.
- **Code language is absent**: 0 `<code>` tags anywhere, and no class on any
  `<pre>`. Do not invent one.
- **Maths arrives as an image**, never as TeX.
- **Images**: `cdn-images-1.medium.com/<key>` 301s to `/v2/<key>`, and
  `miro.medium.com/v2/resize:fit:<w>/<key>` serves any width, clamped to the
  original. `/v2/<key>` is **not** the largest rendition (249 KB where
  `resize:fit:1400` gave 313 KB), so always request an explicit width.

---

# Phase 0 — Database

### Task 0.1: `source_url` on `blog_posts`

**Files:**
- Create: `supabase/migrations/033_blog_source_url.sql`

The address of the story a post came from. Nothing reads it until Phase 5, but
`values()` will start sending it, and an unknown column would fail the write — so
this lands before any code.

- [x] **Step 1: Write the migration**

`supabase/migrations/033_blog_source_url.sql`:

```sql
-- ====================================================================
-- 033_blog_source_url.sql
-- --------------------------------------------------------------------
-- Where an imported post came from. Set by the Medium importer
-- (supabase/functions/medium-import) and null for everything written by
-- hand. It is kept whether or not the writer includes the visible
-- "Originally published on Medium" line, so the record of provenance
-- does not depend on the body text.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
-- ====================================================================

alter table public.blog_posts
  add column if not exists source_url text
    check (source_url is null or source_url ~* '^https://\S+$');
```

- [ ] **Step 2: Run it in the Supabase SQL editor**

Ask for this explicitly; it is the only step in the whole plan that needs you
before Phase 6.

- [ ] **Step 3: Confirm**

```sql
select column_name, data_type from information_schema.columns
 where table_name = 'blog_posts' and column_name = 'source_url';
```

Expected: one row, `source_url | text`.

---

# Phase 1 — The pure conversion module and its tests (lands dark)

Nothing in this phase is imported by the site. It is the fidelity, isolated and
testable, exactly like `asset.js` before `upload-asset` was wired to the editor.

### Task 1.0: Capture a real story as a test fixture

**Files:**
- Create: `supabase/functions/medium-import/medium.js` (the fixture goes in the test, Task 1.1)

The tests are only as good as the input they use. Capture one for real.

- [x] **Step 1: Fetch a feed and lift one item's content**

```bash
curl -s -A "Mozilla/5.0" "https://medium.com/feed/@theyasser" -o feed.xml
```

Pick an item whose `<content:encoded>` contains **a code block split across
several `<pre>` siblings**, a `<figure>` with a `<figcaption>`, a
`<blockquote>`, a `<ul>`, an `<hr>`, the `/_/stat` pixel and the footer. Paste
its content into the test as `STORY_HTML` (Task 1.4).

- [x] **Step 2: Note what the fixture proves**

Expected inside `STORY_HTML`, from live observation on 2026-10-16:
`<pre>` runs where 28 of 50 `<pre>` are immediately followed by another,
`<br>` inside `<pre>` for line breaks, `&#39;`/`&quot;`/`&lt;` entities,
`<img src="https://medium.com/_/stat?event=post.clientViewed…" width="1" height="1">`,
and a closing
`<hr><p><a href="…">…</a> was originally published in <a href="…">…</a> on Medium, where people are continuing the conversation…</p>`.

### Task 1.1: Module skeleton, `parseInput`, `feedURLFor`

**Files:**
- Create: `supabase/functions/medium-import/medium.js`
- Create: `js/lib/medium.test.js`

- [x] **Step 1: Write the failing test**

`js/lib/medium.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { parseBlocks } from "./markdown.js";
import { parseInput, feedURLFor } from "../../supabase/functions/medium-import/medium.js";

test("an @handle is recognised", () => {
  assert.deepEqual(parseInput("@janedoe"), { kind: "handle", handle: "janedoe" });
});

test("a bare handle is recognised", () => {
  assert.deepEqual(parseInput("  janedoe  "), { kind: "handle", handle: "janedoe" });
});

test("a profile address is recognised", () => {
  assert.deepEqual(parseInput("https://medium.com/@janedoe"), { kind: "handle", handle: "janedoe" });
});

test("a story address yields its handle and its 12-hex id", () => {
  const got = parseInput("https://medium.com/@janedoe/why-i-left-5123886e38bd?source=rss-abc");
  assert.equal(got.kind, "story");
  assert.equal(got.handle, "janedoe");
  assert.equal(got.postId, "5123886e38bd");
});

test("a publication's own domain is recognised", () => {
  const got = parseInput("https://levelup.gitconnected.com/the-hidden-cost-5123886e38bd");
  assert.equal(got.kind, "story");
  assert.equal(got.host, "levelup.gitconnected.com");
  assert.equal(got.postId, "5123886e38bd");
});

test("a subdomain profile is recognised", () => {
  const got = parseInput("https://janedoe.medium.com/why-i-left-5123886e38bd");
  assert.equal(got.handle, "janedoe");
  assert.equal(got.postId, "5123886e38bd");
});

test("a /p/ short link is a story with no feed to derive", () => {
  const got = parseInput("https://medium.com/p/5123886e38bd");
  assert.equal(got.kind, "story");
  assert.equal(got.postId, "5123886e38bd");
  assert.equal(got.handle, undefined);
});

test("junk is refused", () => {
  assert.equal(parseInput("have you seen this article"), null);
  assert.equal(parseInput(""), null);
  assert.equal(parseInput("https://example.com/hello"), null);
});

test("feed addresses follow from the input", () => {
  assert.equal(feedURLFor(parseInput("@janedoe")), "https://medium.com/feed/@janedoe");
  assert.equal(feedURLFor(parseInput("https://medium.com/@janedoe/why-5123886e38bd")), "https://medium.com/feed/@janedoe");
  assert.equal(feedURLFor(parseInput("https://janedoe.medium.com/why-5123886e38bd")), "https://medium.com/feed/@janedoe");
  assert.equal(feedURLFor(parseInput("https://levelup.gitconnected.com/why-5123886e38bd")), "https://levelup.gitconnected.com/feed");
  assert.equal(feedURLFor(parseInput("https://medium.com/level-up-coding/why-5123886e38bd")), "https://medium.com/feed/level-up-coding");
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npm test`
Expected: `Cannot find module '…/medium.js'`.

- [x] **Step 3: Write the module**

`supabase/functions/medium-import/medium.js` — the header comment matters, because
it is the rule that keeps this file testable:

```js
// supabase/functions/medium-import/medium.js
// --------------------------------------------------------------------
// Pure helpers for the Medium importer, kept free of Deno and network
// APIs so `npm test` can import them (js/lib/medium.test.js), exactly as
// upload-asset/asset.js is imported by js/lib/asset.test.js.
//
// Only URL, Date and JSON are used. Nothing here fetches anything.
// --------------------------------------------------------------------

const HEX = /^(?:https?:\/\/)?(?:www\.)?/i;
const STORY_ID = /-([0-9a-f]{12})(?:[?#]|$)/i;
const SHORT_ID = /^https?:\/\/(?:www\.)?medium\.com\/p\/([0-9a-f]{12})(?:[?#]|$)/i;
const PROFILE = /^https?:\/\/(?:www\.)?medium\.com\/@([A-Za-z0-9_.-]+)(?:\/([^?#]*))?/i;
const SUBDOMAIN = /^https?:\/\/([a-z0-9-]+)\.medium\.com\/([^?#]*)/i;
const PUBLICATION = /^https?:\/\/(?:www\.)?medium\.com\/([A-Za-z0-9-]+)\/([^?#]*)/i;
const BARE_HANDLE = /^@?([A-Za-z0-9][A-Za-z0-9_.-]*)$/;

/** Medium's own paths that are not publications. */
const NOT_A_PUBLICATION = new Set(["p", "feed", "tag", "search", "me", "new-story", "m", "about", "policy", "membership"]);

/**
 * What the writer typed.
 * @returns {{kind:"handle"|"story", handle?:string, host?:string, postId?:string}|null}
 */
export function parseInput(text) { /* … */ }

/** The feed to fetch for a parsed input, or null. */
export function feedURLFor(input) { /* … */ }
```

Implementation notes that the tests pin down:

- A `story` keeps **both** `postId` and whatever identifies the feed
  (`handle`, or `host` for a custom domain, or `publication` for
  `medium.com/<publication>/…`).
- A `medium.com/p/<id>` link has a post id and no derivable feed: the caller must
  ask for a handle (spec §5.2, last row).
- `medium.com/@handle` with no second path segment is a **handle**, not a story.
- A bare word is a handle; anything containing `/` or `.com` that is not a
  Medium address is junk (`null`), so `https://example.com/x` is refused.
- `NOT_A_PUBLICATION` stops `medium.com/tag/react` being read as a publication.

- [x] **Step 4: Run the tests until they pass**

Run: `npm test`
Expected: `pass` increases by 9, `fail 0`.

- [x] **Step 5: Commit**

```bash
git add supabase/functions/medium-import/medium.js js/lib/medium.test.js
git commit -m "feat(medium): recognise handles and story addresses"
```

### Task 1.2: `parseFeed`

**Files:**
- Modify: `supabase/functions/medium-import/medium.js`
- Modify: `js/lib/medium.test.js`

- [x] **Step 1: Write the failing test**

Add a trimmed real feed as `FEED_XML`: two items, one with
`<content:encoded>`, one member-only without it (it says "Continue reading on").
Then:

```js
test("a feed becomes a story list", () => {
  const { author, stories } = parseFeed(FEED_XML);
  assert.equal(author, "Yasser El-Sayed");            // from <dc:creator> CDATA
  assert.equal(stories.length, 2);
  assert.equal(stories[0].id, "5123886e38bd");        // from <guid>, not <link>
  assert.equal(stories[0].importable, true);
  assert.equal(stories[0].publication, "Level Up Coding");
  assert.equal(stories[0].publishedAt, "2025-04-23T16:31:38.000Z");
  assert.ok(!stories[0].url.includes("source=rss"));  // the tracking query is dropped
});

test("a member-only story is listed but not importable", () => {
  const { stories } = parseFeed(FEED_XML);
  assert.equal(stories[1].importable, false);
  assert.match(stories[1].reason, /member-only/i);
  assert.equal(stories[1].thumbnail, "");
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npm test`

- [x] **Step 3: Implement**

Requirements the tests pin down:

- The id comes from `<guid>` (`https://medium.com/p/<12hex>`), **not** `<link>`,
  because a publication's `<link>` is on its own domain while `<guid>` is
  canonical.
- `<link>` keeps its `?source=rss-…` query stripped.
- The author is the first `<dc:creator>`'s CDATA, with the CDATA wrapper removed.
- `importable` is false when there is no `<content:encoded>`; `reason` says
  "Medium publishes only a teaser for member-only stories."
- `publication` comes from the footer's
  `… was originally published in <a …>Publication</a> on Medium …`, and falls
  back to the `<link>`'s host.
- `excerpt` is the text of the first `<p>`; `thumbnail` the first `<img src>`
  that is not the `/_/stat` pixel.

### Task 1.3: `stripBoilerplate`

**Files:**
- Modify: `supabase/functions/medium-import/medium.js`
- Modify: `js/lib/medium.test.js`

- [x] **Step 1: Write the failing test**

```js
test("the tracking pixel is dropped", () => {
  const html = `<p>Body</p><img src="https://medium.com/_/stat?event=post.clientViewed&postId=x" width="1" height="1" alt="">`;
  assert.equal(stripBoilerplate(html), "<p>Body</p>");
});

test("the 'originally published' footer and its rule are dropped", () => {
  const html = `<p>Body</p><hr><p><a href="https://x/a-1a2b3c4d5e6f">A</a> was originally published in <a href="https://x">P</a> on Medium, where people are continuing the conversation.</p>`;
  assert.equal(stripBoilerplate(html), "<p>Body</p>");
});

test("a real divider in the article is kept", () => {
  assert.equal(stripBoilerplate(`<p>a</p><hr><p>b</p>`), `<p>a</p><hr><p>b</p>`);
});
```

- [x] **Step 2: Run it and watch it fail**

- [x] **Step 3: Implement**

Three removals, in this order: every `<img>` whose `src` starts
`https://medium.com/_/stat`; a trailing
`<hr>\s*<p>[\s\S]*?on Medium, where people are continuing the conversation[\s\S]*?</p>`;
and any rule left dangling at the very end. An `<hr>` with ordinary paragraphs
on **both** sides survives, which is the test that stops this becoming a blunt
`<hr>` stripper.

### Task 1.4: `parseHTML`

**Files:**
- Modify: `supabase/functions/medium-import/medium.js`
- Modify: `js/lib/medium.test.js`

- [x] **Step 1: Write the failing test**

```js
test("entities are decoded", () => {
  assert.equal(textOf(parseHTML(`<p>a &amp; b &#39;c&#39; &lt;d&gt; &quot;e&quot;</p>`)), `a & b 'c' <d> "e"`);
});

test("br becomes a newline", () => {
  assert.equal(textOf(parseHTML(`<p>a<br>b<br></p>`)), "a\nb\n");
});

test("an attribute value containing > does not end the tag", () => {
  const [a] = parseHTML(`<a href="https://x/?q=a>b">t</a>`);
  assert.equal(a.attrs.href, "https://x/?q=a>b");
});

test("void elements do not swallow the rest", () => {
  const nodes = parseHTML(`<p>x</p><img src="https://y/1.png"><hr><p>z</p>`);
  assert.deepEqual(nodes.map((n) => n.tag), ["p", "img", "hr", "p"]);
});
```

- [x] **Step 2: Run it and watch it fail**

- [x] **Step 3: Implement**

A small tokeniser, not a parser for the web: split on tags with a regex that
walks attributes quote-aware (`/<\/?([a-zA-Z][\w-]*)((?:\s+[\w-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/`),
keep a stack, treat `br`, `hr`, `img`, `meta`, `link` and `input` as void, and
ignore anything unrecognised. Entities: `&amp; &lt; &gt; &quot; &#39; &nbsp;`
plus `&#\d+;` and `&#x[0-9a-f]+;`.

Export a `textOf(nodes)` helper — it is what most of the other tests assert with,
and the converter uses it for labels and captions.

### Task 1.5: `htmlToSections` and `serializeSection`

**Files:**
- Modify: `supabase/functions/medium-import/medium.js`
- Modify: `js/lib/medium.test.js`

This is the task that decides whether the import looks like the article.

- [x] **Step 1: Write the failing test**

The important assertion is the **round-trip through the site's own parser**:

```js
test("a real story's sections round-trip through parseBlocks", () => {
  const sections = htmlToSections(STORY_HTML);
  for (const s of sections) {
    const types = parseBlocks(s.markdown).map((b) => b.type);
    assert.ok(types.length >= 1, `empty section: ${s.id} ${s.label}`);
    assert.ok(types.every((t) => ["p", "h1", "h2", "h3", "h4", "bullet", "number", "quote", "code", "image", "divider", "video"].includes(t)),
      `${s.id} produced ${types.join(",")}`);
  }
});

test("consecutive <pre> siblings merge into one code block", () => {
  const sections = htmlToSections(`<pre>import a from &#39;b&#39;;<br>import c from &#39;d&#39;;<br></pre><pre>let e = 1;</pre>`);
  const [code] = parseBlocks(sections[0].markdown);
  assert.equal(code.type, "code");
  assert.equal(code.code, "import a from 'b';\nimport c from 'd';\nlet e = 1;");
});

test("a figure becomes an image with its caption", () => {
  const sections = htmlToSections(`<figure><img src="https://cdn-images-1.medium.com/max/1024/1*abc.png" alt="alt"><figcaption>A chart</figcaption></figure>`);
  const [img] = parseBlocks(sections[0].markdown);
  assert.equal(img.type, "image");
  assert.equal(img.caption, "A chart");
  assert.equal(img.url, "https://cdn-images-1.medium.com/max/1024/1*abc.png");
});

test("h3 and h4 map to the site's first two heading levels", () => {
  const got = htmlToSections(`<h3>One</h3><h4>Two</h4>`).map((s) => s.markdown);
  assert.deepEqual(got, ["# One", "## Two"]);
});

test("a list is one section, indented by nesting", () => {
  const [s] = htmlToSections(`<ul><li>a</li><li>b<ul><li>c</li></ul></li></ul>`);
  const blocks = parseBlocks(s.markdown);
  assert.deepEqual(blocks.map((b) => [b.type, b.indent, b.text]), [["bullet", 0, "a"], ["bullet", 0, "b"], ["bullet", 1, "c"]]);
});

test("a medium media embed is dropped and reported, never linked", () => {
  const { sections, dropped } = htmlToSections(`<p>a</p><iframe src="" width="0" height="0"><a href="https://medium.com/media/abc123/href">https://medium.com/media/abc123/href</a></iframe><p>b</p>`, { dropped: true });
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].kind, "embed");
  assert.ok(!JSON.stringify(sections).includes("medium.com/media"));
});

test("a youtube link becomes a video block", () => {
  const [s] = htmlToSections(`<p>See <a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">this</a>.</p>`);
  assert.ok(s.markdown.includes("@[video](https://www.youtube.com/watch?v=dQw4w9WgXcQ)"));
});

test("a youtube Embedly frame becomes a video block, not a loss", () => {
  const html = `<iframe src="https://cdn.embedly.com/widgets/media.html?src=https%3A%2F%2Fwww.youtube.com%2Fembed%2Fdpw9EHDh2bM%3Ffeature%3Doembed&amp;display_name=YouTube&amp;url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Ddpw9EHDh2bM&amp;key=k&amp;type=text%2Fhtml&amp;schema=youtube" width="854" height="480" frameborder="0" scrolling="no"></iframe>`;
  const { sections, dropped } = htmlToSections(html, { dropped: true });
  assert.ok(sections[0].markdown.includes("@[video](https://www.youtube.com/watch?v=dpw9EHDh2bM)"));
  assert.equal(dropped.length, 0);
});

test("a non-youtube Embedly frame keeps its recovered link and never leaks the frame", () => {
  const html = `<iframe src="https://cdn.embedly.com/widgets/media.html?type=text%2Fhtml&amp;key=k&amp;schema=twitter&amp;url=https%3A//twitter.com/u/status/1056594421079261185&amp;image=i" width="500" height="281"></iframe>`;
  const [s] = htmlToSections(html);
  assert.ok(s.markdown.includes("https://twitter.com/u/status/1056594421079261185"));
  assert.ok(!s.markdown.includes("embedly.com"));
});

test("an empty frame with no recoverable target is still a reported loss", () => {
  const html = `<iframe src="" width="0" height="0"><a href="https://medium.com/media/deadbeef/href">https://medium.com/media/deadbeef/href</a></iframe>`;
  const { sections, dropped } = htmlToSections(html, { dropped: true });
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].kind, "embed");
  assert.ok(!JSON.stringify(sections).includes("medium.com/media"));
});
```

- [x] **Step 2: Run it and watch it fail**

- [x] **Step 3: Implement**

Section boundaries: a new section starts at a block that is not
`bullet`/`number` (a list run is one section), not a `<pre>` that follows another
`<pre>` (one code block), and not a `<p>` that continues an image's caption.
`serializeSection` mirrors `serializeBlocks` for `p`, `h1`–`h4`, `bullet`,
`number`, `quote`, `code`, `image`, `divider`, `video` only, joining consecutive
list items with a single newline and everything else with a blank line — the same
rules `js/lib/markdown.js` uses, which is why the round-trip test passes.

Watchers, in order of how much they matter:

- **Merge `<pre>` runs before anything else**, or a twenty-line snippet becomes
  eight code boxes.
- **An Embedly `<iframe>` is not a loss.** Decode its `url` query parameter
  *before* the drop rule runs: a YouTube target becomes a `@[video]` block,
  anything else a paragraph holding the recovered link. Only a frame with an
  empty `src` falls through to `dropped`. Verified 2026-10-16: 8 of 15 frames in
  one real feed carried a real `src`; the other 7 did not.
- `<code lang="">` — no language is available and none is invented.
- A `<p>` that wraps an `<img>` becomes an image block, not a paragraph.
- A `<blockquote>` whose whole content is a heading becomes a quote carrying that
  text, not a heading inside a quote.
- Anything unrecognised contributes its text to the current paragraph rather than
  being dropped, so no prose is ever silently lost.

- [x] **Step 4: Run the tests until they pass**

Run: `npm test`
Expected: `fail 0`.

### Task 1.6: `clipText`, `fitSections`, `attributionLine`, `mediumImageID`

**Files:**
- Modify: `supabase/functions/medium-import/medium.js`
- Modify: `js/lib/medium.test.js`

- [x] **Step 1: Write the failing test**

```js
test("text is clipped by code points, not UTF-16 units", () => {
  assert.equal(clipText("😀😀😀", 2), "😀😀");
  assert.equal([...clipText("😀😀😀", 2)].length, 2);
});

test("clipping adds an ellipsis only when it cuts", () => {
  assert.equal(clipText("hello", 10), "hello");
  assert.equal(clipText("hello there", 5), "hello…");
});

test("sections are kept whole or dropped from the end", () => {
  const sections = [{ markdown: "a".repeat(6) }, { markdown: "b".repeat(6) }, { markdown: "c".repeat(6) }];
  const { sections: kept, dropped } = fitSections(sections, { maxBody: 15 });
  assert.equal(kept.length, 2);      // 6 + 2 + 6 = 14, the third would make 22
  assert.equal(dropped.length, 1);
});

test("the attribution line links the original", () => {
  assert.equal(attributionLine({ url: "https://medium.com/@a/x-1a2b3c4d5e6f" }),
    "Originally published on [Medium](https://medium.com/@a/x-1a2b3c4d5e6f)");
});

test("a Medium image's asset id survives both address shapes", () => {
  assert.equal(mediumImageID("https://cdn-images-1.medium.com/max/1024/1*abc.png"), "1*abc.png");
  assert.equal(mediumImageID("https://cdn-images-1.medium.com/v2/resize:fit:1024/1*abc.png"), "1*abc.png");
  assert.equal(mediumImageID("https://miro.medium.com/v2/resize:fit:1400/1*abc.png"), "1*abc.png");
  assert.equal(mediumImageID("https://miro.medium.com/v2/1*abc.png"), "1*abc.png");
  assert.equal(mediumImageID("https://cdn-images-1.medium.com/1*abc.png"), "1*abc.png");
  assert.equal(mediumImageID("https://example.com/a.png"), null);
});
```

- [x] **Step 2: Run it and watch it fail**

- [x] **Step 3: Implement**

- `clipText(text, max)` counts with `[...text].length` so an emoji-heavy title is
  not cut short, and appends `…` only when it actually cut.
- `fitSections(sections, { maxBody })` accumulates `[...markdown].length` plus the
  two characters of each `"\n\n"` join, **breaks at the first overflow**, and
  reports the rest as dropped. Breaking (rather than skipping) is what makes the
  message "the last N sections were left out" true.
- `mediumImageID(url)` returns the tail after the size prefix — handling
  `/max/<n>/`, `/v2/resize:fit:<n>/` and a bare `/v2/<id>` — or `null` when the
  address is not a Medium CDN address. Add `resizeURL(id, width = 1400)` →
  `https://miro.medium.com/v2/resize:fit:${width}/${id}`, which is the fallback
  used when an image is over 2 MB.
- Do **not** treat `/v2/<id>` as the original: for one probed asset it returned
  249 KB where `resize:fit:1400` returned 313 KB for the same id. Always request
  an explicit width.
- `embedTarget(attrs)` parses an `iframe`'s attributes and returns the decoded
  `url` query parameter when the `src` is a `cdn.embedly.com/widgets/media.html`
  address, else `null`. Decoding must handle `&amp;` entity escaping and
  percent-encoding.

- [x] **Step 4: Commit**

```bash
git add supabase/functions/medium-import/medium.js js/lib/medium.test.js
git commit -m "feat(medium): the conversion module, tested against a real story"
```

---

# Phase 2 — The `medium-import` Edge Function

### Task 2.1: The function

**Files:**
- Create: `supabase/functions/medium-import/index.ts`
- Reuses: `supabase/functions/upload-asset/asset.js`

Copy `upload-asset/index.ts`'s shape wholesale — the CORS allowlist, the OPTIONS
short-circuit, the anon-client-plus-bearer-token `auth.getUser()` → 401, the
service-role read of `profiles.role` → 403, and the missing-secret → 501. Import
`medium.js` the way `upload-asset` imports `asset.js`, and import `REPO`,
`sniffType`, `refusal`, `assetPath`, `cdnURL`, `MAX_BYTES` from
`../upload-asset/asset.js`.

Wait — **do not cross-import between function folders.** Supabase deploys one
folder per function, so `../upload-asset/asset.js` will not resolve at deploy
time. Copy `asset.js` into `medium-import/asset.js` (it is 38 lines of pure
functions) and note in both headers that they are mirrors. `js/lib/asset.test.js`
keeps testing the original; add `supabase/functions/medium-import/asset.js` to the
same test's imports so the copy cannot drift.

- [x] **Step 1: Copy the asset helpers and pin the copy with a test**

```bash
cp supabase/functions/upload-asset/asset.js supabase/functions/medium-import/asset.js
```

In `js/lib/medium.test.js`, add:

```js
test("the importer's copy of asset.js still agrees with upload-asset's", async () => {
  const a = await import("../../supabase/functions/upload-asset/asset.js");
  const b = await import("../../supabase/functions/medium-import/asset.js");
  assert.equal(b.MAX_BYTES, a.MAX_BYTES);
  assert.equal(b.assetPath(a.sniffType([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), new Date(), "x"), a.assetPath(a.sniffType([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), new Date(), "x"));
});
```

- [x] **Step 2: Write the function**

Routes on `action`, and answers everything as JSON with a useful `error` string,
because `invokeFunction` surfaces it verbatim:

```
feed   { action:"feed",   input }         -> { source, stories }
story  { action:"story",  url }           -> { source, sections, dropped, warnings }
import { action:"import", url, ids }      -> { markdown, cover, images, warnings }
```

Requirements:

- **One retry** on a failed feed fetch, with a browser `User-Agent`. Everything
  Medium-facing is fetched with
  `{ headers: { "User-Agent": "Mozilla/5.0 (compatible; fcs-site/1.0)" } }`.
- `story` and `import` accept a story address **or** a `/p/<id>` link plus a
  `handle` field; `import` re-fetches the same feed and looks the item up by id,
  then converts again. If the item is no longer in the feed, answer 409 with
  *"That story left the feed while you were choosing. Open it again."*
- `import` filters `htmlToSections(...).sections` to the requested `ids`, runs
  `fitSections(kept, { maxBody: 200000 })`, then re-hosts the images that remain.
- Re-hosting, per image, **sequentially** (the existing code's note about two
  editors committing in the same second getting a 409 applies doubly here):
  1. Fetch the Medium address, following redirects.
  2. If the bytes exceed `MAX_BYTES`, fetch
     `resizeURL(mediumImageID(url))` instead and use that if it is smaller.
  3. `refusal(bytes)` — if it still refuses (a GIF, an SVG, still too big), leave
     the original address in the Markdown and record
     `{ url, why }` in `images.left`.
  4. Otherwise `PUT` to `api.github.com/repos/${REPO}/contents/${assetPath(bytes, new Date(), crypto.randomUUID())}`
     and rewrite the block's `url` to `cdnURL(commit.sha, path)`.
  - Rewrite on the **block model**, before serialising — never a regex over
    Markdown, so a `![x](y)` inside a code block is untouchable.
  - Cap at **40** copied images per import; the rest are left hotlinked and
    reported.
- `cover.url` is the first kept image block's final address, so the cover is
  owned too. `cover_credit` is never set.
- Count everything the writer should know into `warnings`: sections dropped for
  length, images left hotlinked, the 40-image cap, gists / native embeds and
  maths dropped, and third-party embeds recovered (a note, not a loss).
- Answer `Cache-Control: no-store` on `import` (it commits) and
  `public, max-age=60` on `feed`/`story` is **not** used — the client is
  authenticated and Supabase handles it; keep it simple and set nothing.

- [ ] **Step 3: Deploy**

```bash
supabase functions deploy medium-import
```

`GITHUB_ASSETS_TOKEN` is already set for the project and is read the same way.

- [ ] **Step 4: Smoke it by hand**

Sign in to the local admin, then from the browser console:

```js
const { data } = await window.fcsSupabase.functions.invoke("medium-import", { body: { action: "feed", input: "@theyasser" } });
console.table(data.stories.map((s) => [s.title, s.importable, s.publishedAt]));
```

Expected: ten rows, one with `importable: false`.

### Task 2.2: Client wrappers

**Files:**
- Modify: `js/supabase.js`

- [x] **Step 1: Add the wrappers beside the other `invokeFunction` calls**

Near `searchUnsplash` (which is the same pattern):

```js
/** The Medium importer (supabase/functions/medium-import). Admin and editor only. */
export const mediumFeed = (input) => invokeFunction("medium-import", { action: "feed", input });
export const mediumStory = (url, handle) => invokeFunction("medium-import", { action: "story", url, handle });
export const mediumImport = (url, ids, handle) => invokeFunction("medium-import", { action: "import", url, ids, handle });
```

- [x] **Step 2: Commit**

```bash
git add supabase/functions/medium-import js/supabase.js js/lib/medium.test.js
git commit -m "feat(medium): the medium-import Edge Function and its client wrappers"
```

---

# Phase 3 — The wizard

### Task 3.1: `js/medium-import.js`

**Files:**
- Create: `js/medium-import.js`
- Modify: `css/admin.css`

Model it on `js/member-picker.js` and `js/blog-editor.js`: its own container with
`role="dialog"`, a module-level handle so a second open replaces the first,
capture-phase `pointerdown` for outside clicks and `keydown` for Escape, focus
moved into the dialog and returned on close.

```js
/**
 * @param {object} opts
 * @param {"new"|"insert"} opts.mode         which button the last step offers
 * @param {Array<{id,title,source_url}>} [opts.existing]  for the duplicate warning
 * @param {(msg, tone?) => void} opts.toast
 * @param {(draft) => void} [opts.onCreate]  mode "new": { title, excerpt, body, cover_url, source_url }
 * @param {(markdown) => void} [opts.onInsert] mode "insert"
 */
export function openMediumImport(opts) { /* … */ }
```

- [x] **Step 1: Step 1 — Find**

One field, submitted on Enter or a button (never per keystroke — a feed is
~130 KB). Render the returned list as cards. Member-only stories are greyed out
with their `reason`. Stories whose `url` is in `existing` are marked *"Already
imported"*. A story address goes straight to step 2.

Show the four list states the spec's failure table names: no feed, empty feed,
not in the newest ten (with the list), and unrecognisable input.

**Below every populated list, always render the ten-story hint** (spec §8, step 1)
— it is the one limit the list itself makes obvious, and it is the writer's way
past it:

> Can't see the article you want? Medium's feed only publishes the ten most
> recent stories. Open the one you want on Medium, copy its link, and paste it
> into the field above.

It is a plain paragraph carrying the class `mi-hint` — no button, no control,
nothing to click. Render it whenever a list is shown, including a short one;
omit it on the empty, no-feed and unrecognisable-input states, whose copy already
says what to try instead.

- [x] **Step 2: Step 2 — Choose**

The story card, then the section checklist (all ticked), each row showing its
kind, its `label`, and — for images — a thumbnail of `images[0]`. Shortcuts: All,
None, Text only, Images only. Then the `dropped` summary. Then the live preview:

```js
preview.innerHTML = renderMarkdown(selected.map((s) => s.markdown).join("\n\n"));
```

`renderMarkdown` escapes all text and builds safe HTML, YouTube embeds render
inside the CSP's existing `frame-src https://www.youtube-nocookie.com`, and the
still-original Medium images render under `img-src 'self' data: https:`. Re-render
on every tick change, debounced with `requestAnimationFrame`.

- [x] **Step 3: Step 3 — Confirm**

The copyright warning verbatim from spec §8, the required checkbox (which gates
the Submit button), and the optional attribution checkbox, ticked by default.
On submit in `"new"` mode:

```js
const body = [attribution && attributionLine(source), ...kept.map((s) => s.markdown)]
  .filter(Boolean).join("\n\n");
const { markdown, cover, warnings } = await mediumImport(source.url, kept.map((s) => s.id), handle);
opts.onCreate({
  title: clipTitle(source.title),        // ≤160
  excerpt: clipTitle(source.subtitle, 300), // ≤300
  body: markdown,
  cover_url: cover?.url || "",
  source_url: source.url,
});
opts.toast(summarise(warnings), warnings.length ? "info" : "success");
```

In `"insert"` mode, call `mediumImport` the same way and hand `markdown` to
`opts.onInsert`. **Always import through the `import` action** (so images are
hosted here) in both modes; the section picker only decides which ids are sent.

The submit button enters a busy state with *"Copying images… this can take a
minute"* — the request is one round trip, so there is no finer progress to show.

- [x] **Step 4: The duplicate warning (before Submit, not after)**

```js
const clash = (opts.existing || []).find((p) => p.source_url === source.url);
```

If there is one, replace the submit row with *"You already imported this story
as **<title>**"* and two buttons: *Open that post* and *Import anyway*.

- [x] **Step 5: Styles**

A `.mi-` prefixed block in `css/admin.css`. Reuse the admin panel's existing
tokens, `.btn` classes, `.chip` for the picker shortcuts and `.badge` for
"Already imported" — no new colour tokens.

- [ ] **Step 6: Verify by hand**

Open it from the console with a made-up callback:

```js
import("./js/medium-import.js").then((m) => m.openMediumImport({ mode: "new", toast: console.log, onCreate: (d) => console.log("create", d) }));
```

Check: Escape closes and the page keeps working; a second open does not leave two
overlays; the preview updates as sections are ticked; Submit is dead until the
required box is ticked.

---

# Phase 4 — The two entry points

### Task 4.1: `pageHead`'s `extra` slot, and the Blog-page button

**Files:**
- Modify: `js/admin.js`

- [x] **Step 1: Add the slot**

`pageHead` (line 733) gains `extra = ""`, rendered inside `.page-actions`
**before** the New button so the primary action stays rightmost:

```js
function pageHead(page, { count, newLabel, search = true, extra = "" } = {}) {
  return `
    <div class="page-head">
      <h1 tabindex="-1">…</h1>
      <div class="page-actions">
        ${search ? `…` : ""}
        ${extra}
        ${page.site ? `…` : ""}
        ${newLabel ? `<button type="button" class="btn btn-primary" id="page-new">…</button>` : ""}
      </div>
    </div>`;
}
```

Every other caller is unaffected — the option is additive.

- [x] **Step 2: Pass it from `renderBlogPage`**

```js
${pageHead(page, { count: all.length, newLabel: "New post",
  extra: `<button type="button" class="btn btn-quiet" id="page-import">${icon("download")}<span>Import from Medium</span></button>` })}
```

- [x] **Step 3: Bind it**

```js
import { openMediumImport } from "./medium-import.js";

const openImport = () => openMediumImport({
  mode: "new",
  existing: state.data.blog_posts,
  toast,
  onCreate: (draft) => openEditor("blog", null, draft),
});
root().querySelector("#page-import").addEventListener("click", openImport);
```

Do **not** add a keyboard shortcut. `n` is already *New post*; a second letter on
an import that costs a network round trip should stay deliberate.

- [ ] **Step 4: Verify**

The Blog page shows **New post** and **Import from Medium**. Ticking through the
wizard with a real handle opens a new post with the content in it, titled, with a
cover, and nothing published.

### Task 4.2: `opts.initial` for a pre-filled new post

**Files:**
- Modify: `js/blog-editor.js`
- Modify: `js/admin.js`

- [x] **Step 1: Accept the option**

In `openBlogEditor`'s doc comment (289–307) add:

```js
 * @param {object} [opts.initial]   a new post's starting title/excerpt/body/cover_url/source_url
```

Immediately after the `post` literal (line 314) and **before** the authors block:

```js
// An imported post arrives pre-filled; it is still an unsaved draft.
if (opts.initial) Object.assign(post, opts.initial);
```

That is enough: the initial render reads `post.title` (3982), `loadBody(post.body)`
(3984) and `paintProps()` (3987), so the title, body, summary and cover all
appear, and `post.id` stays null because `initial` never carries one.

- [x] **Step 2: Thread it through `openEditor` / `openPostEditor`**

`openEditor(id, row)` (1630) gains a third parameter, passed to
`openPostEditor(row, { initial })`, which forwards it into `openBlogEditor({ row,
initial, … })`. Existing calls pass nothing, so nothing changes for them.

- [ ] **Step 3: Verify**

`/blog` → **Import from Medium** → tick through → the editor opens on an unsaved
post whose title, summary, cover and body are already correct, and whose **Save**
button still says *Publish* (i.e. it is a draft). Then close without saving: no
post appears in the list.

### Task 4.3: The editor's ⋯ menu, and inserting at the cursor

**Files:**
- Modify: `js/blog-editor.js`
- Modify: `js/admin.js`

- [x] **Step 1: Let the admin supply the wizard**

The editor already receives `save`, `uploadImage`, `unsplash` and `duplicate` as
callbacks and knows nothing about Supabase. Follow that: add
`@param {(insert: (markdown: string) => void) => void} [opts.importMedium]`.

In `openPostEditor`, next to `uploadImage`:

```js
// The Medium importer (supabase/functions/medium-import); its ⋯ menu item calls this.
importMedium: (insert) => openMediumImport({
  mode: "insert",
  existing: state.data.blog_posts,
  toast,
  onInsert: insert,
}),
```

- [x] **Step 2: Add the menu item**

Next to the existing *Import Markdown* entry in the ⋯ menu's Actions section,
call `opts.importMedium(insertBlocksAtCaret)` — guarded, so an older caller
without the option still works:

```js
{ label: "Import from Medium", icon: "download", section: "Actions",
  run: () => opts.importMedium ? opts.importMedium(insertBlocksAtCaret) : opts.toast("Importing from Medium is not available here.", "error") },
```

- [x] **Step 3: Insert at the cursor, additively**

`importMarkdown` appends. A near-copy that inserts after the caret's block is the
whole change, and the one-line `changed({ structural: true })` is what makes the
insertion a single undo away:

```js
function insertBlocksAtCaret(markdown) {
  const blocks = parseBlocks(markdown);
  if (!blocks.length) return opts.toast("Nothing was chosen to insert.", "error");
  let ref = blockOfCaret() || root.lastElementChild;
  let last = null;
  blocks.forEach((b) => {
    const el = blockEl(b);
    if (ref) ref.after(el); else root.append(el);
    ref = el;
    last = el;
  });
  changed({ structural: true });
  if (last) focusBlock(last, true);
  opts.toast(`Imported ${blocks.length} block${blocks.length === 1 ? "" : "s"} into the post.`, "info");
}
```

- [ ] **Step 4: Verify that an existing draft is untouched — this is the whole point**

1. Type three paragraphs into a draft. Save the slug so the content is settled.
2. Put the caret in the middle of paragraph two and import a story.
3. **Expected:** the paragraphs are byte-identical around the insertion, with the
   imported blocks between them; nothing above or below is re-serialised or
   reordered.
4. Press Ctrl+Z once. **Expected:** the entire insertion disappears in one step
   and the original three paragraphs are exactly as written.
5. Untick everything but one heading and import again. **Expected:** exactly one
   block is inserted.

---

# Phase 5 — Provenance, the duplicate warning and the attribution line

### Task 5.1: Carry `source_url` through the editor

**Files:**
- Modify: `js/blog-editor.js`

- [x] **Step 1: Add it to the snapshot keys**

`CONTENT_KEYS` (244) gains `"source_url"`, so drafts and versions keep it and a
restore brings it back.

- [x] **Step 2: Add it to the write payload**

In `values()` (1005), after `locked`:

```js
source_url: post.source_url || null,
```

- [x] **Step 3: Verify**

Import a story, publish-check nothing, save the draft, reload the admin, reopen
the post. `select source_url from blog_posts where id = …` still shows the
address. Undo a version restore and it survives.

### Task 5.2: Show it in the Properties panel

**Files:**
- Modify: `js/blog-editor.js`
- Modify: `css/admin.css`

- [x] **Step 1: A read-only Source row**

In `paintProps()` (1123), when `post.source_url` is set, add one row to the Post
properties:

```html
<div class="nb-prop nb-prop-source">
  <span class="nb-prop-label">Source</span>
  <a href="…" target="_blank" rel="noopener">medium.com/…</a>
  <span class="nb-prop-note">Imported from Medium</span>
</div>
```

Read-only: the address is a record, not a setting. The visible attribution line,
if the writer wants one, is a normal paragraph they can edit or delete.

- [x] **Step 2: Verify**

The row appears on an imported post, links out, and does not appear on a
hand-written one.

---

# Phase 6 — Verification

### Task 6.1: The suite

- [x] **Step 1: Run everything**

Run: `npm test`
Expected: `fail 0`, and a total well above the current 140 (roughly 175+).

- [x] **Step 2: Confirm nothing else moved**

The only pre-existing files edited are `js/admin.js`, `js/blog-editor.js`,
`js/supabase.js`, `css/admin.css` and `README.md`. `js/lib/markdown.js`,
`upload-asset/` and `admin.html` are untouched — so no existing test changes
meaning, and the CSP is provably unchanged:

```bash
git diff --stat
git diff admin.html        # expected: no output
```

### Task 6.2: A real end-to-end check

- [ ] **Step 1: A public story, from a handle**

Import a story from `@theyasser` (or any member's handle). Confirm in the editor
and, once published, on the built page:

- headings, paragraphs, bold/italic, links, lists, quotes and dividers all match
- every image loads **from `cdn.jsdelivr.net`**, with the caption under it
- the code blocks are intact and unlabelled, and each is **one** block
- no "originally published in…" footer, no tracking pixel, no `medium.com/media`
- the Source row links to the original

- [ ] **Step 2: A pasted link**

Paste the same story's address into a fresh wizard.

Expected: same story, straight to Step 2 with it chosen — and the address is
recognised even when it is a publication's own domain rather than `medium.com`.

- [ ] **Step 3: The three refusals**

1. A member-only story → greyed out with its reason, not clickable. Repeat
   against a Partner-Program publication's feed, where **every** item is a teaser
   and the list is therefore entirely greyed out, to check the copy still reads
   sensibly.
2. A story older than the newest ten → *"isn't in the newest ten"* plus the list,
   and **below the list the ten-story hint** telling the writer to paste the link
   instead. Confirm the hint also appears on an ordinary successful list, and is
   absent on the empty-feed and unrecognisable-input states.
3. `https://example.com/hello` → *"doesn't look like a Medium address or handle."*

- [ ] **Step 4: A story with an embed**

Use a story that has both kinds if possible. A third-party embed (a YouTube video
or a tweet) and a gist are the two cases.

Expected:

- the **third-party embed survives** — a YouTube frame lands as a video block in
  the preview, a tweet lands as a linked address in a paragraph, and neither is
  counted as dropped;
- the **gist** is reported in Step 2's dropped summary, and the body has a
  callout placeholder where it was — **never** a `medium.com/media/…` link;
- `embedly.com` appears nowhere in the resulting Markdown or the preview.

- [ ] **Step 5: An image-heavy story**

Expected: the longer wait, a busy button, and — if there are more than 40 images
or a GIF or an oversized original — an explicit line in the summary saying so.

- [ ] **Step 6: The duplicate path**

Import the same story twice.
Expected: the second time names the existing post before creating anything, and
*Open that post* goes there.

- [ ] **Step 7: Both themes and a narrow window**

The wizard is usable in light and dark, and at 375 px wide. The section checklist
scrolls; the preview stays readable.

### Task 6.3: README

- [x] **Step 1: Document it**

One section under the blog/asset material:

- how to reach it (Blog → *Import from Medium*, or the editor's ⋯ menu)
- that it needs no Medium account, because Medium closed its API and the feed is
  the only reachable surface
- the ten-story window, member-paywalled stories (and that a Partner-Program
  publication's whole feed is teasers), lost code language, and that gists,
  native embeds and maths need a human — while third-party embeds do come across
- that a member should publish their own work
- that images are re-hosted to `fcs-assets` through the same path as a normal
  upload, so no new secret and no CSP change were needed
- that migration 033 adds `source_url`

- [x] **Step 2: Commit**

```bash
git add README.md docs/superpowers
git commit -m "docs: the Medium importer"
```

---

## Run it locally

No new tooling. The importer is exercised exactly like the rest of the admin
panel.

```bash
npm test                       # the pure module, no network
npm run serve                  # http://localhost:8000  (admin at /admin.html)
supabase functions serve medium-import --no-verify-jwt
```

Supabase Edge Functions need a signed-in caller, so use the deployed function for
step-by-step checks; `functions serve` is for changing the function itself.
`GITHUB_ASSETS_TOKEN` must be present in the project's function secrets for the
image step — without it the function answers 501 rather than failing obscurely,
which is the behaviour to test.

## Notes and limits

- **The tests never touch the network.** Every Medium-shaped input in
  `js/lib/medium.test.js` is a captured string. Recording a second fixture from a
  different author, later, is the cheapest way to catch a format change.
- **`js/lib/markdown.js` is the reference.** The round-trip assertion
  (`parseBlocks(section.markdown)`) is what makes the converter's output correct
  by the site's own definition rather than by a second opinion. If a section's
  Markdown ever fails to parse back, that test fails before the browser sees it.
- **Two copies of `asset.js`** (`upload-asset/` and `medium-import/`) exist
  because Supabase deploys one folder per function. One test asserts the two
  agree. If that ever chafes, the honest fix is to inline the four helpers into
  each function and delete the copies.
- **The 200,000-character cap is real.** A long, image-heavy story can approach
  it; `fitSections` cuts on section boundaries so the result is never
  mid-sentence, and the count is reported.
- **Ordering is sequential on purpose.** Commits are one at a time to avoid the
  409 the existing `upload-asset` already warns about. Parallelising is a
  follow-up, not a fix.
- **Nothing caches the feed.** Two fetches happen per import (the list, then the
  conversion). It is a few hundred kilobytes and keeps the function stateless.
- **`medium.js` must stay Deno-free.** If a helper ever needs `fetch` or
  `Deno.env`, it belongs in `index.ts`. That boundary is what keeps the tests
  runnable under plain Node.

## Human-in-the-loop checklist

Everything below is yours. Nothing else in the plan is.

### Before Phase 1 can be considered done

- [ ] **Run migration 033** in the Supabase SQL editor (Phase 0).
- [ ] **Send one real Medium handle** you want tested, so the end-to-end check
      uses your own writing rather than a stranger's.

### Before the feature is announced

- [ ] **Review the copyright wording** in Step 3 of the wizard. It is the one
      string with a consequence beyond the software, and you may want to word it
      as the club rather than as the tool.
- [ ] **Decide the attribution default.** The plan ticks *"Originally published
      on Medium"* by default. Unticking it in the code is a one-word change if you
      would rather the writer opt in.
- [ ] **Confirm the ten-story limit is acceptable** to the team, since it is the
      one limitation no code can remove.

### At the end

- [ ] **Roll it out to the team** — it is visible to every admin and editor at
      once, with no per-person setting.
- [ ] **Try it on a paywalled story and a Partner-Program publication once**, so
      you have seen the refusal and the all-teasers list before a member asks.

### Not needed at any point

- No Medium account, app, token or OAuth client.
- No new npm dependency, no build step, no bundler.
- No change to `admin.html`'s Content-Security-Policy.
- No new Supabase secret — `GITHUB_ASSETS_TOKEN` is reused.
