# Import from Medium

- **Date:** 2026-10-16
- **Author:** Jyotirmoy Das
- **Status:** Awaiting review
- **Repo:** `fcs-site` (static site on GitHub Pages; Supabase Postgres + Edge Functions)
- **Builds on:** `2026-09-28-fcs-cms-dashboard-design.md` — the admin panel, the
  blog editor and `js/lib/markdown.js`, all of which this extends rather than replaces

---

## 1. Problem statement

The club blog is written by members who already publish on Medium.
Republishing the same article here means retyping it: the editor can import a
Markdown *file*, Medium offers no per-story Markdown export, and pasting a
rendered Medium page into the editor throws away the structure that makes the
article readable — code fences, image captions, headings, quotes, dividers.

Two things are wanted, and they pull in opposite directions:

1. **The convenience.** An admin or editor points at their own Medium handle, or
   pastes a story link, sees what is there, previews it, and gets the article
   into a new post with its structure intact.
2. **The guard.** Importing is precisely the operation most likely to republish
   somebody else's work. The step in front of it has to say so plainly, and the
   record has to say where the content came from.

The user originally asked to "sign in to their Medium account and pick a story".
That is not possible, and section 4 is the evidence: Medium's public API is
closed, never exposed a way to list or read a user's own stories, and every
page-level route is now behind Cloudflare. What *is* reachable is the RSS feed,
and it turns out to carry the whole article.

## 2. Goals

| # | Goal | Measure |
|---|------|---------|
| G1 | Any admin or editor can import their own story, with no Medium credentials | The button appears on the Blog page and in the editor's ⋯ menu; nothing asks for a password |
| G2 | Fidelity close to Medium | Every row in section 7 is verified against a real feed; headings, paragraphs, lists, quotes, dividers, links, inline marks, images with captions and code blocks all land as the matching site block |
| G3 | Nothing degrades silently | Each loss (code language, gists and native embeds, maths, member-paywalled stories, the 10-story window, an uncopyable image) is stated in the interface and in the post-import summary |
| G4 | Copyright is guarded | A required confirmation stands between picking a story and any content existing; the story's address is recorded on the post; a repeat import warns |
| G5 | The site keeps owning its images | Every kept image is committed to `fcs-assets` and rewritten to a pinned jsDelivr URL, or explicitly left hotlinked and reported |
| G6 | No new browser trust | `admin.html`'s Content-Security-Policy is unchanged — no new origin, no `medium.com` in `connect-src` |
| G7 | The logic is tested, not hoped at | The pure module is covered by `npm test`, including a round-trip through the site's own `parseBlocks` |

## 3. Non-goals

- **Signing in to Medium.** No OAuth, no API token (section 4).
- **Stories older than the newest ten.** There is no pagination; the feed is the
  only route and it caps at ten.
- **Member-only / paywalled stories.** Medium truncates them in the feed even for
  the author, so there is nothing to import. They are listed, greyed out, and
  explained.
- **GitHub gists, native Medium embeds, and LaTeX maths.** The feed serialises
  these as an empty `<iframe>` around a `medium.com/media/<hash>` link that 403s,
  so they cannot be recovered. Third-party embeds served through Embedly —
  YouTube, Twitter/X, Vimeo, CodeSandbox — are an exception and **are**
  recovered; see sections 4 and 7.
- **Reading Medium's edit view or private drafts.**
- **The export-zip route** (manual, all-or-nothing, and it is a whole-account
  download rather than a per-story one).
- **Comments, claps, highlights, tags**, and anything else that is not article
  content.
- **Modifying the source article**, or writing anything back to Medium.

## 4. Research: what Medium actually allows

Every row was probed live on **2026-10-16** with a browser user agent. Live
probes beat secondary sources; where they disagreed, the probe won.

