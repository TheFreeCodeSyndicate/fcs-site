/*
 * js/main.js
 * ------------------------------------------------------------------
 * Site behaviour. A MODULE, so everything it needs is either an
 * import or an explicit `window.X` read — data.js is a classic
 * script, and its top-level `const`s live in the global lexical
 * environment, which a module cannot see.
 *
 * Content comes from the database via js/supabase.js, falling back to
 * the SEED_* arrays when Supabase is unconfigured or unreachable. The
 * repository list comes from the public GitHub API. No build step, no
 * framework — this file runs as-is in the browser.
 *
 * Edit site content in the admin panel at /admin, not in this file.
 * ------------------------------------------------------------------
 */

import { deriveEventState } from "./lib/derive.js";
import { resolveNextSession } from "./lib/schedule.js";
import { formatCountdown } from "./lib/countdown.js";
import { partitionEvents, groupNames, filterByGroup } from "./lib/events-view.js";
import { buildICS } from "./lib/ics.js";
import { splitRepos } from "./lib/repos.js";
import {
  getEvents, getClassSessions, getResources,
  getStudyGroups, getSocialLinks, getRepoKinds,
} from "./supabase.js";

let allEvents = [];
let allClassSessions = [];
let dbResources = [];
let githubResources = [];
let activeGroup = "All";
let countdownTimer = null;
let icsBound = false;

document.addEventListener("DOMContentLoaded", () => {
  renderPrinciples();
  renderContributionLanes();

  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  setupMobileNav();
  setupScrollSpy();
  setupReveal();
  setupCopyButtons();

  // The three fetches are deliberately independent: a Supabase outage
  // or a GitHub rate limit degrades one section without touching the
  // others.
  loadContent();
  loadRepositories();
  fetchMaintainers();
});

/* ------------------------------------------------------------------
 * Output safety
 *
 * These render database- and API-supplied strings. `escapeHTML` covers
 * text nodes. `escapeAttr` additionally escapes quotes so a value
 * cannot break out of an attribute. `safeURL` refuses anything that is
 * not http(s), so a stored `javascript:` URL cannot execute on click.
 * ------------------------------------------------------------------ */

function escapeHTML(value) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}

