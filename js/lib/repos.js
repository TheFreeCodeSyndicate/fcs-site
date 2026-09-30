/*
 * js/lib/repos.js
 * ------------------------------------------------------------------
 * Separates the live GitHub repository list into Projects and
 * Resources. A repo is a Project unless a maintainer has curated it as
 * a Resource or hidden it, so a newly pushed repo appears on its own
 * with no CMS involvement. Two more rules:
 *   - an archived repo is hidden unless someone chose a place for it;
 *   - pinned projects come first, in their own order; the rest keep
 *     the order they came in (most recently updated first).
 * ------------------------------------------------------------------
 */

/**
 * @param {object[]} repos rows from the GitHub API or snapshot
 * @param {object[]} kinds rows from the `repo_kinds` table
 * @returns {{projects: object[], resources: object[], byGroup: Map<string, object[]>}}
 *   resources carry an added `curated_note`; byGroup maps a study
 *   group's id to the (visible) repos linked to it
 */
export function splitRepos(repos = [], kinds = []) {
  const curated = new Map();
  for (const kind of kinds || []) {
    if (kind && kind.repo_name) curated.set(kind.repo_name, kind);
  }

  const pinned = [];
  const projects = [];
  const resources = [];
  const byGroup = new Map();

  for (const repo of repos || []) {
    if (!repo || !repo.name) continue;
    const entry = curated.get(repo.name);
    if (entry && entry.kind === "hidden") continue;
    if (!entry && repo.archived) continue;

    // Every branch copies: the caller gets rows it may sort or annotate
    // without mutating the GitHub response it passed in.
    if (entry && entry.kind === "resource") {
      resources.push({ ...repo, curated_note: entry.note || "" });
    } else if (entry && entry.pinned) {
      pinned.push({ ...repo, sort_order: entry.sort_order || 0 });
    } else {
      projects.push({ ...repo });
    }

    if (entry && entry.group_id) {
      if (!byGroup.has(entry.group_id)) byGroup.set(entry.group_id, []);
      byGroup.get(entry.group_id).push({ ...repo });
    }
  }

  pinned.sort((a, b) => a.sort_order - b.sort_order);
  return { projects: [...pinned, ...projects], resources, byGroup };
}
