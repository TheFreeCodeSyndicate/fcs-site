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
  icon,
  PLATFORM_ICONS,
  platformIcon,
  escapeHTML,
  escapeAttr,
  safeURL,
  roleStamp,
  coreCardHTML,
  RESOURCE_KIND_LABELS,
  resourceCardHTML,
  studyGroupCardHTML,
  eventCardHTML,
  watchFavicons,
} from "./render.js";

watchFavicons();
import {
  getEvents, getClassSessions, getResources,
  getStudyGroups, getSocialLinks, getRepoKinds, getCoreMembers, eventMail,
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

  pinHashTarget();
  setupMobileNav();
  setupScrollSpy();
  setupReveal();
  setupCopyButtons();
  setupGlassNav();

  // The three fetches are deliberately independent: a Supabase outage
  // or a GitHub rate limit degrades one section without touching the
  // others.
  loadContent();
  loadRepositories();
});


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
  const [events, classSessions, resources, studyGroups, socialLinks, coreMembers] = await Promise.all([
    getEvents(window.SEED_EVENTS || []),
    getClassSessions([]),
    getResources(window.SEED_RESOURCES || []),
    getStudyGroups(window.SEED_STUDY_GROUPS || []),
    getSocialLinks(window.SEED_JOIN_LINKS || []),
    getCoreMembers(window.SEED_CORE_MEMBERS || []),
  ]);

  allEvents = Array.isArray(events) ? events : [];
  allClassSessions = Array.isArray(classSessions) ? classSessions : [];
  dbResources = Array.isArray(resources) ? resources : [];

  renderEvents();
  renderWeekStrip();
  renderResources();
  renderStudyGroups(studyGroups);
  setMetaGroups(studyGroups);
  renderJoinLinks(socialLinks);
  setMetaDiscord(socialLinks);
  renderCoreMembers(coreMembers);
  renderFooterSocials(socialLinks);
  bindIcs();
}

/* ------------------------------------------------------------------
 * GitHub reads
 *
 * Anonymous GitHub API calls are limited to 60 an hour per IP, and a
 * page load makes several. On shared college Wi-Fi that runs out fast.
 * So every read is cached in localStorage for ten minutes, and when
 * GitHub refuses (403) the last good copy is shown instead of nothing.
 * ---------------------------------------------------------------- */
const GITHUB_CACHE_MS = 10 * 60 * 1000;

async function cachedJSON(url, headers = {}) {
  const key = `fcs-cache:${url}`;
  let cached = null;
  try {
    cached = JSON.parse(localStorage.getItem(key));
  } catch {
    /* storage unavailable or corrupt: behave as uncached */
  }
  if (cached && Date.now() - cached.at < GITHUB_CACHE_MS) return cached.data;

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`${new URL(url).host} responded with ${res.status}`);
    const data = await res.json();
    try {
      localStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
    } catch {
      /* quota or private mode: the page still works uncached */
    }
    return data;
  } catch (err) {
    if (cached) return cached.data; // stale beats empty
    throw err;
  }
}

/* data/github.json is written by the deploy workflow every 30 minutes
 * with the repository's own token (tools/github-snapshot.mjs). Reading
 * it means no visitor spends GitHub's 60-an-hour anonymous allowance.
 * Missing or older than three hours (a stalled workflow, or local
 * development with the placeholder): use the live API instead. */
const SNAPSHOT_MAX_AGE_MS = 3 * 60 * 60 * 1000;
let snapshotRequest = null;

function githubSnapshot() {
  if (!snapshotRequest) {
    snapshotRequest = fetch("data/github.json", { cache: "no-cache" })
      .then((res) => (res.ok ? res.json() : null))
      .then((snap) => {
        const age = snap && snap.fetched_at ? Date.now() - new Date(snap.fetched_at).getTime() : Infinity;
        return age < SNAPSHOT_MAX_AGE_MS && Array.isArray(snap.repos) ? snap : null;
      })
      .catch(() => null);
  }
  return snapshotRequest;
}