| Probe | Result | Consequence |
|---|---|---|
| `GET medium.com/feed/@handle` | **200**, 135,501 bytes, exactly 10 `<item>`s | The list source. The `@` is required — `/feed/handle` returns an empty feed. |
| `?limit=50`, `?page=2`, `?p=2` on the same feed | **200**, byte-identical to the plain feed | No pagination exists. Ten is the ceiling; this is a hard scope limit. |
| `GET` a story page (`medium.com` and a custom domain) | **403** Cloudflare challenge | Page scraping is impossible from any server. |
| `POST medium.com/_/graphql` | **403** Cloudflare challenge | Medium's internal body model (the richest source, which *does* carry code language and maths) is unreachable. |
| `GET medium.com/p/<id>?format=json` | **403** | Same. |
| `GET medium.com/media/<hash>/href` | **403** | A gist's or a native embed's target cannot be resolved through Medium. |
| `GET` the `iframe` of a third-party embed, in one real feed | **200** — `src="https://cdn.embedly.com/widgets/media.html?…&url=<percent-encoded target>"`; **8 of that feed's 15** frames carried a real `src` | Third-party embed targets *are* recoverable: the original address is a query parameter. The other 7 frames had `src=""` and are lost. |
| `GET miro.medium.com/v2/<key>` | **200** directly, no redirect — 249,384 B, `image/png`, for a `/max/1024/` sample | A byte-fetchable address exists without following the CDN redirect. |
| `GET miro.medium.com/v2/resize:fit:1400/<key>` | **200**, 312,992 B — *larger* than `/v2/<key>` for the same asset | Do not assume `/v2/<key>` is the largest rendition; request an explicit width instead. |
| `GET medium.com/feed/@<handle>/tagged/<tag>` | **404** | A personal feed cannot be filtered by tag. Never offer it. |
| `GET medium.com/feed/tag/<tag>` | **200**, teasers only — **0** `<content:encoded>` | Tag feeds cannot supply a body. |
| `GET medium.com/feed/<publication>` for a Partner-Program publication (`cantors-paradise`) | **200**, 10 items, **0** `<content:encoded>` | A paywalled publication yields no importable text — for anyone, not just for outsiders. |
| `GET medium.com/feed/<publication>` for an open publication (`better-programming`) | **200**, 10 items, **8** with `<content:encoded>` | Even in an open publication, individual member-gated items are teasers only. |
| `GET medium.com/feed/@<handle>` for a handle with no stories (`threepointone`) | **200**, 0 `<item>`s, 1,157 bytes | An empty feed is a normal answer, not an error. |
| Atom `<link rel="…">` in the feed | `self` and `hub` (`medium.superfeedr.com`) only | No `next` or `prev`: there is no pagination cursor to follow. |
| `GET medium.com/@<handle>/sitemap.xml` | **403** | No per-author sitemap. |
| `GET medium.com/sitemap/sitemap.xml` | **200**, but global and date-partitioned, and its story URLs 403 | Sitemaps do not unlock older stories. |
| `GET cdn-images-1.medium.com/max/1024/…` | **301** → `…/v2/resize:fit:1024/…` → **200**, `image/png`, magic bytes `89 50 4E 47` | Images download as real bytes, so they can be re-hosted. |
| `GET miro.medium.com/v2/resize:fit:1400/…` | **200**, `image/png`, 72,487 bytes | A bounded-width variant is available for oversized originals. |
| `GET r.jina.ai/<a Medium story>` | **403** abuse block on the `medium.com` domain | Even third-party readers are out. No proxy dependency. |
| `GET levelup.gitconnected.com/feed` | **200**, 10 items, 8 with content | A publication on a custom domain serves the same feed at `<domain>/feed`. |

Inside an item's `<content:encoded>` (full HTML for public stories):

- Elements seen: `<p>`, `<strong>`, `<em>`, `<a href>`, `<blockquote>`, `<h3>`,
  `<h4>`, `<ul>`, `<ol>`, `<li>`, `<figure><img src="…cdn-images…"><figcaption>`,
  `<pre>`, `<hr>`.
- **No `srcset`, no `<picture>`, no `data-src`** — one clean `src` per image.
- **No language class on `<pre>`** — Medium does not say what language a code
  block is.
- **Code is split across consecutive `<pre>` siblings**: of 50 `<pre>` in one
  feed, **28 were immediately followed by another `<pre>`**, and 39 contained
  `<br>` for their own line breaks. One logical sample arrives as several
  siblings, so they must be merged or a twenty-line snippet becomes eight code
  boxes.
