/*
 * tools/github-snapshot.mjs
 * ------------------------------------------------------------------
 * Writes data/github.json: the organisation's public repositories and
 * the newest commit on the most recently pushed one, in the same shape
 * as the GitHub API responses the page would otherwise request.
 *
 * Run by .github/workflows/pages.yml before every deploy (every 30
 * minutes and on each push), with the workflow's GITHUB_TOKEN, so
 * visitors read one same-site file instead of calling the rate-limited
 * API themselves. If GitHub is unreachable the old file is kept and the
 * deploy goes ahead; the page then falls back to the live API.
 *
 *   GITHUB_TOKEN=... node tools/github-snapshot.mjs
 * ------------------------------------------------------------------
 */
import { readFileSync, writeFileSync } from "node:fs";

const org = /GITHUB_ORG\s*=\s*"([^"]+)"/.exec(readFileSync("js/data.js", "utf8"))?.[1];
if (!org) throw new Error("GITHUB_ORG not found in js/data.js");

const headers = { Accept: "application/vnd.github+json", "User-Agent": "fcs-site-snapshot" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function gh(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

try {
  const all = await gh(`/orgs/${encodeURIComponent(org)}/repos?per_page=100&sort=updated&type=public`);
  const repos = all
    .filter((r) => !r.private)
    .map(({ name, html_url, description, language, stargazers_count, updated_at, pushed_at }) =>
      ({ name, html_url, description, language, stargazers_count, updated_at, pushed_at }));

  const latest = [...repos].filter((r) => r.pushed_at).sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at))[0];
  let latest_commit = null;
  if (latest) {
    const [c] = await gh(`/repos/${encodeURIComponent(org)}/${encodeURIComponent(latest.name)}/commits?per_page=1`);
    if (c) latest_commit = { html_url: c.html_url, commit: { message: c.commit.message, committer: { date: c.commit.committer.date } } };
  }

  const snapshot = { fetched_at: new Date().toISOString(), org, repos, latest_commit_repo: latest ? latest.name : null, latest_commit };
  writeFileSync("data/github.json", JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`Snapshot: ${repos.length} repos, latest ${latest ? latest.name : "none"}`);
} catch (err) {
  console.warn(`Snapshot skipped, keeping the existing file: ${err.message}`);
}