function githubJSON(path) {
  return cachedJSON(`https://api.github.com${path}`, { Accept: "application/vnd.github+json" });
}

/* ------------------------------------------------------------------
 * Section 4 — GitHub repositories
 * ---------------------------------------------------------------- */
async function loadRepositories() {
  const statusEl = document.getElementById("repo-status");
  const gridEl = document.getElementById("repo-grid");
  if (!statusEl || !gridEl) return;

  try {
    const snapshot = await githubSnapshot();
    const repos = snapshot
      ? snapshot.repos.map((repo) => ({ ...repo }))
      : await githubJSON(`/orgs/${encodeURIComponent(window.GITHUB_ORG)}/repos?per_page=100&sort=updated`);
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
    setMetaCommit(repos);

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
 * Section 9: Core members
 *
 * Leads get a full personnel-file card each. Mentors get ID badges in
 * a grid: everything visible at rest, no click to expand. Badges sit at
 * small tilts and straighten on hover while coloured cards fan out
 * behind them. Group filters appear past 8 mentors; alumni sit in a
 * collapsed list at the end.
 *
 * No GitHub API calls: avatars are plain image URLs
 * (github.com/<user>.png), which the rate limit does not count.
 * ---------------------------------------------------------------- */
const MENTOR_FILTER_THRESHOLD = 8;
let mentorGroup = "All";
let mentors = [];

function sortMembers(list) {
  return [...list].sort(
    (a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.name).localeCompare(String(b.name))
  );
}

function renderCoreMembers(members) {
  const section = document.getElementById("core");
  if (!section) return;

  const all = sortMembers(Array.isArray(members) ? members : []);
  const active = all.filter((m) => m.status !== "alumni");
  const alumni = all.filter((m) => m.status === "alumni");
  const leads = active.filter((m) => m.role === "lead");
  mentors = active.filter((m) => m.role !== "lead");

  const count = document.getElementById("core-count");
  if (count) count.textContent = active.length ? `${active.length} ${active.length === 1 ? "person" : "people"}` : "";

  const leadsWrap = document.getElementById("core-leads-wrap");
  const leadsEl = document.getElementById("core-leads");
  leadsEl.innerHTML = leads.map((m, i) => coreCardHTML(m, i)).join("");
  leadsWrap.hidden = !leads.length;

  renderMentors();

  const alumniEl = document.getElementById("core-alumni");
  alumniEl.hidden = !alumni.length;
  alumniEl.innerHTML = alumni.length
    ? `<summary>Past core members (${alumni.length})</summary>
       <ul>${alumni.map((m) => {
         const years = [m.joined_on, m.ended_on].filter(Boolean).map((d) => String(d).slice(0, 4)).join(" to ");
         const link = m.github_username
           ? `<a href="${safeURL(`https://github.com/${encodeURIComponent(m.github_username)}`)}" target="_blank" rel="noopener">@${escapeHTML(m.github_username)}</a>`
           : "";
         return `<li><strong>${escapeHTML(m.name)}</strong> ${roleStamp(m)} <span>${escapeHTML(years)}</span> ${link}</li>`;
       }).join("")}</ul>`
    : "";

  if (!active.length && !alumni.length) {
    leadsWrap.hidden = false;
    leadsEl.innerHTML = `<p class="empty-note">The core member list is being written. Ask in the rooms below who runs what.</p>`;
  }

  bindCoreMembers();
}

function renderMentors() {
  const wrap = document.getElementById("core-mentors-wrap");
  const grid = document.getElementById("core-mentors");
  const filters = document.getElementById("core-filters");
  if (!wrap || !grid) return;

  wrap.hidden = !mentors.length;
  if (!mentors.length) return;

  const groups = [...new Set(mentors.map((m) => m.group_name).filter(Boolean))];
  const showFilters = mentors.length > MENTOR_FILTER_THRESHOLD && groups.length > 1;
  filters.hidden = !showFilters;
  if (showFilters) {
    filters.innerHTML = ["All", ...groups]
      .map((g) => `<button type="button" class="chip${g === mentorGroup ? " is-active" : ""}" data-group="${escapeAttr(g)}" aria-pressed="${g === mentorGroup}">${escapeHTML(g)}</button>`)
      .join("");
  } else {
    mentorGroup = "All";
  }

  grid.innerHTML = mentors
    .filter((m) => mentorGroup === "All" || m.group_name === mentorGroup)
    .map((m, i) => coreCardHTML(m, i))
    .join("");
  watchBadgesOnTouch(grid);
}

/* Give a portrait its real photo. Called when someone looks at it. */
function developPortraits(scope) {
  scope.querySelectorAll(".portrait-photo[data-src]").forEach((img) => {
    img.src = img.dataset.src;
    img.removeAttribute("data-src");
  });
}

/* Touch screens have no hover, so a badge develops its photo as it
 * scrolls into view instead, once. */
let badgeObserver = null;
function watchBadgesOnTouch(grid) {
  if (!window.matchMedia("(hover: none)").matches || !("IntersectionObserver" in window)) return;
  if (!badgeObserver) {
    badgeObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        developPortraits(entry.target);
        entry.target.classList.add("is-developed");
        badgeObserver.unobserve(entry.target);
      });
    }, { threshold: 0.6 });
  }
  grid.querySelectorAll("[data-person-card]").forEach((card) => badgeObserver.observe(card));
}

