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
    // Both branches copy: the caller gets rows it may sort or annotate
    // without mutating the GitHub response it passed in.
    if (entry && entry.kind === "resource") {
      resources.push({ ...repo, curated_note: entry.note || "" });
    } else {
      projects.push({ ...repo });
    }
  }

  return { projects, resources };
}