function escapeAttr(value) {
  return escapeHTML(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function safeURL(value) {
  const raw = String(value == null ? "" : value).trim();
  return /^https?:\/\//i.test(raw) ? escapeAttr(raw) : "";
}

/* ------------------------------------------------------------------
 * Section 3 — Operating protocol
 * ---------------------------------------------------------------- */
function renderPrinciples() {
  const list = document.getElementById("principle-list");
  if (!list) return;

  const principles = window.PRINCIPLES || [];
  if (!principles.length) {
    list.innerHTML = `<p class="empty-note">No principles are listed yet.</p>`;
    return;
  }

  list.innerHTML = principles.map(
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
 * Section 8 — Contribution lanes
 * ---------------------------------------------------------------- */
function renderContributionLanes() {
  const grid = document.getElementById("lane-grid");
  if (!grid) return;

  const lanes = window.CONTRIBUTION_LANES || [];
  if (!lanes.length) {
    grid.innerHTML = `<p class="empty-note">No lanes are listed yet.</p>`;
    return;
  }

  grid.innerHTML = lanes.map(
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
 * Content — one Supabase read per public table, each with a seed
 * fallback. A failure anywhere resolves to the seed array rather than
 * rejecting, so Promise.all cannot blank the page.
 * ---------------------------------------------------------------- */
async function loadContent() {
  const [events, classSessions, resources, studyGroups, socialLinks] = await Promise.all([
    getEvents(window.SEED_EVENTS || []),
    getClassSessions([]),
    getResources(window.SEED_RESOURCES || []),
    getStudyGroups(window.SEED_STUDY_GROUPS || []),
    getSocialLinks(window.SEED_JOIN_LINKS || []),
  ]);

  allEvents = Array.isArray(events) ? events : [];
  allClassSessions = Array.isArray(classSessions) ? classSessions : [];
  dbResources = Array.isArray(resources) ? resources : [];

  renderEvents();
  renderWeekStrip();
  renderResources();
  renderStudyGroups(studyGroups);
  renderJoinLinks(socialLinks);
  renderReferences(socialLinks);
  bindIcs();
}

/* ------------------------------------------------------------------
 * Section 4 — GitHub repositories
 * ---------------------------------------------------------------- */
async function loadRepositories() {
  const statusEl = document.getElementById("repo-status");
  const gridEl = document.getElementById("repo-grid");
  if (!statusEl || !gridEl) return;

  try {
    const res = await fetch(
      `https://api.github.com/orgs/${window.GITHUB_ORG}/repos?per_page=100&sort=updated`,
      { headers: { Accept: "application/vnd.github+json" } }
    );
    if (!res.ok) throw new Error(`GitHub API responded with ${res.status}`);

    const repos = await res.json();
    if (!Array.isArray(repos) || repos.length === 0) {
      statusEl.textContent = "No public repositories were found.";
      return;
    }
    repos.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

    const kinds = await getRepoKinds();
    const curated = kinds.length ? kinds : window.SEED_REPO_KINDS || [];
    const { projects, resources } = splitRepos(repos, curated);

    githubResources = resources.map((repo) => ({
      title: repo.name,
      kind: "tool",
      url: repo.html_url,
      summary: repo.description || repo.curated_note || "Curated as a resource.",
      group_name: null,
      via_github: true,
    }));

    gridEl.innerHTML =
      `<div class="repo-head" aria-hidden="true">
         <span>Repository</span><span>Description</span><span>Language</span><span>Updated</span><span>Stars</span>
       </div>` + projects.map(repoCardHTML).join("");
    statusEl.hidden = true;
    gridEl.hidden = false;
    renderActivityTicker(repos);

    // Re-render so the Resources section picks up the GitHub-sourced
    // rows alongside the database ones.
    renderResources();
  } catch (err) {
    statusEl.innerHTML = `
      The GitHub API cannot be reached now.
      <a href="https://github.com/${escapeAttr(window.GITHUB_ORG)}" target="_blank" rel="noopener">
        Open the organization on GitHub &rarr;
      </a>
    `;
    console.error("[FCS] Repository fetch failed:", err);
  }
}

/* One row of the project index. Keeps the .repo-card class so the
 * headless page check still counts projects. */
function repoCardHTML(repo) {
  const description = repo.description
    ? escapeHTML(repo.description)
    : "No description yet.";
  const stars = Number.isFinite(repo.stargazers_count) ? repo.stargazers_count : 0;

  return `
    <a class="repo-card" href="${safeURL(repo.html_url)}" target="_blank" rel="noopener">
      <span class="repo-name">${escapeHTML(repo.name)}</span>
      <span class="repo-desc">${description}</span>
      <span class="repo-lang">${escapeHTML(repo.language || "n/a")}</span>
      <span class="repo-updated">${escapeHTML(formatDate(repo.updated_at))}</span>
      <span class="repo-stars" aria-label="${stars} stars">&#9733; ${stars}</span>
    </a>
  `;
}

const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/* "3 days ago" from an ISO timestamp, in the largest sensible unit. */
function timeAgo(isoString, now = Date.now()) {
  const seconds = (new Date(isoString).getTime() - now) / 1000;
  if (!Number.isFinite(seconds)) return "";
  const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relativeTime.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

/* A single marquee of real recent pushes, so a visitor can see the
 * group is working. The track is rendered twice for a seamless loop;
 * the copy is hidden from screen readers. */
function renderActivityTicker(repos) {
  const ticker = document.getElementById("activity-ticker");
  if (!ticker) return;

  const recent = repos
    .filter((repo) => repo.pushed_at)
    .sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at))
    .slice(0, 8);
  if (recent.length < 3) return;

  const items = recent
    .map((repo) => `<li><strong>${escapeHTML(repo.name)}</strong> pushed ${escapeHTML(timeAgo(repo.pushed_at))}</li>`)
    .join("");
  ticker.innerHTML = `
    <ul class="ticker-track">${items}</ul>
    <ul class="ticker-track" aria-hidden="true">${items}</ul>`;
  ticker.hidden = false;
}

function formatDate(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "an unknown date";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/* ------------------------------------------------------------------
 * Section 9 — Maintainers
 * ---------------------------------------------------------------- */
async function fetchMaintainers() {
  const statusEl = document.getElementById("maintainer-status");
  const gridEl = document.getElementById("maintainer-grid");
  if (!statusEl || !gridEl) return;

  const maintainers = window.MAINTAINERS || [];
  if (!maintainers.length) {
    statusEl.textContent = "No maintainers are listed yet.";
    gridEl.hidden = true;
    return;
  }

  try {
    const profiles = await Promise.all(
      maintainers.map(async (maintainer) => {
        const res = await fetch(`https://api.github.com/users/${encodeURIComponent(maintainer.username)}`, {
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
    gridEl.innerHTML = maintainers.map(maintainerFallbackCardHTML).join("");
    statusEl.textContent = "GitHub profiles cannot be read now. Maintainer links remain available.";
    gridEl.hidden = false;
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
  // A GitHub API that returned something other than an image URL would
  // otherwise produce a broken <img> on every card.
  const avatar = safeURL(profile.avatar_url);

  return `
    <article class="maintainer-card">
      <div class="maintainer-top">
        ${
          avatar
            ? `<img
          src="${avatar}"
          alt=""
          aria-hidden="true"
          width="96"
          height="96"
          loading="lazy"
        />`
            : `<span class="maintainer-avatar" aria-hidden="true">${escapeHTML(String(maintainer.name).charAt(0))}</span>`
        }
        <div>
          <h3>${escapeHTML(maintainer.name)}</h3>
          <a href="${safeURL(maintainer.url)}" target="_blank" rel="noopener">@${escapeHTML(maintainer.username)}</a>
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
        <span class="maintainer-avatar" aria-hidden="true">${escapeHTML(String(maintainer.name).charAt(0))}</span>
        <div>
          <h3>${escapeHTML(maintainer.name)}</h3>
          <a href="${safeURL(maintainer.url)}" target="_blank" rel="noopener">@${escapeHTML(maintainer.username)}</a>
        </div>
      </div>
      <p class="maintainer-bio">Open the GitHub profile for the current public overview.</p>
    </article>
  `;
}

/* ------------------------------------------------------------------
 * Section 5 — Resources
 * ---------------------------------------------------------------- */

const RESOURCE_KIND_LABELS = {
  notes: "Notes", video: "Video", paper: "Paper",
  course: "Course", tool: "Tool", book: "Book",
};

function resourceCardHTML(resource) {
  const href = safeURL(resource.url);
  if (!href) return "";

  return `
    <a class="resource-card" href="${href}" target="_blank" rel="noopener">
      <span class="resource-card-top">
        <span class="resource-kind">${escapeHTML(RESOURCE_KIND_LABELS[resource.kind] || resource.kind || "Resource")}</span>
        ${resource.via_github ? `<span class="resource-origin">via GitHub</span>` : ""}
        <span class="resource-ext" aria-hidden="true">&#8599;</span>
      </span>
      <h3>${escapeHTML(resource.title)}</h3>
      ${resource.summary ? `<p>${escapeHTML(resource.summary)}</p>` : ""}
      ${resource.curated_note ? `<span class="mini-label">${escapeHTML(resource.curated_note)}</span>` : ""}
      ${resource.group_name ? `<span class="mini-label">${escapeHTML(resource.group_name)}</span>` : ""}
    </a>
  `;
}

function renderResources(fromDatabase) {
  const grid = document.getElementById("resource-grid");
  if (!grid) return;

  // Called with no argument by loadRepositories once the GitHub rows
  // arrive, so the default has to be the rows already loaded rather
  // than an empty list — otherwise the database resources vanish.
  const base = Array.isArray(fromDatabase) ? fromDatabase : dbResources;
  const all = [...base, ...githubResources];

  grid.innerHTML = all.length
    ? all.map(resourceCardHTML).join("")
    : `<p class="empty-note">Nothing on the reading list yet. Ask in the rooms below for what the groups are reading now.</p>`;
}

/* ------------------------------------------------------------------
 * Section 6 — Study groups
 * ---------------------------------------------------------------- */
function renderStudyGroups(groups) {
  const grid = document.getElementById("study-group-grid");
  if (!grid) return;

  const list = Array.isArray(groups) ? groups : [];
  if (!list.length) {
    grid.innerHTML = `<p class="empty-note">No study groups are listed yet. Propose one in Discord.</p>`;
    return;
  }

  grid.innerHTML = list.map(studyGroupCardHTML).join("");
}

function studyGroupCardHTML(group) {
  // Status is a free-text column, so the class is derived defensively:
  // an unknown status falls back to a neutral tag rather than producing
  // a bare class that styles nothing.
  const status = String(group.status || "").trim();
  const slug = status.toLowerCase().replace(/[^a-z]+/g, "-");
  const known = ["active", "forming", "paused", "completed"];
  const statusClass = known.includes(slug) ? `tag-${slug}` : "tag-upcoming";
  const href = safeURL(group.link);

  const link = href
    ? `<a href="${href}" target="_blank" rel="noopener">${escapeHTML(group.link_text || "Open the group")} &rarr;</a>`
    : "";

  return `
    <article class="group-card">
      <div class="group-card-top">
        <h3>${escapeHTML(group.name)}</h3>
        ${status ? `<span class="tag ${statusClass}">${escapeHTML(status)}</span>` : ""}
      </div>
      <p>${escapeHTML(group.topic)}</p>
      ${link}
    </article>
  `;
}

/* ------------------------------------------------------------------
 * Section 7 — Events
 * ---------------------------------------------------------------- */
function renderEvents() {
  const list = document.getElementById("event-list");
  if (!list) return;

  const { upcoming, past } = partitionEvents(allEvents);
  const chipNames = ["All", ...groupNames(allEvents)];
  if (!chipNames.includes(activeGroup)) activeGroup = "All";

  const chipsEl = document.getElementById("event-filters");
  if (chipsEl) {
    chipsEl.innerHTML = chipNames
      .map((name) => `<button type="button" class="chip${name === activeGroup ? " is-active" : ""}">${escapeHTML(name)}</button>`)
      .join("");

    // The visible label is escaped, but `data-group` must hold the RAW
    // value: `dataset` returns the attribute as parsed, so an escaped
    // "R&amp;D" would be compared against "R&D" and match nothing.
    Array.from(chipsEl.querySelectorAll(".chip")).forEach((chip, index) => {
      chip.dataset.group = chipNames[index];
      chip.addEventListener("click", () => {
        activeGroup = chip.dataset.group;
        renderEvents();
      });
    });
  }

  const shownUpcoming = filterByGroup(upcoming, activeGroup);
  const shownPast = filterByGroup(past, activeGroup);

  // A site that only uses the weekly class schedule has no one-off
  // events at all, and must not be told "nothing scheduled".
  if (!shownUpcoming.length && !shownPast.length && !allClassSessions.length) {
    list.innerHTML = `<p class="empty-note">Nothing scheduled right now. New sessions are announced in the rooms below.</p>`;
    stopCountdown();
    return;
  }

  const pastBlock = shownPast.length
    ? `<details class="past-events">
         <summary>Show ${shownPast.length} past event${shownPast.length === 1 ? "" : "s"}</summary>
         <div class="event-list">${shownPast.map(eventCardHTML).join("")}</div>
       </details>`
    : "";

  list.innerHTML = `
    ${shownUpcoming.length ? `<div class="event-list">${shownUpcoming.map(eventCardHTML).join("")}</div>` : ""}
    ${pastBlock}
  `;

  startCountdown();
}

function eventCardHTML(event) {
  const start = new Date(event.starts_at);
  // display_state, never event.stage: stage is what a maintainer typed,
  // and only the derived value accounts for the clock.
  const state = event.display_state;
  const isLive = state === "live";

  const label = isLive ? "LIVE NOW" : state === "upcoming" ? "UPCOMING" : "FINISHED";
  const href = safeURL(event.link);

  const links = [];
  if (href) {
    links.push(`<a href="${href}" target="_blank" rel="noopener">${escapeHTML(event.link_text || "Open event")} &rarr;</a>`);
  }
  if (state !== "finished") {
    links.push(`<button type="button" class="link-button" data-ics-single="${escapeAttr(event.id)}">Add to calendar</button>`);
  }

  const tag = isLive
    ? '<span class="tag tag-live"><span class="live-dot" aria-hidden="true"></span>LIVE NOW</span>'
    : `<span class="tag tag-${state}">${label}</span>`;

  return `
    <article class="event-card${isLive ? " is-live" : ""}">
      <div class="event-date">
        <span>${escapeHTML(start.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }))}</span>
        <strong>${escapeHTML(start.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }))}</strong>
      </div>
      <div class="event-main">
        <div class="event-card-top">
          <div>
            ${event.group_name ? `<span class="mini-label">${escapeHTML(event.group_name)}</span>` : ""}
            <h3>${escapeHTML(event.title)}</h3>
          </div>
          ${tag}
        </div>
        ${event.details ? `<p>${escapeHTML(event.details)}</p>` : ""}
        ${links.length ? `<div class="event-links">${links.join("")}</div>` : ""}
      </div>
    </article>
  `;
}

/* ------------------------------------------------------------------
 * Next-session countdown
 *
 * Writes one text node per tick, and only when the text actually
 * changes, so the DOM and the screen reader are not churned once a
 * second. The element carries aria-live="off" for the same reason.
 * ---------------------------------------------------------------- */
function startCountdown() {
  stopCountdown();

  const tick = () => {
    const band = document.getElementById("next-session");
    if (!band) return;

    const titleEl = band.querySelector("[data-next-title]");
    const groupEl = band.querySelector("[data-next-group]");
    const whenEl = band.querySelector("[data-next-when]");
    const countEl = band.querySelector("[data-next-countdown]");
    if (!titleEl || !whenEl || !countEl) return;

    const now = new Date();

    const live = allEvents.find(
      (e) => deriveEventState(e.starts_at, e.duration_minutes, e.stage, now) === "live"
    );
    if (live) {
      band.dataset.mode = "live";
      titleEl.textContent = live.title;
      if (groupEl) groupEl.textContent = live.group_name || "";
      whenEl.innerHTML = '<span class="live-dot" aria-hidden="true"></span>Happening now';
      countEl.textContent = "";
      return;
    }

    const next = resolveNextSession({ events: allEvents, classSessions: allClassSessions }, now);
    if (!next) {
      band.dataset.mode = "none";
      titleEl.textContent = "Next session to be announced";
      if (groupEl) groupEl.textContent = "";
      whenEl.textContent = "Watch the rooms below for the next date.";
      countEl.textContent = "";
      return;
    }

    band.dataset.mode = "countdown";
    titleEl.textContent = next.title;
    if (groupEl) groupEl.textContent = next.group || "";
    whenEl.textContent =
      next.at.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) +
      " · " + next.at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

    const text = formatCountdown(next.at.getTime() - now.getTime());
    if (countEl.textContent !== text) countEl.textContent = text;
  };

  tick();
  countdownTimer = setInterval(tick, 1000);
}

function stopCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

/* ------------------------------------------------------------------
 * Calendar download — the whole schedule, or a single event.
 * ---------------------------------------------------------------- */
function downloadICS(events, filename) {
  const ics = buildICS(events, { calendarName: "FCS Events" });
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function bindIcs() {
  if (icsBound) return;

  const whole = document.getElementById("subscribe-ics");
  if (whole) {
    whole.addEventListener("click", () => {
      const { upcoming } = partitionEvents(allEvents);
      if (!upcoming.length) {
        whole.disabled = true;
        whole.textContent = "Nothing to subscribe to";
        return;
      }
      downloadICS(upcoming, "fcs-events.ics");
    });
  }

  const list = document.getElementById("event-list");
  if (list) {
    // DELEGATED, not per-card: the list is re-rendered on every filter
    // change, which would drop a listener bound to a card.
    list.addEventListener("click", (evt) => {
      const button = evt.target.closest("[data-ics-single]");
      if (!button) return;
      const event = allEvents.find((e) => String(e.id) === button.dataset.icsSingle);
      if (!event) return;
      const slug = String(event.title || "event")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40);
      downloadICS([event], `fcs-${slug || "event"}.ics`);
    });
  }

  icsBound = true;
}

/* ------------------------------------------------------------------
 * Section 10 — Entry links
 * ---------------------------------------------------------------- */
function renderJoinLinks(links) {
  const grid = document.getElementById("join-grid");
  if (!grid) return;

  const list = (Array.isArray(links) ? links : []).filter((item) => item && safeURL(item.url));
  if (!list.length) {
    grid.innerHTML = `<p class="empty-note">No rooms are listed yet.</p>`;
    return;
  }

  grid.innerHTML = list.map((item) => {
    const url = safeURL(item.url);
    const shown = escapeHTML(String(item.url).replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, ""));
    const flag = escapeHTML(String(item.platform || item.label || "link").toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    return `
      <div class="join-card">
        <p class="join-command"><span class="join-prompt" aria-hidden="true">$</span> join --${flag}</p>
        <a class="join-url" href="${url}" target="_blank" rel="noopener">
          <span class="join-label">${escapeHTML(item.label)}</span>
          <span class="join-address">${shown}</span>
        </a>
        <p class="join-hint">${escapeHTML(item.hint)}</p>
        <button type="button" class="join-copy" data-copy="${url}" aria-label="Copy the ${escapeAttr(item.label)} link">Copy</button>
      </div>
    `;
  }).join("");
}

/* ------------------------------------------------------------------
 * Section 11 — References
 * ---------------------------------------------------------------- */
function renderReferences(links) {
  const list = document.getElementById("ref-list");
  if (!list) return;

  const items = (Array.isArray(links) ? links : []).filter((item) => item && safeURL(item.url));
  if (!items.length) {
    list.innerHTML = `<li class="empty-note">No references are listed yet.</li>`;
    return;
  }

  list.innerHTML = items.map(
    (item) => `
      <li>
        <span class="ref-tag">[${escapeHTML(String(item.platform || "link").toUpperCase())}]</span>
        <a href="${safeURL(item.url)}" target="_blank" rel="noopener">${escapeHTML(item.label || item.platform || "Link")}</a>
      </li>
    `
  ).join("");
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
 *
 * Resolved from the nav links themselves rather than from every
 * .doc-section, so a section with no link is simply never highlighted.
 * The observer callback can fire for several sections at once, and
 * gaps between sections produce no intersecting entry at all, so the
 * highlighted link is always recomputed from the full picture: any
 * section currently in the middle band wins, otherwise the last one
 * already scrolled past, otherwise the first. The result is that
 * exactly one link is always active.
 * ---------------------------------------------------------------- */
/*
 * Nav — highlight the section currently under the reader.
 *
 * Driven by scroll position rather than IntersectionObserver. An
 * observer with a narrow root band leaves the page with NO link
 * active whenever nothing happens to be crossing that band — which is
 * the normal state at the top of the page, above the first section.
 * This version always resolves to exactly one section, including
 * before any scrolling has happened.
 */
function setupScrollSpy() {
  const navLinks = Array.from(document.querySelectorAll(".nav-links a"));
  if (!navLinks.length) return;

  const sections = navLinks
    .map((link) => document.getElementById(link.dataset.section))
    .filter(Boolean);
  if (!sections.length) return;

  let currentId = null;

  const setActive = (id) => {
    if (id === currentId) return;
    currentId = id;
    navLinks.forEach((link) => {
      const active = link.dataset.section === id;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
  };

  /* The last section whose top has passed a line 40% down the
     viewport. Falls back to the first section when none has, which is
     what happens at the top of the page. */
  const pick = () => {
    const line = window.innerHeight * 0.4;
    let id = sections[0].id;
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= line) id = section.id;
      else break;
    }
    setActive(id);
  };

  let ticking = false;
  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        pick();
      });
    },
    { passive: true }
  );

  window.addEventListener("resize", pick, { passive: true });

  // Establish the initial state immediately, not on the first scroll.
  pick();
}

/* ------------------------------------------------------------------
 * Events: the week at a glance
 *
 * Seven cells, Monday first, each listing that weekday's recurring
 * sessions, with today marked. Hidden when there is no weekly schedule.
 * ---------------------------------------------------------------- */
function renderWeekStrip() {
  const strip = document.getElementById("week-strip");
  if (!strip) return;

  const active = allClassSessions.filter((s) => s && s.is_active !== false);
  if (!active.length) {
    strip.hidden = true;
    return;
  }

  const today = new Date().getDay();
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const order = [1, 2, 3, 4, 5, 6, 0];

  strip.innerHTML = order.map((day) => {
    const sessions = active
      .filter((s) => Number(s.weekday) === day)
      .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
    return `
      <li class="week-day${day === today ? " is-today" : ""}${sessions.length ? "" : " is-empty"}"
          ${day === today ? 'aria-current="date"' : ""}>
        <span class="week-name">${names[day]}${day === today ? " <em>today</em>" : ""}</span>
        ${sessions.map((s) => `
          <span class="week-session">
            <span class="week-time">${escapeHTML(String(s.start_time || "").slice(0, 5))}</span>
            ${escapeHTML(s.title)}
          </span>`).join("")}
      </li>`;
  }).join("");
  strip.hidden = false;
}

/* ------------------------------------------------------------------
 * Copy-to-clipboard for the join commands. One delegated listener, so
 * re-rendered rows need no rebinding.
 * ---------------------------------------------------------------- */
function setupCopyButtons() {
  document.addEventListener("click", async (event) => {
    const button = event.target.closest(".join-copy");
    if (!button) return;
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = "Copied";
    } catch {
      button.textContent = "Press Ctrl+C";
    }
    button.classList.add("is-done");
    clearTimeout(button.resetTimer);
    button.resetTimer = setTimeout(() => {
      button.textContent = "Copy";
      button.classList.remove("is-done");
    }, 1600);
  });
}

/* ------------------------------------------------------------------
 * Reveal on scroll
 *
 * Section contents rise in once, in order, as each section arrives.
 * The class that hides them is added here, so with JavaScript off or
 * reduced motion on, nothing is ever hidden.
 * ---------------------------------------------------------------- */
function setupReveal() {
  if (!("IntersectionObserver" in window)) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const sections = document.querySelectorAll(".doc-section");
  sections.forEach((section) => {
    section.classList.add("will-reveal");
    Array.from(section.children).forEach((child, index) => {
      child.style.setProperty("--reveal-i", Math.min(index, 6));
    });
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-revealed");
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -12% 0px" }
  );
  sections.forEach((section) => observer.observe(section));
}