- Entities are escaped (`&quot;`, `&#39;`, `&lt;`, `&gt;`) and non-breaking
  spaces appear where Medium inserted them.
- A tracking pixel:
  `<img src="https://medium.com/_/stat?event=post.clientViewed&…" width="1" height="1" alt="">`.
- A footer:
  `<hr><p><a href="<story url>">Title</a> was originally published in <a href="<pub url>">Publication</a> on Medium, where people are continuing the conversation…</p>`
  — which also names the publication and repeats the canonical story address.
- Embeds arrive in **two shapes that behave differently**:
  - **Third-party, served through Embedly** — the `src` is real and holds the
    target as a query parameter:
    `<iframe src="https://cdn.embedly.com/widgets/media.html?…&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D<id>&…" width="854" height="480">`.
    YouTube, Twitter/X, Vimeo and CodeSandbox were all found this way, so the
    target is recoverable by decoding `url`.
  - **GitHub gists and native Medium embeds** — an empty frame around a link
    that 403s:
    `<iframe src="" width="0" height="0" frameborder="0" scrolling="no"><a href="https://medium.com/media/<hash>/href">…</a></iframe>`.
    The hash is a Medium-internal id, not the gist's own (a
    `gist.github.com/<hash>` probe 404s), so the target is genuinely gone.
- Item metadata: `<title>`, `<link>` (carries `?source=rss-…`),
  `<guid>https://medium.com/p/<12-hex></guid>`, `<pubDate>`,
  `<dc:creator><![CDATA[Author Name]]>`.
- Stories behind the member paywall have **no `<content:encoded>`** at all, only
  a `<description>` teaser saying "Continue reading on". This is not merely an
  outsider's problem: 1 of 10 sampled personal items, 2 of 10 items in an open
  publication, and **all 10** items in a Partner-Program publication
  (`cantors-paradise`) are teasers. An author who publishes only inside such a
  publication has nothing importable at all.

**Conclusion: the RSS feed is the only reachable Medium surface. It carries
everything the plan needs except code language, GitHub gists and native Medium
embeds, and maths.** Third-party embeds turn out to be recoverable — a fourth
category the first round of probing missed by generalising from the empty-frame
shape alone.

Probes beat agents, in both directions. One delegated agent asserted that
`medium.com/media/<hash>/href` resolves via a 302; the live probe returned
**403**, so gists stay lost. A later agent found the Embedly `url=` parameter; a
live re-probe confirmed it, so third-party embeds are now recovered. Neither
claim was accepted on an agent's word — and the second one corrected this
document.

## 5. The two ways in

Both land in the same place — a story's HTML inside a feed, matched by its
stable `<guid>`.

### 5.1 A handle

Type `@janedoe` (or just `janedoe`, or paste `medium.com/@janedoe`). The handle
is recognised, `medium.com/feed/@janedoe` is fetched, and the ten newest stories
are listed. A publication host works the same way: `medium.com/feed/<publication>`,
or `<custom-domain>/feed` for a publication on its own domain.

### 5.2 A pasted story link

A Medium story address ends in a twelve-hex id, e.g.
`…/the-hidden-cost-of-ai-code-assistants-5123886e38bd`. The id identifies the
story; the rest of the address identifies whose feed to look in:

| Address | Feed to fetch |
|---|---|
| `medium.com/@handle/slug-<id>` | `medium.com/feed/@handle` |
| `<sub>.medium.com/slug-<id>` | `medium.com/feed/@<sub>` |
| `medium.com/<publication>/slug-<id>` | `medium.com/feed/<publication>` |
| `<custom-domain>/slug-<id>` | `<custom-domain>/feed` |
| `medium.com/p/<id>` | nothing to derive — ask for the handle instead |

The story is then found in that feed by matching
`<guid>` = `https://medium.com/p/<id>`. If it is not among the ten newest, the
wizard says exactly that, and offers the handle route so the writer can see what
*is* available. This is the honest cost of having only one reachable surface.

Two limits on this route were probed and are deliberate:

- **A personal feed cannot be filtered by tag.** `medium.com/feed/@handle/tagged/<tag>`
  is a **404**, so a tag is never a fallback when a story falls outside the ten.
  Publication tag feeds (`medium.com/feed/<publication>/tagged/<tag>`) do work,
  but they are not author-scoped, so they are not offered as "your older work".