let coreBound = false;
function bindCoreMembers() {
  if (coreBound) return;
  coreBound = true;
  const section = document.getElementById("core");
  const tiltOK = () =>
    matchMedia("(hover: hover)").matches && !matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Hover or focus on a card loads its photo, just before it develops.
  const look = (event) => {
    const card = event.target.closest("[data-person-card]");
    if (card) developPortraits(card);
  };
  section.addEventListener("pointerover", look);
  section.addEventListener("focusin", look);

  // A card tilts toward the cursor, like it's being picked up to read —
  // only where a mouse gives a position and motion is welcome.
  section.addEventListener("pointermove", (event) => {
    if (!tiltOK()) return;
    const card = event.target.closest(".core-card");
    if (!card) return;
    const box = card.getBoundingClientRect();
    const px = (event.clientX - box.left) / box.width - 0.5;
    const py = (event.clientY - box.top) / box.height - 0.5;
    card.style.setProperty("--tx", `${(-py * 9).toFixed(2)}deg`);
    card.style.setProperty("--ty", `${(px * 9).toFixed(2)}deg`);
  });
  section.addEventListener(
    "pointerleave",
    (event) => {
      const card = event.target.closest(".core-card");
      // A move between two elements inside the same card also fires
      // this; only reset once the pointer has actually left the card.
      if (!card || card.contains(event.relatedTarget)) return;
      card.style.removeProperty("--tx");
      card.style.removeProperty("--ty");
    },
    true
  );

  section.addEventListener("click", (event) => {
    const chip = event.target.closest("#core-filters .chip");
    if (!chip) return;
    mentorGroup = chip.dataset.group;
    renderMentors();
  });
}

/* ------------------------------------------------------------------
 * Section 5: Resources
 * ---------------------------------------------------------------- */
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
      setMetaStatus("live", live.title);
      band.dataset.mode = "live";
      titleEl.textContent = live.title;
      if (groupEl) groupEl.textContent = live.group_name || "";
      whenEl.innerHTML = '<span class="live-dot" aria-hidden="true"></span>Happening now';
      countEl.textContent = "";
      return;
    }

    const next = resolveNextSession({ events: allEvents, classSessions: allClassSessions }, now);
    if (!next) {
      setMetaStatus("idle");
      band.dataset.mode = "none";
      titleEl.textContent = "Next session to be announced";
      if (groupEl) groupEl.textContent = "";
      whenEl.textContent = "Watch the rooms below for the next date.";
      countEl.textContent = "";
      return;
    }

    band.dataset.mode = "countdown";
    setMetaStatus("next", next.at);
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

  bindCalendarMenu();
  bindNotify();
  icsBound = true;
}

