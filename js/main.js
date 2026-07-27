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
  renderPrinciples();
  renderContributionLanes();
  renderJoinLinks();
  renderStudyGroups();
  renderEvents();
  fetchMaintainers();
  fetchRepositories();
  setupMobileNav();
  setupScrollSpy();

  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();
});

/* ------------------------------------------------------------------
 * Section 3 — Operating protocol
 * ---------------------------------------------------------------- */
function renderPrinciples() {
  const list = document.getElementById("principle-list");
  if (!list) return;

  list.innerHTML = PRINCIPLES.map(
    (item, index) => `
      <article class="principle-item">
        <span class="principle-index">${String(index + 1).padStart(2, "0")}</span>
        <div>
          <h3>${escapeHTML(item.title)}</h3>
          <p>${escapeHTML(item.text)}</p>
        </div>
      </article>
    `
  ).join("");
}

/* ------------------------------------------------------------------
 * Section 7 — Contribution lanes
 * ---------------------------------------------------------------- */
function renderContributionLanes() {
  const grid = document.getElementById("lane-grid");
  if (!grid) return;

  grid.innerHTML = CONTRIBUTION_LANES.map(
    (lane) => `
      <article class="lane-card">
        <span class="mini-label">${escapeHTML(lane.label)}</span>
        <h3>${escapeHTML(lane.title)}</h3>
        <p>${escapeHTML(lane.text)}</p>
      </article>
    `
  ).join("");
}

/* ------------------------------------------------------------------
 * Section 9 — Join links
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
 * Section 5 — Study groups
 * ---------------------------------------------------------------- */
function renderStudyGroups() {
  const grid = document.getElementById("study-group-grid");
  if (!grid) return;

  if (!STUDY_GROUPS || STUDY_GROUPS.length === 0) {
    grid.innerHTML = `<p class="empty-note">No study groups are listed yet. Propose one in Discord.</p>`;
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
 * Section 6 — Events
 * ---------------------------------------------------------------- */
function renderEvents() {
  const list = document.getElementById("event-list");
  if (!list) return;

  if (!EVENTS || EVENTS.length === 0) {
    list.innerHTML = `<p class="empty-note">No events are listed yet. Add the next one in js/data.js.</p>`;
    return;
  }

  list.innerHTML = EVENTS.map(eventCardHTML).join("");
}

function eventCardHTML(event) {
  const statusClass = `tag-${(event.status || "").toLowerCase()}`;
  const linkHTML = event.link
    ? `<a href="${event.link}" target="_blank" rel="noopener">${escapeHTML(event.linkText || "Open event")} &rarr;</a>`
    : "";

  return `
    <article class="event-card">
      <div class="event-date">
        <span>${escapeHTML(event.date)}</span>
        <strong>${escapeHTML(event.time)}</strong>
      </div>
      <div class="event-main">
        <div class="event-card-top">
          <div>
            <span class="mini-label">${escapeHTML(event.group)}</span>
            <h3>${escapeHTML(event.title)}</h3>
          </div>
          <span class="tag ${statusClass}">${escapeHTML(event.status)}</span>
        </div>
        <p>${escapeHTML(event.details)}</p>
        ${linkHTML}
      </div>
    </article>
  `;
}

/* ------------------------------------------------------------------
 * Section 8 — Maintainers
 * ---------------------------------------------------------------- */
async function fetchMaintainers() {
  const statusEl = document.getElementById("maintainer-status");
  const gridEl = document.getElementById("maintainer-grid");
  if (!statusEl || !gridEl) return;

  try {
    const profiles = await Promise.all(
      MAINTAINERS.map(async (maintainer) => {
        const res = await fetch(`https://api.github.com/users/${maintainer.username}`, {
          headers: { Accept: "application/vnd.github+json" },
        });

        if (!res.ok) {
          throw new Error(`GitHub API responded with ${res.status}`);
        }

        const profile = await res.json();
        return { ...maintainer, profile };
      })
    );

    gridEl.innerHTML = profiles.map(maintainerCardHTML).join("");
    statusEl.hidden = true;
    gridEl.hidden = false;
  } catch (err) {
    gridEl.innerHTML = MAINTAINERS.map(maintainerFallbackCardHTML).join("");
    statusEl.textContent = "GitHub profiles cannot be read now. Maintainer links remain available.";
    gridEl.hidden = false;
    // eslint-disable-next-line no-console
    console.error("[FCS] Maintainer profile fetch failed:", err);
  }
}

function maintainerCardHTML(maintainer) {
  const profile = maintainer.profile || {};
  const displayName = profile.name || maintainer.name;
  const bio = profile.bio || "No public profile note is present.";
  const location = profile.location || "Location not listed";
  const repoCount = Number.isFinite(profile.public_repos) ? profile.public_repos : 0;
  const followers = Number.isFinite(profile.followers) ? profile.followers : 0;

  return `
    <article class="maintainer-card">
      <div class="maintainer-top">
        <img
          src="${profile.avatar_url}"
          alt=""
          aria-hidden="true"
          width="96"
          height="96"
          loading="lazy"
        />
        <div>
          <h3>${escapeHTML(maintainer.name)}</h3>
          <a href="${maintainer.url}" target="_blank" rel="noopener">@${escapeHTML(maintainer.username)}</a>
        </div>
      </div>
      <p class="maintainer-bio">${escapeHTML(bio)}</p>
      <dl class="maintainer-meta">
        <div>
          <dt>profile name</dt>
          <dd>${escapeHTML(displayName)}</dd>
        </div>
        <div>
          <dt>location</dt>
          <dd>${escapeHTML(location)}</dd>
        </div>
        <div>
          <dt>public repos</dt>
          <dd>${repoCount}</dd>
        </div>
        <div>
          <dt>followers</dt>
          <dd>${followers}</dd>
        </div>
      </dl>
    </article>
  `;
}

function maintainerFallbackCardHTML(maintainer) {
  return `
    <article class="maintainer-card">
      <div class="maintainer-top">
        <span class="maintainer-avatar" aria-hidden="true">${escapeHTML(maintainer.name.charAt(0))}</span>
        <div>
          <h3>${escapeHTML(maintainer.name)}</h3>
          <a href="${maintainer.url}" target="_blank" rel="noopener">@${escapeHTML(maintainer.username)}</a>
        </div>
      </div>
      <p class="maintainer-bio">Open the GitHub profile for the current public overview.</p>
    </article>
  `;
}

/* ------------------------------------------------------------------
 * Section 4 — GitHub repositories
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
      statusEl.textContent = "No public repositories were found.";
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
      The GitHub API cannot be reached now.
      <a href="https://github.com/${GITHUB_ORG}" target="_blank" rel="noopener">
        Open the organization on GitHub &rarr;
      </a>
    `;
    // eslint-disable-next-line no-console
    console.error("[FCS] Repository fetch failed:", err);
  }
}

function repoCardHTML(repo) {
  const description = repo.description
    ? escapeHTML(repo.description)
    : "No description is present.";
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