- **A paywalled publication has no body to give.** When the address resolves into
  a Partner-Program publication, its feed returns teasers only (section 4). The
  wizard says so at the list step rather than failing at import time.

## 6. Architecture

```
admin.html
   │  (only Supabase is ever contacted)
   ▼
Edge Function  medium-import
   ├── GET  medium.com/feed/@handle        the only source of stories
   ├── GET  cdn-images / miro.medium.com   images as bytes
   └── PUT  api.github.com …/fcs-assets    reuse of upload-asset's asset.js helpers
                     │
                     ▼
              jsDelivr, pinned to the commit
```

- **CSP unchanged.** The browser talks only to Supabase, exactly as it already
  does for `upload-asset` and `unsplash`. Nothing new goes into `connect-src`.
- **Auth is identical to `upload-asset`**: the caller's bearer token is resolved
  with the anon client, their role is read from `profiles` with the service-role
  client, and anything other than `admin` or `editor` is a 403. The button is
  only visible in the admin panel anyway; this is the second lock.
- **`GITHUB_ASSETS_TOKEN` is reused**, and so are `sniffType`, `refusal`,
  `assetPath`, `cdnURL` and `MAX_BYTES` from
  `supabase/functions/upload-asset/asset.js`. The function performs the GitHub
  commit itself rather than calling `upload-asset` over HTTP, because the bytes
  never reach the browser.

### 6.1 The function's three actions

`POST { action: "feed", input }` — `input` is a handle, a publication or any
Medium address. Returns the story list:

```jsonc
{ "source": { "kind": "handle", "handle": "theyasser", "author": "Yasser El-Sayed", "url": "https://medium.com/feed/@theyasser" },
  "stories": [
    { "id": "5123886e38bd", "title": "…", "author": "…", "publication": "Level Up Coding",
      "publishedAt": "2025-04-23T16:31:38.000Z", "url": "https://levelup.gitconnected.com/…",
      "importable": true, "reason": null, "excerpt": "…", "thumbnail": "https://…" }
  ] }
```

`importable: false` with a `reason` is how a member-only story is shown rather
than hidden.

`POST { action: "story", url }` — converts one story. Returns metadata and the
**sections** the writer will pick from:

```jsonc
{ "source": { "url": "…", "title": "…", "subtitle": "…", "author": "…",
              "publication": "…", "publishedAt": "…", "postId": "5123886e38bd" },
  "sections": [ { "id": "0", "kind": "h1", "label": "Default Behavior",
                  "markdown": "# Default Behavior", "images": [] },
                { "id": "3", "kind": "image", "label": "Image: a bar chart of…",
                  "markdown": "![a bar chart of…](https://cdn-images…)",
                  "images": ["https://cdn-images…"] } ],
  "dropped": [ { "kind": "embed", "detail": "a GitHub gist" } ],
  "warnings": [] }
```

A **section** is a run of one or more top-level blocks that must be inserted
together — a paragraph, a heading, a table, or a whole list. It is serialised
exactly as `js/lib/markdown.js`'s `serializeBlocks` would serialise it, so
joining the kept sections with a blank line and handing the result to
`parseBlocks` reproduces the same blocks. `label` and `images` exist so the
picker can show something human and a thumbnail.

Sections carry the **original** Medium image addresses, which render fine in the
preview (`img-src 'self' data: https:` already allows any `https:` image) — so
picking a story is one fetch and no commits.

`POST { action: "import", url, ids }` — re-fetches the *same* story, keeps only
the chosen sections, copies their images to `fcs-assets`, and answers with the
final Markdown:

```jsonc
{ "markdown": "…", "cover": { "url": "https://cdn.jsdelivr.net/gh/…" },
  "images": { "copied": 7, "left": [ { "url": "https://…gif", "why": "GIFs are not copied" } ] },
  "warnings": ["The story was longer than a post can hold; the last 2 sections were left out."] }
```

Splitting it this way means **only images the writer actually kept are
committed** — ten abandoned images cost nothing — and the replacement happens on
the block model rather than over a string, so a `![x](y)` sitting inside a code
block can never be rewritten by accident.

### 6.2 The conversion pipeline