/* The calendar feed: events.ics, rebuilt by the deploy workflow every 30
 * minutes (tools/events-feed.mjs). Subscribing, rather than importing a
 * file, is what keeps someone's calendar up to date. */
function bindCalendarMenu() {
  const menu = document.getElementById("cal-menu");
  if (!menu) return;
  const feed = new URL("events.ics", location.href.split("#")[0]).href;
  const webcal = feed.replace(/^https?:/, "webcal:");
  menu.querySelector("#cal-google").href = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`;
  menu.querySelector("#cal-webcal").href = webcal;
  const copy = menu.querySelector("#cal-copy");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(feed);
      copy.textContent = "Copied. Paste it into your calendar's “add by URL”.";
    } catch {
      copy.textContent = feed;
    }
  });
  // Close on outside click or Escape, like a menu.
  document.addEventListener("click", (evt) => {
    if (menu.open && !menu.contains(evt.target)) menu.open = false;
  });
  menu.addEventListener("keydown", (evt) => {
    if (evt.key === "Escape") {
      menu.open = false;
      menu.querySelector("summary").focus();
    }
  });
}

/* "Email me updates": one dialog for a single event or all events. The
 * event-mail function sends a confirmation email; nothing else is sent
 * until that link is clicked. */
function bindNotify() {
  const dialog = document.getElementById("notify-dialog");
  if (!dialog || !dialog.showModal) return;
  const form = dialog.querySelector("#notify-form");
  const email = form.querySelector("#notify-email");
  const status = form.querySelector("#notify-status");
  const submit = form.querySelector("#notify-submit");
  let eventId = null;

  document.addEventListener("click", (evt) => {
    const trigger = evt.target.closest("[data-notify]");
    if (!trigger) return;
    const id = trigger.dataset.notify;
    const event = id === "all" ? null : allEvents.find((e) => String(e.id) === id);
    eventId = event ? event.id : null;
    form.querySelector("#notify-what").textContent = event
      ? `Updates about “${event.title}”: changes, links and reminders from the organisers.`
      : "Updates about every FCS event: new sessions, changes and reminders.";
    status.textContent = "";
    status.dataset.tone = "";
    form.hidden = false;
    submit.disabled = false;
    dialog.showModal();
    email.focus();
  });

  form.querySelector("#notify-cancel").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (evt) => {
    if (evt.target === dialog) dialog.close(); // the backdrop
  });

  form.addEventListener("submit", async (evt) => {
    evt.preventDefault();
    const value = email.value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      status.dataset.tone = "error";
      status.textContent = "Enter your email address.";
      email.focus();
      return;
    }
    submit.disabled = true;
    status.dataset.tone = "";
    status.textContent = "Sending…";
    try {
      await eventMail("subscribe", {
        email: value,
        event_id: eventId,
        company: form.querySelector("#notify-company").value,
      });
      status.dataset.tone = "ok";
      status.textContent = `Check ${value} for a confirmation email. Click the link in it to finish.`;
    } catch (err) {
      submit.disabled = false;
      status.dataset.tone = "error";
      status.textContent = err.message || "That did not work. Try again in a minute.";
    }
  });
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
    // "web" and "other" say nothing, so those links use their own name: join --linkedin
    const name = PLATFORM_ICONS.has(String(item.platform)) ? item.platform : item.label || item.platform || "link";
    const flag = escapeHTML(String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
    return `
      <div class="join-card">
        <p class="join-command"><span class="join-prompt" aria-hidden="true">$</span> join --${flag}</p>
        <a class="join-url" href="${url}" target="_blank" rel="noopener">
          ${platformIcon(item.platform, "join-icon", item.url)}
          <span class="join-label">${escapeHTML(item.label)}</span>
          <span class="join-address">${shown}</span>
        </a>
        <p class="join-hint">${escapeHTML(item.hint)}</p>
        <button type="button" class="join-copy" data-copy="${url}" aria-label="Copy the ${escapeAttr(item.label)} link">${icon("copy", "icon-copy")}${icon("check", "icon-check")}<span class="join-copy-text">Copy</span></button>
      </div>
    `;
  }).join("");
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
    const label = button.querySelector(".join-copy-text");
    // Remember what the button said, so a handle comes back, not "Copy".
    if (!label.dataset.idle) label.dataset.idle = label.textContent;
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      label.textContent = "Copied";
    } catch {
      label.textContent = "Press Ctrl+C";
    }
    button.classList.add("is-done");
    clearTimeout(button.resetTimer);
    button.resetTimer = setTimeout(() => {
      label.textContent = label.dataset.idle;
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

/* ------------------------------------------------------------------
 * Footer: the same rooms as icon links, for the reader who reached
 * the end of the page.
 * ---------------------------------------------------------------- */
function renderFooterSocials(links) {
  const list = document.getElementById("footer-socials");
  if (!list) return;
  const items = (Array.isArray(links) ? links : []).filter((item) => item && safeURL(item.url));
  list.innerHTML = items.map((item) => `
    <li>
      <a href="${safeURL(item.url)}" target="_blank" rel="noopener" aria-label="${escapeAttr(item.label || item.platform)}">
        ${platformIcon(item.platform, "", item.url)}
      </a>
    </li>`).join("");
}

/* ------------------------------------------------------------------
 * Nav: glass once the memo header has scrolled out of view. Watched
 * with an observer on the header, so no scroll handler is involved.
 * ---------------------------------------------------------------- */
function setupGlassNav() {
  const nav = document.getElementById("doc-nav");
  const header = document.querySelector(".doc-header");
  if (!nav || !header || !("IntersectionObserver" in window)) return;

  new IntersectionObserver(([entry]) => {
    nav.classList.toggle("is-glass", !entry.isIntersecting);
  }).observe(header);
}

/* ------------------------------------------------------------------
 * Memo header: the four RFC-style columns carry live facts instead of
 * fixed costume. Each slot keeps its HTML fallback until data arrives,
 * so a failed fetch leaves sensible text behind.
 * ---------------------------------------------------------------- */
function metaSlot(name) {
  return document.querySelector(`[data-meta="${name}"]`);
}

/* The newest commit on the most recently pushed repository: its name,
 * the first line of the message (the column truncates it), and how
 * long ago, in the column label. Falls back to the repo and push time
 * if the commit itself cannot be read. */
async function setMetaCommit(repos) {
  const slot = metaSlot("commit");
  const latest = repos
    .filter((repo) => repo.pushed_at)
    .sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at))[0];
  if (!slot || !latest) return;

  const label = slot.parentElement.querySelector(".doc-meta-label");
  const repoLink = `<a href="${safeURL(latest.html_url)}" target="_blank" rel="noopener">${escapeHTML(latest.name)}</a>`;
  slot.innerHTML = repoLink;
  if (label) label.textContent = `Last commit, ${timeAgo(latest.pushed_at)}`;

  try {
    const snapshot = await githubSnapshot();
    const [commit] = snapshot && snapshot.latest_commit_repo === latest.name && snapshot.latest_commit
      ? [snapshot.latest_commit]
      : await githubJSON(
        `/repos/${encodeURIComponent(window.GITHUB_ORG)}/${encodeURIComponent(latest.name)}/commits?per_page=1`
      );
    if (!commit) return;
    const message = String(commit.commit.message || "").split("\n")[0].trim();
    const when = commit.commit.committer && commit.commit.committer.date;
    slot.innerHTML = `${repoLink}: <a href="${safeURL(commit.html_url)}" target="_blank" rel="noopener">${escapeHTML(message)}</a>`;
    slot.title = `${latest.name}: ${message}`;
    if (label && when) label.textContent = `Last commit, ${timeAgo(when)}`;
  } catch (err) {
    console.warn("[FCS] Latest commit could not be read:", err);
  }
}

function setMetaGroups(groups) {
  const slot = metaSlot("groups");
  if (!slot || !Array.isArray(groups) || !groups.length) return;
  const count = (status) => groups.filter((g) => String(g.status).toLowerCase() === status).length;
  const parts = [["active", count("active")], ["forming", count("forming")]]
    .filter(([, n]) => n > 0)
    .map(([label, n]) => `${n} ${label}`);
  slot.textContent = parts.length ? parts.join(", ") : `${groups.length} listed`;
}

/* Called every countdown tick, so it only touches the DOM on change. */
function setMetaStatus(mode, detail) {
  const slot = metaSlot("status");
  if (!slot) return;
  let text = "Active";
  if (mode === "live") text = "Live now";
  else if (mode === "next" && detail instanceof Date) {
    text = "Next " + detail.toLocaleDateString("en-GB", { weekday: "short" }) + " " +
      detail.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
  if (slot.textContent !== text) slot.textContent = text;
  slot.dataset.state = mode;
  slot.title = mode === "live" && detail ? `${detail} is live` : "";
}

/* Discord member and online counts, from the public invite endpoint
 * (no token, CORS-enabled). The invite code comes from the Discord
 * row in social links, so changing the invite in the CMS moves this
 * too. */
async function setMetaDiscord(links) {
  const slot = metaSlot("discord");
  if (!slot) return;
  const discord = (Array.isArray(links) ? links : []).find(
    (item) => String(item && item.platform).toLowerCase() === "discord"
  );
  const match = discord && /(?:discord\.gg|discord(?:app)?\.com\/invite)\/([\w-]+)/i.exec(discord.url || "");
  if (!match) return;

  slot.innerHTML = `<a href="${safeURL(discord.url)}" target="_blank" rel="noopener">Join the server</a>`;
  try {
    const invite = await cachedJSON(`https://discord.com/api/v9/invites/${encodeURIComponent(match[1])}?with_counts=true`);
    const members = invite.approximate_member_count;
    const online = invite.approximate_presence_count;
    if (!Number.isFinite(members)) return;
    slot.innerHTML = `<a href="${safeURL(discord.url)}" target="_blank" rel="noopener">${members} members</a>` +
      (Number.isFinite(online) ? `, <span class="meta-online">${online} online</span>` : "");
  } catch (err) {
    console.warn("[FCS] Discord counts could not be read:", err);
  }
}

