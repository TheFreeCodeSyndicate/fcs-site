/*
 * js/main.js
 * ------------------------------------------------------------------
 * Site behaviour. Reads content from js/data.js and renders it into
 * the page, then wires up the sticky nav (mobile menu + active
 * section highlighting). No build step, no framework — this file
 * runs as-is in the browser.
 *
 * You should not need to edit this file to update site content —
 * see js/data.js instead.
 * ------------------------------------------------------------------
 */

document.addEventListener("DOMContentLoaded", () => {
  renderJoinLinks();
  renderStudyGroups();
  fetchRepositories();
  setupMobileNav();
  setupScrollSpy();

  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();
});

/* ------------------------------------------------------------------
 * Section 4 — Join links
 * ---------------------------------------------------------------- */
function renderJoinLinks() {
  const grid = document.getElementById("join-grid");
  if (!grid) return;

  grid.innerHTML = JOIN_LINKS.map(
    (item) => `
      <a class="join-card" href="${item.url}" target="_blank" rel="noopener">
        <span class="join-card-top">
          <span class="join-label">${escapeHTML(item.label)}</span>
          <span class="join-arrow" aria-hidden="true">&rarr;</span>
        </span>
        <span class="join-hint">${escapeHTML(item.hint)}</span>
      </a>
    `
  ).join("");
}

/* ------------------------------------------------------------------
 * Section 3 — Study groups
 * ---------------------------------------------------------------- */
function renderStudyGroups() {
  const grid = document.getElementById("study-group-grid");
  if (!grid) return;

  if (!STUDY_GROUPS || STUDY_GROUPS.length === 0) {
    grid.innerHTML = `<p class="empty-note">No study groups listed yet — propose one in Discord.</p>`;
    return;
  }

  grid.innerHTML = STUDY_GROUPS.map(studyGroupCardHTML).join("");
}

function studyGroupCardHTML(group) {
  const statusClass = `tag-${(group.status || "").toLowerCase()}`;
  return `
    <article class="group-card">
      <div class="group-card-top">
        <h3>${escapeHTML(group.name)}</h3>
        <span class="tag ${statusClass}">${escapeHTML(group.status)}</span>
      </div>
      <p>${escapeHTML(group.topic)}</p>
      <a href="${group.link}" target="_blank" rel="noopener"
        >${escapeHTML(group.linkText)} &rarr;</a
      >
    </article>
  `;
}

/* ------------------------------------------------------------------
 * Section 2 — GitHub repositories (live API pull)
 * ---------------------------------------------------------------- */
async function fetchRepositories() {
  const statusEl = document.getElementById("repo-status");
  const gridEl = document.getElementById("repo-grid");
  if (!statusEl || !gridEl) return;

  try {
    const res = await fetch(
      `https://api.github.com/orgs/${GITHUB_ORG}/repos?per_page=100&sort=updated`,
      { headers: { Accept: "application/vnd.github+json" } }
    );

    if (!res.ok) {
      throw new Error(`GitHub API responded with ${res.status}`);
    }

    const repos = await res.json();

    if (!Array.isArray(repos) || repos.length === 0) {
      statusEl.textContent = "No public repositories found.";
      return;
    }

    // Newest-updated first (the API call above already asks for this,
    // but we sort again client-side in case that ever changes).
    repos.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

    gridEl.innerHTML = repos.map(repoCardHTML).join("");
    statusEl.hidden = true;
    gridEl.hidden = false;
  } catch (err) {
    statusEl.innerHTML = `
      Couldn't reach the GitHub API right now.
      <a href="https://github.com/${GITHUB_ORG}" target="_blank" rel="noopener">
        View the org directly on GitHub &rarr;
      </a>
    `;
    // eslint-disable-next-line no-console
    console.error("[FCS] Repository fetch failed:", err);
  }
}

function repoCardHTML(repo) {
  const description = repo.description
    ? escapeHTML(repo.description)
    : "No description provided.";
  const language = repo.language || "\u2014"; // em dash fallback
  const updated = formatDate(repo.updated_at);

  return `
    <a class="repo-card" href="${repo.html_url}" target="_blank" rel="noopener">
      <div class="repo-card-top">
        <h3>${escapeHTML(repo.name)}</h3>
        <span class="repo-stars">&#9733; ${repo.stargazers_count}</span>
      </div>
      <p>${description}</p>
      <div class="repo-meta">
        <span>${escapeHTML(language)}</span>
        <span>Updated ${updated}</span>
      </div>
    </a>
  `;
}

function formatDate(isoString) {
  const date = new Date(isoString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/* ------------------------------------------------------------------
 * Small utility: escape user/API-sourced text before inserting as HTML
 * ---------------------------------------------------------------- */
function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

/* ------------------------------------------------------------------
 * Nav — mobile menu toggle
 * ---------------------------------------------------------------- */
function setupMobileNav() {
  const toggle = document.getElementById("nav-toggle");
  const links = document.getElementById("nav-links");
  if (!toggle || !links) return;

  toggle.addEventListener("click", () => {
    const isOpen = links.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(isOpen));
  });

  links.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      links.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    });
  });
}

/* ------------------------------------------------------------------
 * Nav — highlight the current section while scrolling
 * ---------------------------------------------------------------- */
function setupScrollSpy() {
  const sections = document.querySelectorAll(".doc-section");
  const navLinks = document.querySelectorAll(".nav-links a");
  if (!sections.length || !navLinks.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          navLinks.forEach((link) => {
            link.classList.toggle("is-active", link.dataset.section === id);
          });
        }
      });
    },
    { rootMargin: "-40% 0px -50% 0px" }
  );

  sections.forEach((section) => observer.observe(section));
}