One pure module, `supabase/functions/medium-import/medium.js`, holding everything
that is not network or Deno: no imports, no globals beyond `URL` and `Date`, so
`npm test` can exercise it. This is the same shape as
`upload-asset/asset.js` tested by `js/lib/asset.test.js`.

| Export | Job |
|---|---|
| `parseInput(text)` | Recognise `@handle`, a bare handle, a story address, a publication address; extract the twelve-hex id |
| `feedURLFor(input)` | The feed to fetch, per the table in 5.2 |
| `parseFeed(xml)` | Items: id from `<guid>`, title, author from `<dc:creator>`, date, publication, address, excerpt, thumbnail, `importable` |
| `stripBoilerplate(html)` | Drop the `/_/stat` pixel, the "originally published in … on Medium" footer and its `<hr>`, and trailing rules |
| `parseHTML(html)` | A tiny tokeniser for the RSS subset, quote-aware about attributes |
| `htmlToSections(html)` | The mapping in section 7, emitting `{ kind, label, markdown, images }` |
| `serializeSection(blocks)` | Mirrors `serializeBlocks` for the produced block types only |
| `attributionLine(source)` | `Originally published on [Medium](<address>)` |
| `clipText(text, max)` | Trimming by code point, with `…` only when it cut |
| `fitSections(sections, { maxBody })` | Whole-section trimming: breaks at the first overflow, reports the rest |
| `mediumImageID(url)` | The asset id out of `…/max/1024/<id>`, `…/v2/resize:fit:1400/<id>`, or a bare `…/<id>` |
| `resizeURL(id, width)` | The bounded-width address for an oversized original |
| `embedTarget(attrs)` | The real address out of an Embedly `iframe` `src`, or `null` for an empty frame |

The last two are what make an oversized original fixable: if the fetched bytes
exceed 2 MB, the same asset is requested at `miro.medium.com/v2/resize:fit:<w>/<id>`,
which is a bounded width and lands inside the cap. Note that `/v2/<id>` is **not**
the largest rendition — for one probed asset it was 249 KB where
`resize:fit:1400` returned 313 KB — so a width is always requested explicitly
rather than assumed.

## 7. Fidelity mapping

Medium's `<h3>` becomes the site's first heading level, because the site's
`h1` **is** the post title (`renderBlocks` renders blocks `h1`–`h4` as page
`h2`–`h5`). So the visual weight matches Medium's.

| In the feed | Becomes | Quality |
|---|---|---|
| `<title>` | the post's Title (≤160) | exact |
| the opening line before the first heading | the post's Summary (≤300) | exact |
| `<h3>` | `#` heading | exact |
| `<h4>` | `##` heading | exact |
| `<p>` | paragraph, with the same separation | exact |
| `<strong>` `<em>` `<code>` | `**bold**` `*italic*` `` `code` `` | exact |
| `<a href>` | `[text](https://…)`, with the site's own link icon | exact |
| an `<a>` whose address is a YouTube video | `@[video](…)` — reusing the site's `youtubeId` rule | exact |
| a third-party Embedly `iframe` aimed at a YouTube video | `@[video](…)` from the decoded `url` parameter | exact |
| a third-party Embedly `iframe` (Twitter/X, Vimeo, CodeSandbox) | a paragraph holding the recovered address as a link | good — the address survives and is clickable; a card stays the writer's choice |
| `<ul>` / `<ol>` / `<li>`, nested | `- ` / `1. `, indented two spaces per level; one section per list | exact |
| `<blockquote>` | `> ` quote | exact |
| `<figure><img><figcaption>` | `![caption](…)`, caption from the `<figcaption>` | exact |
| a run of consecutive `<pre>` | **one** code block; `<br>` becomes a newline, entities decoded | partial — see below |
| `<hr>` | `---` divider | exact |
| `&nbsp;` | a normal space | exact |
| `<img src="…/_/stat…">` | dropped (tracking pixel) | exact |
| the footer paragraph and its rule | dropped | exact |
| `medium.com/media/<hash>/href` inside an empty `<iframe>` (gists, native Medium embeds) | dropped, and counted in `dropped` | degraded — a placeholder note is offered |
| a member-paywalled item (no `<content:encoded>`) | listed but not importable, with its reason | nothing to import |
| LaTeX (`$$…$$`) | not recoverable — medium.com renders it in the browser, and the feed carries only the rendered image | lost |
| tags, claps, reading time, highlights | not content | n/a |
| tables, to-dos, toggles, columns, callouts | Medium has none | n/a |