/* ------------------------------------------------------------------
 * Deep links: keep the #target in place while the page fills in.
 *
 * On a load or reload with a hash, the browser jumps to the target
 * immediately. Projects, events, groups and members then arrive from
 * GitHub and Supabase and render ABOVE the target, pushing it down, so
 * the reader ends up a section or more too high. Instead of guessing
 * heights, this watches the page and re-aligns the actual element
 * whenever the layout changes, for any id (sections without a nav link,
 * like #core, included). It lets go the moment the reader scrolls,
 * clicks, taps or types, or after a few seconds, so it never fights them.
 * ---------------------------------------------------------------- */
function pinHashTarget() {
  const id = decodeURIComponent(location.hash.slice(1));
  const target = id && document.getElementById(id);
  if (!target || !("ResizeObserver" in window)) return;

  // The browser's own scroll restoration would otherwise put the reader
  // back at the old pixel offset from before the reload.
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  const align = () => target.scrollIntoView({ block: "start", behavior: "instant" });
  const observer = new ResizeObserver(align);
  const stopEvents = ["wheel", "touchstart", "pointerdown", "keydown"];
  const stop = () => {
    observer.disconnect();
    clearTimeout(timer);
    stopEvents.forEach((type) => removeEventListener(type, stop));
  };

  stopEvents.forEach((type) => addEventListener(type, stop, { passive: true }));
  const timer = setTimeout(stop, 6000);
  observer.observe(document.body);
  align();
}

