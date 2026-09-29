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
  PERSON_LINKS,
  avatarURL,
  portraitHTML,
  roleStamp,
  personLinksHTML,
  whoisHTML,
  personFileHTML,
  RESOURCE_KIND_LABELS,
  resourceCardHTML,
  studyGroupCardHTML,
  eventCardHTML,
} from "./render.js";
import {
  getEvents, getClassSessions, getResources,
  getStudyGroups, getSocialLinks, getRepoKinds, getCoreMembers,
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
  renderReferences(socialLinks);
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
    const repos = await githubJSON(
      `/orgs/${encodeURIComponent(window.GITHUB_ORG)}/repos?per_page=100&sort=updated`
    );
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
 * Leads get a full personnel-file card each. Everyone else goes in a
 * roster: one row per person that expands in place into the same card,
 * with a focus-driven preview panel beside it on desktop. One layout
 * from 3 people to 30+; group filters appear past 8. Alumni sit in a
 * collapsed list at the end.
 *
 * No GitHub API calls: avatars are plain image URLs
 * (github.com/<user>.png), which the rate limit does not count.
 * ---------------------------------------------------------------- */
const ROSTER_FILTER_THRESHOLD = 8;
let rosterGroup = "All";
let rosterMembers = [];


function sortMembers(list) {
  return [...list].sort(
    (a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.name).localeCompare(String(b.name))
  );
}


function rosterRowHTML(member, index) {
  const id = `core-row-${index}`;
  const focus = Array.isArray(member.focus) ? member.focus.slice(0, 2).join(", ") : "";
  return `
    <li class="core-row" data-person="${index}">
      <button type="button" class="core-row-head" aria-expanded="false" aria-controls="${id}">
        <span class="core-no">${String(index + 1).padStart(2, "0")}</span>
        ${portraitHTML(member, "portrait-sm")}
        <span class="core-row-name">${escapeHTML(member.name)}</span>
        ${roleStamp(member)}
        <span class="core-row-runs">${escapeHTML(member.group_name || "")}</span>
        <span class="core-row-focus">${escapeHTML(focus)}</span>
        ${icon("chevron-down", "core-chevron")}
      </button>
      <div class="core-row-body" id="${id}">
        <div class="core-row-inner">${personFileHTML(member, { withPortrait: false })}</div>
      </div>
    </li>`;
}

function renderCoreMembers(members) {
  const section = document.getElementById("core");
  if (!section) return;

  const all = sortMembers(Array.isArray(members) ? members : []);
  const active = all.filter((m) => m.status !== "alumni");
  const alumni = all.filter((m) => m.status === "alumni");
  const leads = active.filter((m) => m.role === "lead");
  rosterMembers = active.filter((m) => m.role !== "lead");

  const count = document.getElementById("core-count");
  if (count) count.textContent = active.length ? `${active.length} ${active.length === 1 ? "person" : "people"}` : "";

  const leadsEl = document.getElementById("core-leads");
  leadsEl.innerHTML = leads
    .map((m) => `<article class="core-card" data-person-card>${personFileHTML(m)}</article>`)
    .join("");
  leadsEl.hidden = !leads.length;

  renderRoster();

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
    leadsEl.hidden = false;
    leadsEl.innerHTML = `<p class="empty-note">The core member list is being written. Ask in the rooms below who runs what.</p>`;
  }

  bindCoreMembers();
}

function renderRoster() {
  const wrap = document.getElementById("core-roster-wrap");
  const list = document.getElementById("core-roster");
  const filters = document.getElementById("core-filters");
  if (!wrap || !list) return;

  wrap.hidden = !rosterMembers.length;
  if (!rosterMembers.length) return;

  const groups = [...new Set(rosterMembers.map((m) => m.group_name).filter(Boolean))];
  const showFilters = rosterMembers.length > ROSTER_FILTER_THRESHOLD && groups.length > 1;
  filters.hidden = !showFilters;
  if (showFilters) {
    filters.innerHTML = ["All", ...groups]
      .map((g) => `<button type="button" class="chip${g === rosterGroup ? " is-active" : ""}" data-group="${escapeAttr(g)}" aria-pressed="${g === rosterGroup}">${escapeHTML(g)}</button>`)
      .join("");
  } else {
    rosterGroup = "All";
  }

  const shown = rosterMembers
    .map((m, i) => [m, i])
    .filter(([m]) => rosterGroup === "All" || m.group_name === rosterGroup);
  list.innerHTML = shown.map(([m, i]) => rosterRowHTML(m, i)).join("");
  previewPerson(shown.length ? shown[0][1] : null);
}

/* The preview panel shows whichever row was last hovered or focused. */
function previewPerson(index) {
  const panel = document.getElementById("core-preview");
  if (!panel) return;
  const member = index == null ? null : rosterMembers[index];
  if (!member) {
    panel.innerHTML = "";
    return;
  }
  if (panel.dataset.person === String(index)) return;
  panel.dataset.person = String(index);
  panel.innerHTML = `
    ${portraitHTML(member, "portrait-xl")}
    <p class="core-preview-name">${escapeHTML(member.name)}</p>
    ${member.title ? `<p class="core-preview-title">${escapeHTML(member.title)}</p>` : ""}`;
  developPortraits(panel);

  // Start the scanline wipe only once the photo is there to reveal.
  const portrait = panel.querySelector(".portrait");
  const photo = panel.querySelector(".portrait-photo");
  if (!portrait || !photo) return;
  const develop = () => requestAnimationFrame(() => portrait.classList.add("is-developing"));
  if (photo.complete && photo.naturalWidth) develop();
  else photo.addEventListener("load", develop, { once: true });
}

/* Give a portrait its real photo. Called when someone looks at it. */
function developPortraits(scope) {
  scope.querySelectorAll(".portrait-photo[data-src]").forEach((img) => {
    img.src = img.dataset.src;
    img.removeAttribute("data-src");
  });
}

let coreBound = false;
function bindCoreMembers() {
  if (coreBound) return;
  coreBound = true;
  const section = document.getElementById("core");

  // Hover or focus anywhere on a card or row loads its photo.
  const look = (event) => {
    const target = event.target.closest("[data-person-card], .core-row");
    if (target) developPortraits(target);
    const row = event.target.closest(".core-row");
    if (row) previewPerson(Number(row.dataset.person));
  };
  section.addEventListener("pointerover", look);
  section.addEventListener("focusin", look);

  section.addEventListener("click", (event) => {
    const chip = event.target.closest("#core-filters .chip");
    if (chip) {
      rosterGroup = chip.dataset.group;
      renderRoster();
      return;
    }

    const head = event.target.closest(".core-row-head");
    if (!head) return;
    const open = head.getAttribute("aria-expanded") !== "true";
    // One open at a time keeps a long roster short.
    section.querySelectorAll('.core-row-head[aria-expanded="true"]').forEach((other) => {
      if (other !== head) other.setAttribute("aria-expanded", "false");
    });
    head.setAttribute("aria-expanded", String(open));
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
          ${platformIcon(item.platform, "join-icon")}
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
 * Section 11 — References
 * ---------------------------------------------------------------- */
function renderReferences(links) {
  renderFooterSocials(links);
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
        ${platformIcon(item.platform)}
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
    const [commit] = await githubJSON(
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