**Code blocks lose their language, and this cannot be fixed.** Medium does not
put a language class in the feed, and the internal API that does carry one is
403. An empty fence renders cleanly (the site omits the caption and highlighting
when there is no language), and the wizard offers a one-line note plus a
per-code-block language picker *after* import, using the editor's existing code
caption control.

**Third-party embeds are recovered; gists and native embeds are not.** An
Embedly frame's real target is decoded and written into the post — a YouTube
target as `@[video](…)`, anything else as a link paragraph. Only a frame with an
empty `src` degrades, and it degrades to a visible note rather than a dead link:
the unreachable address is never written into the post. In its place the wizard
offers, ticked by default, a callout:
`> [!⚠️] An embedded item (a GitHub gist) could not be imported — add it back from the original article.`

**Bare links always stay links.** They are never turned into `@[bookmark]`
cards automatically: a card needs its title, description and image from
`tools/link-meta.mjs` at deploy time or microlink in the editor, and inventing
one would be a promise the import cannot keep. Converting a link to a card stays
a deliberate action the writer takes in the editor afterwards.

## 8. The import screen

A modal of three steps, in a new `js/medium-import.js`, following the pattern of
`js/blog-editor.js` and `js/member-picker.js` (its own overlay, its own focus
handling, Escape to close). It renders a **live preview** with the site's own
`renderMarkdown`, so what the writer sees before confirming is what the post will
be — including the YouTube iframes the CSP already permits.

**1 · Find.** One field: *"Paste a Medium story link, or type `@yourhandle`."*
Accepting `@handle`, `handle`, `medium.com/@handle`, a story address, a
publication address. The feed is fetched on Enter, not on every keystroke.

- A handle or publication gives the list: title, author, date, snippet,
  thumbnail. Member-only stories are shown greyed out with *"Member-only —
  Medium doesn't include it in the feed"*. Stories whose address is already on a
  post are marked *"Already imported"*.
- **Below the list, always, a closing hint** naming the way past the ten-story
  window — the one limit the list itself makes obvious:
  *"Can't see the article you want? Medium's feed only publishes the ten most
  recent stories. Open the one you want on Medium, copy its link, and paste it
  into the field above."*
  It is a hint, not a control: no button, nothing to click. It appears whenever a
  list is shown, including a short one, and is omitted on the empty-list and
  error states, where the copy already says what to try instead.
- A story address matches straight through to step 2 with that story chosen.

**2 · Choose.** The story's card (title, author, publication, date, original
link), then the **section picker**: every section ticked, each row showing its
kind, a plain-text label and, for images, the thumbnail. Shortcuts: All, None,
Text only, Images only. Below it the live preview, then the `dropped` list:
*"1 embed and 2 images couldn't be brought across"*.

**3 · Confirm.** The copyright warning, the required checkbox, the optional
attribution checkbox (ticked by default), and the button — *"Create a new
draft"* from the Blog page, *"Insert into this post"* from the editor.

> **Before you import**
> Only import **your own** writing, or work you have permission to republish.
> This copies a public Medium story into a post on this site. If it is not
> yours, republishing it can infringe someone's copyright — and the club is the
> one that receives the complaint.
>
> ☑ This is my own article, or I have the author's permission to republish it. *(required)*
> ☑ Add *"Originally published on Medium"*, linked to the original, at the end.

**Entry points.**

- The **Blog page header**, beside *New post*, opens the wizard aimed at a new
  draft. `pageHead` gains an optional `extra` slot for this.
- The editor's **⋯ menu**, beside *Import Markdown*, opens the same wizard aimed
  at the post on screen.

**Which one to use.** The header button starts a post from nothing; the menu item
adds to a post already in progress. The menu item is **additive** — it inserts
the chosen sections as new blocks and never rewrites, re-serialises or replaces
anything already written, exactly as the existing *Import Markdown* does. A
mistake is one undo away, because the whole insertion is a single structural
change (`changed({ structural: true })`, which commits one history entry). So
there is no way for it to corrupt a draft; the worst case is inserting in the
wrong place, which the writer sees immediately and reverses.

