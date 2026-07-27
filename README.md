# The Free Code Syndicate — website

A static, frontend-only site for The Free Code Syndicate. No build step,
no framework, no backend — it's plain HTML/CSS/JS, deployable straight to
GitHub Pages.

## File structure

```
fcs-site/
├── index.html          Page structure and copy (Abstract, How to Join, References)
├── css/
│   └── style.css       All styling
├── js/
│   ├── data.js         ← EDIT THIS to update content
│   └── main.js         Rendering logic and nav behaviour (rarely needs editing)
└── assets/
    ├── fcs-mark.png            full-resolution logo mark
    ├── fcs-mark-header.png     smaller logo used in the hero
    └── favicon-*.png           favicon / touch-icon sizes
```

## Updating content

Almost everything you'll want to change on a regular basis lives in
**`js/data.js`**:

- **Study groups** (Section 3) — add, remove, or edit entries in the
  `STUDY_GROUPS` array. Each one needs a `name`, `topic`, `status`
  (`"Active"`, `"Forming"`, or `"Paused"`), a `link`, and a `linkText`.
- **Join links** (Section 4) — edit the `JOIN_LINKS` array.
- **GitHub org** (Section 2) — change the `GITHUB_ORG` constant if the
  organization is ever renamed. Repositories are pulled live from the
  public GitHub API at page-load, so **you never need to hand-edit a
  repo list** — push a new repo to the org and it shows up here on its
  own.

You should not need to touch `index.html`, `css/style.css`, or
`js/main.js` for routine content updates. Those only change if you're
adding a new *section* or *feature* to the page.

## Running it locally

No build step is required. From this folder, run any static file
server, for example:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`. (Opening `index.html` directly via
`file://` also mostly works, but some browsers block the GitHub API
fetch under `file://` — a local server avoids that.)

## Deploying to GitHub Pages

1. Push this folder to the root of a repository (or to a `/docs`
   folder, or a dedicated branch — whatever your Pages settings use).
2. In the repository's **Settings → Pages**, set the source to that
   location.
3. GitHub will publish it at `https://<org-or-user>.github.io/<repo>/`.

A `.nojekyll` file is included so GitHub Pages serves the files as-is,
without running them through Jekyll first.

## Notes on the GitHub API call

Section 2 calls the public, unauthenticated GitHub REST API
(`api.github.com/orgs/<org>/repos`). That's rate-limited to 60
requests per hour *per visitor's IP* — fine for a community site like
this, since each visitor's browser only makes one request. If the
limit is ever hit, the section fails gracefully and links out to the
GitHub org page instead of showing an error.