## 9. Data

One nullable column, migration **033**:

```sql
alter table public.blog_posts
  add column if not exists source_url text
    check (source_url is null or source_url ~* '^https://\S+$');
```

`source_url` is the story's canonical address. It buys three things:

1. **Provenance** — the post records where its content came from, independently
   of whether the writer kept the attribution line.
2. **A duplicate warning** — importing an address that is already on a post
   warns, naming that post, before anything is created.
3. **The editor's Properties panel** can show a read-only *Source* link.

It joins `CONTENT_KEYS` and `values()` in `js/blog-editor.js` so drafts and
versions carry it.

The attribution line is **body content**, not a column, because the reader sees
it and the writer may edit or delete it freely. Stored regardless of the line:
the record is the record.

Everything else reuses what exists:

| Field | On import |
|---|---|
| `title` | the story title, trimmed to 160 code points |
| `excerpt` | the story's opening paragraph, trimmed to 300 |
| `body` | the kept sections, joined, fitted to 200,000 code points |
| `cover_url` | the story's first image, re-hosted on jsDelivr (the writer can change it) |
| `cover_credit` | left null — it is Unsplash-specific |
| `slug` | `slugify(title)`, uniquified against existing slugs the way *Duplicate* does |
| `status` | `draft`, always — publishing is a deliberate act |
| `published_at` | null |
| `authors` | the importing member, added by the editor exactly as for *New post* |
| `source_url` | the story's address |
| `icon`, `font`, colours | untouched defaults |

## 10. Failure modes and what the writer is told

| Situation | What happens |
|---|---|
| Handle has no feed, or the feed is empty | *"No stories found for `@handle`. Check the spelling, or paste a story link instead."* |
| The story is not among the ten newest | *"That story isn't in the newest ten for `@author`. Here is what is."* — with the list |
| The address is not recognisable | *"That doesn't look like a Medium address or handle."* |
| A member-paywalled story, or any story in a Partner-Program publication | Shown greyed out: *"Medium publishes only a teaser for member-only stories. Import it from the original document instead."* |
| Feed fetch fails or times out | *"Medium didn't answer. Try again in a moment."* — one retry server-side first |
| An image is over 2 MB | Requested at `resize:fit:1400`; if still over, hotlinked and reported |
| An image is a GIF or SVG | Not copied (the asset pipeline refuses both); hotlinked and reported |
| More than 40 images kept | The first 40 are copied, the rest hotlinked, and it is reported |
| The story outgrows 200,000 characters | Whole sections are dropped from the end and the count is reported — never a mid-sentence cut |
| A gist, a native Medium embed, or a formula | Counted in `dropped`, explained, and offered as a callout placeholder |
| A third-party embed (YouTube, tweet, Vimeo, CodeSandbox) | Recovered from the Embedly `url` parameter — no loss, and no note |
| The story falls out of the feed between choosing and importing | *"That story left the feed while you were choosing. Open it again."* |
| The same address is already imported | Named before anything is created, with *Import anyway* and *Open the existing post* |

## 11. Testing

`npm test` gains `js/lib/medium.test.js`, alongside the existing 140 tests. It
imports the pure module from
`../../supabase/functions/medium-import/medium.js`, as `asset.test.js` already
imports from the upload function, and covers:

- `parseInput` / `feedURLFor` for all five address shapes in 5.2, plus junk.
- `parseFeed` against a **real captured item**, including the member-only case
  with no `<content:encoded>`.
- `stripBoilerplate` removing the pixel, the footer and its rule, and keeping a
  legitimate `<hr>` divider.
- **`htmlToSections` against a real `content:encoded`, asserting the produced
  Markdown round-trips: `parseBlocks(section.markdown)` yields the expected
  block types, texts and captions.** That is the test that keeps the converter
  honest, because it checks against the site's own parser rather than a second
  opinion about what the output should look like.
- The merge rule for consecutive `<pre>`, and `<br>` → newline, and entity
  decoding.
- `fitSections` cutting on section boundaries and reporting what it dropped,
  and `clipText` counting code points rather than UTF-16 units, so an
  emoji-heavy title is not cut short.
- `mediumImageID` for both image address shapes.

No network is touched by the tests. The Edge Function itself is verified by hand
against a real handle and a real story link (Phase 6).

## 12. Alternatives considered

| Approach | Why not |
|---|---|
| **Sign in with Medium / use the API** | Medium's API is closed to new integrations, the documentation repo is archived, and it never had a "list my stories" or "read a story" endpoint — even a legacy token could only *publish*. This was the user's first instinct and it is simply not available. |
| **Scrape the story page** | 403 Cloudflare, from a development machine and from any server. |
| **Medium's internal GraphQL** | 403, and it would be an undocumented schema that changes without notice. It is the only source that would have solved code language and maths, which makes losing it the single biggest fidelity cost. |
| **A third-party reader proxy (r.jina.ai and friends)** | Blocked for `medium.com`, and it would make an external service a dependency of the club's CMS. |
| **Vendor Turndown + a DOM for the conversion** | The RSS subset is small, verified and stable, while this repo is deliberately dependency-free at runtime and its Edge Functions are tested by importing pure modules into `node --test`. A focused converter is testable against the site's own parser; a library would be a black box whose output nobody has checked. |
| **Hotlink Medium's images** | Fastest, but the site stops owning its own content and Medium could move or drop the addresses. Used only as the fallback when an image genuinely cannot be copied. |
| **Import the whole story, no picker** | The user asked for the ability to bring across *part* of a story into a draft already in progress. All-or-nothing cannot do that. |
| **Auto-convert bare links into bookmark cards** | Cards need metadata fetched at deploy; inventing them would produce empty cards. |
| **Create the post immediately, then open the editor** | Leaves junk drafts behind when a writer changes their mind. The content is handed to an unsaved draft instead. |

## 13. Decisions

1. **RSS only.** `medium.com/feed/@handle` (or `<custom-domain>/feed`) is the
   only reachable surface, and it carries the full article for public stories.
2. **Images are re-hosted** on `fcs-assets` through the existing pipeline,
   pinned to a commit and served by jsDelivr; only images in kept sections are
   copied; anything that cannot be copied is hotlinked and reported.
3. **Both entry points**, as the user chose: the Blog page header for a new
   post, and the editor's ⋯ menu to insert into the post on screen. The menu item
   is purely additive and never rewrites existing content.
4. **Partial import.** The writer picks which sections to bring across, with a
   live preview of the result. This is what the user actually wanted from the
   editor-menu path: not "append everything", but "bring across this part".
5. **The copyright confirmation is required** and stands before any content is
   created. Its wording names the risk and the responsibility.
6. **The attribution line is the writer's choice, ticked by default:**
   `Originally published on Medium`, hyperlinked to the original story.
7. **`source_url` is always recorded**, independently of the line, for
   provenance and the duplicate warning.
8. **Imports land as drafts**, never published, and are attributed to the member
   who imported them exactly as a hand-written post would be.
9. **Losses are stated in the interface**, not discovered later: code language,
   gists and native embeds, maths, member-paywalled stories (including every
   story in a Partner-Program publication), the ten-story window, and any image
   left hotlinked.
10. **No new dependency**, and no change to the site's Content-Security-Policy.

## 14. Known limits, in plain terms

- **Ten stories.** A member with a longer Medium history can only import from
  their ten newest. Older work has to be pasted by hand. There is no way around
  this; it is how Medium's feed behaves.
- **Code loses its language.** The blocks are correct and the code is intact;
  the label is gone. The writer picks the language in the editor, or leaves it
  plain.
- **Gists, native embeds and maths need a human.** A gist or a formula becomes a
  placeholder note pointing at the original article. YouTube, tweet, Vimeo and
  CodeSandbox embeds do come across, because their target survives in Medium's
  Embedly frame.
- **A very image-heavy story takes a minute.** Each image is a separate commit.
  The writer waits once, then edits.
- **Member-paywalled stories cannot be imported at all**, not even the author's
  own — and if an author publishes only inside a Partner-Program publication,
  none of their work is importable, because that publication's entire feed is
  teasers.
