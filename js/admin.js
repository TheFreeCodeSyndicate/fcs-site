/*
 * js/admin.js
 * ------------------------------------------------------------------
 * The admin panel. A sidebar of pages, one per kind of content, each
 * at its own URL (#/core, #/events, ...). Lists open a slide-over
 * drawer to edit; the drawer shows a live preview built by the same
 * render functions as the public page (js/render.js).
 *
 * Every write goes through a named function in js/supabase.js, which
 * treats an RLS refusal (zero rows changed) as an error.
 * ------------------------------------------------------------------
 */

import {
  isConfigured,
  getClientOrThrow,
  getSession,
  getRole,
  signIn,
  signOut,
  createEvent, updateEvent, deleteEvent,
  createClassSession, updateClassSession, deleteClassSession,
  createResource, updateResource, deleteResource,
  createStudyGroup, updateStudyGroup, deleteStudyGroup,
  createSocialLink, updateSocialLink, deleteSocialLink,
  createCoreMember, updateCoreMember, deleteCoreMember,
  saveRepoKind, deleteRepoKind,
  listProfiles, setProfileRole,
} from "./supabase.js";
import { nextOccurrence } from "./lib/schedule.js";
import { deriveEventState } from "./lib/derive.js";
import { toLocalInputValue, fromLocalInputValue, formatDateTimeLocal } from "./lib/forms.js";
import {
  escapeHTML, escapeAttr, safeURL, icon,
  personFileHTML, portraitHTML, roleStamp,
  resourceCardHTML, studyGroupCardHTML, eventCardHTML,
} from "./render.js";

const STAGES = ["draft", "scheduled", "live", "done"];
const WEEKDAYS = (window.FCS_CONFIG && window.FCS_CONFIG.weekdays) || [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

const state = {
  user: null,
  role: null,
  route: "events",
  data: {},          // table name -> rows
  profiles: [],
  search: "",
  filters: {},       // editor id -> { key: value }
};

const root = () => document.getElementById("admin-root");

/* ==================================================================
 * Small helpers
 * ================================================================== */

function toast(message, tone) {
  const el = document.getElementById("admin-toast");
  if (!el) return;
  el.textContent = message;
  el.dataset.tone = tone === "error" ? "error" : "ok";
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    el.hidden = true;
  }, 3600);
}

async function readTable(name, order = "sort_order") {
  const { data, error } = await getClientOrThrow().from(name).select("*").order(order);
  if (error) throw error;
  return data || [];
}

const isAdmin = () => state.role === "admin";
const deleteDisabled = () => (isAdmin() ? "" : ' disabled title="Only admins can delete"');

/* Arm-then-confirm delete: the first click arms the button for three
 * seconds, the second click deletes. No browser confirm() dialog. */
function armedDelete(button, run) {
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    if (button.dataset.armed !== "true") {
      button.dataset.armed = "true";
      button.querySelector("span").textContent = "Click again to delete";
      clearTimeout(button.disarm);
      button.disarm = setTimeout(() => {
        button.dataset.armed = "false";
        button.querySelector("span").textContent = "Delete";
      }, 3000);
      return;
    }
    clearTimeout(button.disarm);
    button.disabled = true;
    try {
      await run();
    } finally {
      button.disabled = false;
      button.dataset.armed = "false";
    }
  });
}

/* ==================================================================
 * Boot and sign-in
 * ================================================================== */

document.addEventListener("DOMContentLoaded", boot);

async function boot() {
  document.getElementById("admin-signout").addEventListener("click", () =>
    signOut().then(() => location.reload())
  );
  bindDrawer();

  if (!isConfigured()) {
    root().innerHTML = `
      <div class="admin-login">
        <h1>Admin panel</h1>
        <p>Supabase is not configured yet. Set <code>supabaseUrl</code> and
           <code>supabaseAnonKey</code> in <code>js/config.js</code>, then reload.</p>
      </div>`;
    return;
  }

  let session = null;
  try {
    session = await getSession();
  } catch (err) {
    root().innerHTML = `
      <div class="admin-login">
        <h1>Cannot reach the database</h1>
        <p>${escapeHTML(err.message || "Unknown error")}</p>
        <p>The public site is unaffected and still works from its seed data.</p>
      </div>`;
    return;
  }

  if (!session) return renderLogin();
  await onSignedIn(session.user);
}

function renderLogin() {
  root().innerHTML = `
    <form class="admin-login" id="login-form">
      <h1>Admin panel</h1>
      <label>Email
        <input type="email" id="login-email" autocomplete="username" required />
      </label>
      <label>Password
        <input type="password" id="login-password" autocomplete="current-password" required />
      </label>
      <p class="admin-error" id="login-error" role="alert"></p>
      <button type="submit" class="btn btn-primary">Sign in</button>
    </form>`;

  root().querySelector("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorEl = root().querySelector("#login-error");
    errorEl.textContent = "";
    try {
      const user = await signIn(
        root().querySelector("#login-email").value.trim(),
        root().querySelector("#login-password").value
      );
      await onSignedIn(user);
    } catch (err) {
      errorEl.textContent = err.message || "Sign in failed.";
    }
  });
}

function noAccess(title, body) {
  root().innerHTML = `
    <div class="admin-login">
      <h1>${title}</h1>
      ${body}
      <button type="button" class="btn" id="back-to-login">Back to sign in</button>
    </div>`;
  root().querySelector("#back-to-login").addEventListener("click", renderLogin);
}

async function onSignedIn(user) {
  const role = await getRole(user.id);

  // A real sign-out in both cases, so a reload lands on the login form
  // rather than a half-authenticated dead end.
  if (!role || role === "pending") {
    await signOut().catch(() => {});
    if (role === "pending") {
      noAccess("Waiting for approval", `
        <p>Your account exists, but an admin has not approved it yet.</p>
        <p>Ask an admin to open <strong>Team</strong> in this panel and approve
           <code>${escapeHTML(user.email)}</code>. You have been signed out.</p>`);
    } else {
      noAccess("No access", `
        <p>Your account has no profile, so it has no role. You have been signed out.</p>`);
    }
    return;
  }

  state.user = user;
  state.role = role;
  document.getElementById("admin-identity").textContent = `${user.email} · ${role}`;
  document.getElementById("admin-signout").hidden = false;

  root().innerHTML = `<p class="empty-note">Loading content&hellip;</p>`;
  try {
    await loadAll();
  } catch (err) {
    root().innerHTML = `
      <div class="admin-login">
        <h1>Could not load your content</h1>
        <p>${escapeHTML(err.message || "Unknown error")}</p>
        <button type="button" class="btn" id="retry">Retry</button>
      </div>`;
    root().querySelector("#retry").addEventListener("click", () => location.reload());
    return;
  }

  renderSidebar();
  window.addEventListener("hashchange", onHashChange);
  bindShortcuts();
  go(routeFromHash());
}

const TABLES = [
  ["events", "starts_at"],
  ["class_sessions", "sort_order"],
  ["resources", "sort_order"],
  ["study_groups", "sort_order"],
  ["social_links", "sort_order"],
  ["repo_kinds", "repo_name"],
  ["core_members", "sort_order"],
];

async function loadAll() {
  const results = await Promise.all(TABLES.map(([name, order]) => readTable(name, order)));
  TABLES.forEach(([name], i) => {
    state.data[name] = results[i];
  });
  if (isAdmin()) state.profiles = await listProfiles();
}

async function reload(table) {
  const order = (TABLES.find(([name]) => name === table) || [])[1];
  state.data[table] = await readTable(table, order);
}

/* ==================================================================
 * Routing and sidebar
 * ================================================================== */

const PAGES = [
  { id: "events", label: "Events", icon: "calendar", site: "#events" },
  { id: "schedule", label: "Class schedule", icon: "clock", site: "#events" },
  { id: "core", label: "Core members", icon: "users", site: "#core" },
  { id: "groups", label: "Study groups", icon: "book-open", site: "#study-groups" },
  { id: "resources", label: "Resources", icon: "bookmark", site: "#resources" },
  { id: "social", label: "Social links", icon: "link", site: "#join" },
  { id: "repos", label: "Repo curation", icon: "github", site: "#projects" },
  { id: "team", label: "Team", icon: "shield", adminOnly: true },
];

const visiblePages = () => PAGES.filter((p) => !p.adminOnly || isAdmin());

function routeFromHash() {
  const id = location.hash.replace(/^#\/?/, "");
  return visiblePages().some((p) => p.id === id) ? id : "events";
}

function onHashChange() {
  const next = routeFromHash();
  if (next === state.route) return;
  // Leaving a page with unsaved edits: stay, and ask in the drawer.
  if (drawer.open && drawer.dirty) {
    history.replaceState(null, "", `#/${state.route}`);
    showDiscardConfirm(() => go(next));
    return;
  }
  closeDrawer(true);
  go(next);
}

function go(id) {
  state.route = id;
  state.search = "";
  if (location.hash !== `#/${id}`) history.replaceState(null, "", `#/${id}`);
  document.querySelectorAll(".sidebar-link").forEach((link) => {
    const current = link.dataset.page === id;
    link.classList.toggle("is-active", current);
    if (current) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  renderPage();
  const heading = root().querySelector("h1");
  if (heading) heading.focus({ preventScroll: true });
}

function pageCount(id) {
  const editor = EDITORS[id];
  if (id === "events") return state.data.events.length;
  if (id === "team") return state.profiles.filter((p) => p.role === "pending").length || "";
  return editor ? state.data[editor.table].length : "";
}

function renderSidebar() {
  const nav = document.getElementById("admin-sidebar");
  nav.hidden = false;
  nav.innerHTML = `<ul>${visiblePages().map((p) => {
    const count = pageCount(p.id);
    const alert = p.id === "team" && count ? " has-alert" : "";
    return `
      <li>
        <a class="sidebar-link${alert}" href="#/${p.id}" data-page="${p.id}">
          ${icon(p.icon)}
          <span>${p.label}</span>
          ${count !== "" ? `<span class="sidebar-count">${count}</span>` : ""}
        </a>
      </li>`;
  }).join("")}</ul>`;
}

function renderPage() {
  const page = PAGES.find((p) => p.id === state.route);
  if (state.route === "events") renderEventsPage(page);
  else if (state.route === "team") renderTeamPage(page);
  else renderListPage(page);
}

function pageHead(page, { count, newLabel, search = true } = {}) {
  return `
    <div class="page-head">
      <h1 tabindex="-1">${escapeHTML(page.label)}${count != null ? ` <span class="page-count">${count}</span>` : ""}</h1>
      <div class="page-actions">
        ${search ? `
          <label class="page-search">
            ${icon("search")}
            <span class="visually-hidden">Search ${escapeHTML(page.label)}</span>
            <input type="search" id="page-search" placeholder="Search  /" value="${escapeAttr(state.search)}" autocomplete="off" />
          </label>` : ""}
        ${page.site ? `<a class="btn btn-quiet" href="./${page.site}" target="_blank" rel="noopener">${icon("eye")}<span>View on site</span></a>` : ""}
        ${newLabel ? `<button type="button" class="btn btn-primary" id="page-new">${icon("plus")}<span>${escapeHTML(newLabel)}</span></button>` : ""}
      </div>
    </div>`;
}

function bindShortcuts() {
  document.addEventListener("keydown", (event) => {
    if (drawer.open || event.ctrlKey || event.metaKey || event.altKey) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (typing) return;
    if (event.key === "/") {
      const search = document.getElementById("page-search");
      if (search) {
        event.preventDefault();
        search.focus();
      }
    } else if (event.key === "n") {
      const button = document.getElementById("page-new");
      if (button) {
        event.preventDefault();
        button.click();
      }
    }
  });
}

/* ==================================================================
 * Field schemas
 * ================================================================== */

const URL_RE = /^https?:\/\/\S+$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const groupNames = () => state.data.study_groups.map((g) => g.name);

/* Editors for every list page. Each names its table, how a row is
 * summarised, its fields, an optional preview, and the named writes. */
const EDITORS = {
  schedule: {
    table: "class_sessions",
    noun: "session",
    intro: "A recurring weekly session. The public countdown and week strip pick up the next occurrence automatically.",
    title: (r) => r.title,
    subtitle: (r) => {
      const next = nextOccurrence(r, new Date());
      return `${WEEKDAYS[r.weekday] || "?"} ${String(r.start_time || "").slice(0, 5)}, next ${next ? formatDateTimeLocal(next.toISOString()) : "not scheduled (inactive)"}`;
    },
    badges: (r) => (r.is_active === false ? ['<span class="badge">Inactive</span>'] : []),
    fields: [
      { name: "title", label: "Title", type: "text", required: true },
      { name: "group_name", label: "Group", type: "text", list: groupNames },
      { name: "weekday", label: "Weekday", type: "weekday" },
      { name: "start_time", label: "Start time", type: "time", required: true },
      { name: "duration_minutes", label: "Duration (minutes)", type: "number", min: 5, step: 5, placeholder: "60" },
      { name: "link", label: "Room link", type: "url", wide: true },
      { name: "is_active", label: "Active (shown on the site)", type: "checkbox", fallback: true },
    ],
    normalise: (v) => ({
      ...v,
      start_time: v.start_time ? String(v.start_time).slice(0, 5) : null,
      duration_minutes: v.duration_minutes || 60,
    }),
    sortable: true,
    create: createClassSession,
    update: updateClassSession,
    remove: deleteClassSession,
  },

  core: {
    table: "core_members",
    noun: "member",
    intro: "Leads show as full cards; everyone else in the roster. Only the links you fill in appear on the site.",
    title: (r) => r.name,
    subtitle: (r) => [r.title, r.group_name, r.github_username && `@${r.github_username}`].filter(Boolean).join(", "),
    thumb: (r) => portraitHTML(r, "portrait-sm"),
    badges: (r) => [
      roleStamp(r),
      r.status === "alumni" ? '<span class="badge">Alumni</span>' : "",
      r.is_published === false ? '<span class="badge">Hidden</span>' : "",
    ],
    filters: [
      { key: "role", label: "Role", options: [["all", "All"], ["lead", "Leads"], ["mentor", "Mentors"]], initial: "all" },
      { key: "status", label: "Status", options: [["active", "Active"], ["alumni", "Alumni"], ["all", "All"]], initial: "active" },
    ],
    searchIn: (r) => [r.name, r.title, r.group_name, r.github_username, ...(r.focus || [])],
    sections: [
      ["Who", ["name", "role", "title", "status", "group_name", "focus", "bio", "joined_on", "ended_on"]],
      ["Photo", ["github_username", "photo_url"]],
      ["Links (only filled ones are shown)", ["linkedin_url", "instagram_url", "x_url", "website_url", "email", "discord_handle"]],
      ["Visibility", ["is_published"]],
    ],
    fields: [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "role", label: "Role", type: "select", options: [["lead", "Lead"], ["mentor", "Mentor"]] },
      { name: "title", label: "Title", type: "text", placeholder: "Events lead", help: "Optional, shown under the name." },
      { name: "status", label: "Status", type: "select", options: [["active", "Active"], ["alumni", "Alumni"]] },
      { name: "group_name", label: "Runs", type: "text", list: groupNames, help: "The study group or room they run." },
      { name: "focus", label: "Focus", type: "tags", max: 4, placeholder: "graphics, web", help: "Up to 4, separated by commas." },
      { name: "bio", label: "Bio", type: "textarea", max: 280, wide: true, help: "Written for the club. Up to 280 characters." },
      { name: "joined_on", label: "Joined", type: "date" },
      { name: "ended_on", label: "Left", type: "date", help: "Set when someone moves to alumni." },
      { name: "github_username", label: "GitHub username", type: "text", placeholder: "octocat", help: "Their GitHub avatar becomes the portrait." },
      { name: "photo_url", label: "Photo URL", type: "url", help: "Optional. Overrides the GitHub photo on hover." },
      { name: "linkedin_url", label: "LinkedIn", type: "url" },
      { name: "instagram_url", label: "Instagram", type: "url" },
      { name: "x_url", label: "X", type: "url" },
      { name: "website_url", label: "Website", type: "url" },
      { name: "email", label: "Email", type: "email" },
      { name: "discord_handle", label: "Discord handle", type: "text", help: "Shown as a copy button." },
      { name: "is_published", label: "Show on the site", type: "checkbox", fallback: true },
    ],
    normalise: (v) => ({
      ...v,
      github_username: v.github_username ? v.github_username.replace(/^@/, "") : null,
    }),
    validate: (v, row) => {
      const errors = {};
      const handle = String(v.github_username || "").replace(/^@/, "").toLowerCase();
      const taken = handle && state.data.core_members.some(
        (m) => m.id !== (row && row.id) && String(m.github_username || "").toLowerCase() === handle
      );
      if (taken) errors.github_username = "Someone already has this GitHub username.";
      if (v.status === "alumni" && !v.ended_on) errors.ended_on = "Set when they left, so the alumni list shows their years.";
      return errors;
    },
    preview: (v) => `<article class="core-card" data-person-card>${personFileHTML(v)}</article>`,
    actions: (row) => row && [
      row.status === "alumni"
        ? { label: "Restore to active", icon: "undo", patch: { status: "active", ended_on: null } }
        : { label: "Move to alumni", icon: "archive", patch: { status: "alumni", ended_on: new Date().toISOString().slice(0, 10) } },
    ],
    sortable: true,
    create: createCoreMember,
    update: updateCoreMember,
    remove: deleteCoreMember,
  },

  groups: {
    table: "study_groups",
    noun: "group",
    title: (r) => r.name,
    subtitle: (r) => r.topic,
    badges: (r) => [`<span class="badge">${escapeHTML(r.status)}</span>`, r.is_published === false ? '<span class="badge">Hidden</span>' : ""],
    fields: [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "status", label: "Status", type: "select", options: ["Active", "Forming", "Paused", "Completed"].map((s) => [s, s]) },
      { name: "topic", label: "Topic", type: "textarea", required: true, wide: true },
      { name: "link_text", label: "Link label", type: "text", placeholder: "Join the room" },
      { name: "link", label: "Link", type: "url" },
      { name: "is_published", label: "Show on the site", type: "checkbox", fallback: true },
    ],
    preview: (v) => `<div class="study-group-grid">${studyGroupCardHTML(v)}</div>`,
    sortable: true,
    create: createStudyGroup,
    update: updateStudyGroup,
    remove: deleteStudyGroup,
  },

  resources: {
    table: "resources",
    noun: "resource",
    title: (r) => r.title,
    subtitle: (r) => `${r.kind}, ${r.url}`,
    badges: (r) => [r.is_published === false ? '<span class="badge">Hidden</span>' : ""],
    fields: [
      { name: "title", label: "Title", type: "text", required: true },
      { name: "kind", label: "Kind", type: "select", options: ["notes", "video", "paper", "course", "tool", "book"].map((k) => [k, k]) },
      { name: "url", label: "URL", type: "url", required: true, wide: true },
      { name: "summary", label: "Summary", type: "textarea", wide: true },
      { name: "group_name", label: "Group", type: "text", list: groupNames },
      { name: "is_published", label: "Show on the site", type: "checkbox", fallback: true },
    ],
    preview: (v) => `<div class="resource-grid">${resourceCardHTML(v) || '<p class="empty-note">Add a URL to see the card.</p>'}</div>`,
    sortable: true,
    create: createResource,
    update: updateResource,
    remove: deleteResource,
  },

  social: {
    table: "social_links",
    noun: "link",
    title: (r) => r.label,
    subtitle: (r) => r.url,
    thumb: (r) => icon(["discord", "instagram", "whatsapp", "github", "x"].includes(r.platform) ? r.platform : "link"),
    badges: (r) => [r.is_published === false ? '<span class="badge">Hidden</span>' : ""],
    fields: [
      { name: "platform", label: "Platform", type: "select", options: ["discord", "instagram", "whatsapp", "github", "x", "web"].map((p) => [p, p]) },
      { name: "label", label: "Label", type: "text", required: true },
      { name: "url", label: "URL", type: "url", required: true, wide: true, help: "For Discord, the header's member count reads this invite." },
      { name: "hint", label: "Hint", type: "text", wide: true },
      { name: "is_published", label: "Show on the site", type: "checkbox", fallback: true },
    ],
    sortable: true,
    create: createSocialLink,
    update: updateSocialLink,
    remove: deleteSocialLink,
  },

  repos: {
    table: "repo_kinds",
    noun: "curation",
    key: "repo_name",
    intro: "Move a GitHub repository between Projects and Resources. A repo not listed here is a Project, so a newly pushed repo needs no entry.",
    title: (r) => r.repo_name,
    subtitle: (r) => r.note || "",
    badges: (r) => [`<span class="badge">${escapeHTML(r.kind)}</span>`],
    fields: [
      { name: "repo_name", label: "Repository name", type: "text", required: true, lockOnEdit: true, help: "Exactly as on GitHub." },
      { name: "kind", label: "Show under", type: "select", options: [["project", "Projects"], ["resource", "Resources"]] },
      { name: "note", label: "Note", type: "text", wide: true },
    ],
    create: ({ repo_name, ...rest }) => saveRepoKind(repo_name, rest),
    update: (key, { repo_name, ...rest }) => saveRepoKind(key, rest),
    remove: deleteRepoKind,
  },
};

const EVENT_FIELDS = [
  { name: "title", label: "Title", type: "text", required: true },
  { name: "group_name", label: "Group", type: "text", list: groupNames },
  { name: "starts_at", label: "Starts at", type: "datetime", required: true },
  { name: "duration_minutes", label: "Duration (minutes)", type: "number", min: 5, step: 5, placeholder: "60" },
  { name: "stage", label: "Stage", type: "select", options: STAGES.map((s) => [s, s]), help: "The keyboard alternative to dragging the card." },
  { name: "link_text", label: "Link label", type: "text" },
  { name: "link", label: "Link", type: "url", wide: true },
  { name: "details", label: "Details", type: "textarea", wide: true },
];

/* ==================================================================
 * Form rendering, reading and validation
 * ================================================================== */

let fieldSeq = 0;

function fieldHTML(field, value, { editing } = {}) {
  const id = `f-${field.name}-${++fieldSeq}`;
  const help = field.help ? `<span class="field-help" id="${id}-help">${escapeHTML(field.help)}</span>` : "";
  const error = `<span class="field-error" id="${id}-error" data-error-for="${field.name}" hidden></span>`;
  const described = `aria-describedby="${field.help ? `${id}-help ` : ""}${id}-error"`;
  const wide = field.wide || field.type === "textarea" ? " field-wide" : "";
  const req = field.required ? " required" : "";

  if (field.type === "checkbox") {
    const checked = value == null ? field.fallback !== false : value !== false;
    return `<label class="checkbox-row field-wide"><input type="checkbox" name="${field.name}"${checked ? " checked" : ""} /> ${escapeHTML(field.label)}</label>`;
  }

  let control;
  if (field.type === "select" || field.type === "weekday") {
    const options = field.type === "weekday" ? WEEKDAYS.map((d, i) => [String(i), d]) : field.options;
    const selected = value == null ? options[0][0] : String(value);
    control = `<select id="${id}" name="${field.name}" ${described}>${options
      .map(([v, label]) => `<option value="${escapeAttr(v)}"${v === selected ? " selected" : ""}>${escapeHTML(label)}</option>`)
      .join("")}</select>`;
  } else if (field.type === "textarea") {
    const text = value == null ? "" : String(value);
    control = `<textarea id="${id}" name="${field.name}" rows="4" ${described}${req}${field.max ? ` data-max="${field.max}"` : ""}>${escapeHTML(text)}</textarea>`;
    if (field.max) control += `<span class="field-counter" data-counter-for="${field.name}">${text.length} / ${field.max}</span>`;
  } else {
    const type = { datetime: "datetime-local", tags: "text" }[field.type] || field.type;
    let shown = value;
    if (field.type === "datetime") shown = toLocalInputValue(value);
    if (field.type === "tags") shown = Array.isArray(value) ? value.join(", ") : "";
    const listId = field.list ? `${id}-list` : "";
    const extra = [
      field.min != null ? `min="${field.min}"` : "",
      field.step != null ? `step="${field.step}"` : "",
      field.placeholder ? `placeholder="${escapeAttr(field.placeholder)}"` : "",
      listId ? `list="${listId}"` : "",
      field.lockOnEdit && editing ? "readonly" : "",
    ].join(" ");
    control = `<input id="${id}" name="${field.name}" type="${type}" value="${escapeAttr(shown == null ? "" : shown)}" ${extra} ${described}${req} />`;
    if (listId) control += `<datalist id="${listId}">${field.list().map((o) => `<option value="${escapeAttr(o)}"></option>`).join("")}</datalist>`;
  }

  return `<div class="field${wide}"><label for="${id}">${escapeHTML(field.label)}${field.required ? ' <span aria-hidden="true">*</span>' : ""}</label>${control}${help}${error}</div>`;
}

function formHTML(fields, row, sections, editing) {
  const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
  const render = (names) => names.map((n) => fieldHTML(byName[n], row ? row[n] : undefined, { editing })).join("");
  if (!sections) return `<div class="form-grid">${render(fields.map((f) => f.name))}</div>`;
  return sections
    .map(([title, names]) => `<fieldset class="form-section"><legend>${escapeHTML(title)}</legend><div class="form-grid">${render(names)}</div></fieldset>`)
    .join("");
}

function readForm(form, fields) {
  const out = {};
  for (const field of fields) {
    const el = form.elements[field.name];
    if (!el) continue;
    if (field.type === "checkbox") {
      out[field.name] = el.checked;
      continue;
    }
    const raw = String(el.value || "").trim();
    if (field.type === "tags") out[field.name] = raw ? raw.split(",").map((t) => t.trim()).filter(Boolean) : [];
    else if (field.type === "number") out[field.name] = raw === "" ? null : Number(raw);
    else if (field.type === "weekday") out[field.name] = Number(raw);
    else if (field.type === "datetime") out[field.name] = fromLocalInputValue(raw);
    else out[field.name] = raw === "" ? null : raw;
  }
  return out;
}

function validate(values, fields) {
  const errors = {};
  for (const field of fields) {
    const v = values[field.name];
    if (field.required && (v == null || v === "")) errors[field.name] = `${field.label} is required.`;
    else if (v && field.type === "url" && !URL_RE.test(v)) errors[field.name] = "Use a full link starting with https://";
    else if (v && field.type === "email" && !EMAIL_RE.test(v)) errors[field.name] = "That does not look like an email address.";
    else if (field.max && field.type === "textarea" && v && v.length > field.max) errors[field.name] = `Keep it to ${field.max} characters (now ${v.length}).`;
    else if (field.max && field.type === "tags" && v.length > field.max) errors[field.name] = `Up to ${field.max} tags.`;
    else if (field.type === "datetime" && field.required && !v) errors[field.name] = "Pick a date and time.";
  }
  return errors;
}

/* Postgres errors that name a column become field errors. */
function errorsFromServer(err) {
  const text = `${err.message || ""} ${err.details || ""}`;
  if (err.code === "23505") {
    const col = /\((\w+)\)=/.exec(text);
    return col ? { [col[1]]: "This value is already used by another row." } : null;
  }
  if (err.code === "23514") {
    const col = /_(\w+?)_check/.exec(text);
    return col ? { [col[1]]: "This value is not allowed here." } : null;
  }
  return null;
}

function showErrors(form, errors) {
  form.querySelectorAll("[data-error-for]").forEach((el) => {
    const message = errors[el.dataset.errorFor];
    el.hidden = !message;
    el.textContent = message || "";
    const input = form.elements[el.dataset.errorFor];
    if (input && input.setAttribute) input.setAttribute("aria-invalid", message ? "true" : "false");
  });
  const first = Object.keys(errors)[0];
  if (first && form.elements[first] && form.elements[first].focus) form.elements[first].focus();
}

/* ==================================================================
 * The drawer
 * ================================================================== */

const drawer = { open: false, dirty: false, lastFocus: null, onPreview: null };

function bindDrawer() {
  const el = document.getElementById("drawer");
  document.getElementById("drawer-backdrop").addEventListener("click", () => closeDrawer());
  el.querySelector("[data-drawer-close]").addEventListener("click", () => closeDrawer());
  el.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDrawer();
    } else if (event.key === "Tab") {
      // Keep focus inside the open drawer.
      const focusable = [...el.querySelectorAll("a[href], button:not([disabled]), input:not([type=hidden]), select, textarea")]
        .filter((n) => n.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
}

/*
 * opts: { title, fields, sections, row, preview(values), onSave(values),
 *         onDelete(), actions: [{label, icon, run}], defaults, validate }
 */
function openDrawer(opts) {
  const el = document.getElementById("drawer");
  drawer.lastFocus = document.activeElement;
  drawer.dirty = false;
  drawer.open = true;

  el.querySelector("#drawer-title").textContent = opts.title;
  const form = el.querySelector("#drawer-form");
  form.innerHTML = formHTML(opts.fields, opts.row || opts.defaults, opts.sections, Boolean(opts.row));
  el.querySelector("#drawer-confirm").hidden = true;

  const previewWrap = el.querySelector(".drawer-preview");
  const slot = el.querySelector("#drawer-preview-slot");
  previewWrap.hidden = !opts.preview;
  const refreshPreview = () => {
    if (!opts.preview) return;
    const values = { ...(opts.row || opts.defaults || {}), ...readForm(form, opts.fields) };
    slot.innerHTML = opts.preview(values);
    // The preview shows the photo developed, as it looks on hover.
    slot.querySelectorAll(".portrait-photo[data-src]").forEach((img) => {
      img.src = img.dataset.src;
    });
  };
  refreshPreview();

  form.oninput = (event) => {
    drawer.dirty = true;
    const counter = form.querySelector(`[data-counter-for="${event.target.name}"]`);
    if (counter) {
      const max = Number(event.target.dataset.max);
      counter.textContent = `${event.target.value.length} / ${max}`;
      counter.classList.toggle("is-over", event.target.value.length > max);
    }
    cancelAnimationFrame(drawer.frame);
    drawer.frame = requestAnimationFrame(refreshPreview);
  };

  const footer = el.querySelector("#drawer-actions");
  footer.innerHTML = `
    <button type="submit" form="drawer-form" class="btn btn-primary">${icon("check")}<span>${opts.row ? "Save changes" : "Create"}</span></button>
    ${(opts.actions || []).map((a, i) => `<button type="button" class="btn" data-action="${i}">${icon(a.icon)}<span>${escapeHTML(a.label)}</span></button>`).join("")}
    ${opts.onDelete ? `<button type="button" class="btn btn-danger" id="drawer-delete"${deleteDisabled()}>${icon("trash")}<span>Delete</span></button>` : ""}`;

  (opts.actions || []).forEach((action, i) => {
    footer.querySelector(`[data-action="${i}"]`).addEventListener("click", () => action.run());
  });
  const del = footer.querySelector("#drawer-delete");
  if (del) armedDelete(del, opts.onDelete);

  form.onsubmit = async (event) => {
    event.preventDefault();
    const values = readForm(form, opts.fields);
    const errors = { ...validate(values, opts.fields), ...(opts.validate ? opts.validate(values, opts.row) : {}) };
    showErrors(form, errors);
    if (Object.keys(errors).length) {
      toast("Fix the highlighted fields.", "error");
      return;
    }
    const submit = footer.querySelector("[type=submit]");
    submit.disabled = true;
    try {
      await opts.onSave(values);
      closeDrawer(true);
    } catch (err) {
      const fieldErrors = errorsFromServer(err);
      if (fieldErrors) showErrors(form, fieldErrors);
      toast(err.message || "Could not save.", "error");
    } finally {
      submit.disabled = false;
    }
  };

  document.getElementById("drawer-backdrop").hidden = false;
  el.hidden = false;
  requestAnimationFrame(() => {
    el.classList.add("is-open");
    const first = form.querySelector("input:not([readonly]):not([type=checkbox]), select, textarea");
    if (first) first.focus();
  });
}

function showDiscardConfirm(then) {
  const bar = document.getElementById("drawer-confirm");
  bar.hidden = false;
  bar.querySelector("[data-discard]").onclick = () => {
    closeDrawer(true);
    if (then) then();
  };
  bar.querySelector("[data-keep]").onclick = () => {
    bar.hidden = true;
    document.querySelector("#drawer-form input, #drawer-form select, #drawer-form textarea").focus();
  };
  bar.querySelector("[data-keep]").focus();
}

function closeDrawer(force = false) {
  if (!drawer.open) return;
  if (drawer.dirty && !force) {
    showDiscardConfirm();
    return;
  }
  const el = document.getElementById("drawer");
  drawer.open = false;
  drawer.dirty = false;
  el.classList.remove("is-open");
  document.getElementById("drawer-backdrop").hidden = true;
  const finish = () => {
    if (!drawer.open) el.hidden = true;
  };
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) finish();
  else setTimeout(finish, 260);
  if (drawer.lastFocus && document.contains(drawer.lastFocus)) drawer.lastFocus.focus();
}

/* ==================================================================
 * List pages
 * ================================================================== */

const rowKey = (editor, row) => row[editor.key || "id"];

function filtersFor(id) {
  const editor = EDITORS[id];
  if (!state.filters[id]) {
    state.filters[id] = Object.fromEntries((editor.filters || []).map((f) => [f.key, f.initial]));
  }
  return state.filters[id];
}

function visibleRows(id) {
  const editor = EDITORS[id];
  const filters = filtersFor(id);
  const q = state.search.toLowerCase();
  return state.data[editor.table].filter((row) => {
    for (const [key, value] of Object.entries(filters)) {
      if (value !== "all" && row[key] !== value) return false;
    }
    if (!q) return true;
    const hay = (editor.searchIn ? editor.searchIn(row) : [editor.title(row), editor.subtitle(row)])
      .filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  });
}

function renderListPage(page) {
  const editor = EDITORS[page.id];
  const rows = visibleRows(page.id);
  const total = state.data[editor.table].length;
  const filters = filtersFor(page.id);
  const narrowed = rows.length !== total;

  root().innerHTML = `
    ${pageHead(page, { count: total, newLabel: `New ${editor.noun}` })}
    ${editor.intro ? `<p class="page-intro">${escapeHTML(editor.intro)}</p>` : ""}
    ${(editor.filters || []).map((f) => `
      <div class="page-filters" role="group" aria-label="${escapeAttr(f.label)}">
        ${f.options.map(([value, label]) => `
          <button type="button" class="chip${filters[f.key] === value ? " is-active" : ""}" aria-pressed="${filters[f.key] === value}"
                  data-filter="${f.key}" data-value="${value}">${escapeHTML(label)}</button>`).join("")}
      </div>`).join("")}
    ${rows.length ? `
      <ol class="list" id="list">
        ${rows.map((row, i) => listRowHTML(editor, row, i, rows.length)).join("")}
      </ol>
      ${narrowed ? `<p class="page-note">Showing ${rows.length} of ${total}.</p>` : ""}`
    : total
      ? `<div class="empty-state"><p>Nothing matches. Clear the search or filters.</p></div>`
      : `<div class="empty-state">
           <p>No ${escapeHTML(editor.noun)}s yet.</p>
           <button type="button" class="btn btn-primary" data-empty-new>${icon("plus")}<span>Add the first ${escapeHTML(editor.noun)}</span></button>
         </div>`}`;

  const openNew = () => openEditor(page.id, null);
  root().querySelector("#page-new").addEventListener("click", openNew);
  const emptyNew = root().querySelector("[data-empty-new]");
  if (emptyNew) emptyNew.addEventListener("click", openNew);
  bindSearch();

  root().querySelectorAll("[data-filter]").forEach((chip) => {
    chip.addEventListener("click", () => {
      filters[chip.dataset.filter] = chip.dataset.value;
      renderListPage(page);
    });
  });

  const list = root().querySelector("#list");
  if (!list) return;

  list.addEventListener("click", (event) => {
    const item = event.target.closest(".list-row");
    if (!item) return;
    const row = state.data[editor.table].find((r) => String(rowKey(editor, r)) === item.dataset.key);
    const move = event.target.closest("[data-move]");
    if (move) return moveRow(page.id, row, Number(move.dataset.move));
    if (event.target.closest(".list-open")) openEditor(page.id, row);
  });

  if (editor.sortable && window.Sortable) {
    new window.Sortable(list, {
      handle: ".drag-handle",
      animation: 150,
      onEnd: () => {
        const keys = [...list.querySelectorAll(".list-row")].map((li) => li.dataset.key);
        persistOrder(page.id, keys);
      },
    });
  }
}

function listRowHTML(editor, row, index, count) {
  const badges = (editor.badges ? editor.badges(row) : []).filter(Boolean).join("");
  const title = editor.title(row) || "(untitled)";
  return `
    <li class="list-row" data-key="${escapeAttr(rowKey(editor, row))}">
      ${editor.sortable ? `<span class="drag-handle" title="Drag to reorder" aria-hidden="true">${icon("drag-and-drop")}</span>` : ""}
      ${editor.thumb ? `<span class="list-thumb">${editor.thumb(row)}</span>` : ""}
      <button type="button" class="list-open">
        <strong>${escapeHTML(title)}</strong>
        ${editor.subtitle(row) ? `<span class="sub">${escapeHTML(editor.subtitle(row))}</span>` : ""}
      </button>
      ${badges ? `<span class="list-badges">${badges}</span>` : ""}
      ${editor.sortable ? `
        <span class="list-move">
          <button type="button" class="icon-btn" data-move="-1" aria-label="Move ${escapeAttr(title)} up"${index === 0 ? " disabled" : ""}>${icon("arrow-up")}</button>
          <button type="button" class="icon-btn" data-move="1" aria-label="Move ${escapeAttr(title)} down"${index === count - 1 ? " disabled" : ""}>${icon("arrow-down")}</button>
        </span>` : ""}
    </li>`;
}

function bindSearch() {
  const search = root().querySelector("#page-search");
  if (!search) return;
  search.addEventListener("input", () => {
    state.search = search.value;
    const at = search.selectionStart;
    renderPage();
    const again = root().querySelector("#page-search");
    again.focus();
    again.setSelectionRange(at, at);
  });
  search.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && search.value) {
      event.stopPropagation();
      state.search = "";
      renderPage();
      root().querySelector("#page-search").focus();
    }
  });
}

/* Reordering a filtered or searched view only swaps the rows you can
 * see, inside the slots they already hold in the full list, so hidden
 * rows never move. */
async function persistOrder(id, visibleKeysInNewOrder) {
  const editor = EDITORS[id];
  const table = editor.table;
  const full = [...state.data[table]].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  const visible = new Set(visibleKeysInNewOrder);
  const slots = full.map((r, i) => (visible.has(String(rowKey(editor, r))) ? i : -1)).filter((i) => i >= 0);
  const byKey = Object.fromEntries(full.map((r) => [String(rowKey(editor, r)), r]));
  const next = [...full];
  slots.forEach((slot, i) => {
    next[slot] = byKey[visibleKeysInNewOrder[i]];
  });

  const previous = state.data[table];
  const changes = next
    .map((row, i) => [row, i])
    .filter(([row, i]) => (row.sort_order || 0) !== i);
  state.data[table] = next.map((row, i) => ({ ...row, sort_order: i }));
  renderPage();

  try {
    await Promise.all(changes.map(([row, i]) => editor.update(rowKey(editor, row), { sort_order: i })));
    if (changes.length) toast("Order saved.");
  } catch (err) {
    state.data[table] = previous;
    renderPage();
    toast(err.message || "Could not save the order.", "error");
  }
}

function moveRow(id, row, delta) {
  const editor = EDITORS[id];
  const keys = visibleRows(id).map((r) => String(rowKey(editor, r)));
  const from = keys.indexOf(String(rowKey(editor, row)));
  const to = from + delta;
  if (from < 0 || to < 0 || to >= keys.length) return;
  [keys[from], keys[to]] = [keys[to], keys[from]];
  persistOrder(id, keys).then(() => {
    const button = root().querySelector(`.list-row[data-key="${CSS.escape(keys[to])}"] [data-move="${delta}"]`);
    if (button && !button.disabled) button.focus();
  });
}

function openEditor(id, row) {
  const editor = EDITORS[id];
  const key = row ? rowKey(editor, row) : null;
  const refresh = async () => {
    await reload(editor.table);
    renderSidebar();
    renderPage();
  };

  openDrawer({
    title: row ? `Edit ${editor.noun}: ${editor.title(row)}` : `New ${editor.noun}`,
    fields: editor.fields,
    sections: editor.sections,
    row,
    preview: editor.preview,
    validate: editor.validate,
    onSave: async (raw) => {
      const values = editor.normalise ? editor.normalise(raw) : raw;
      if (row) await editor.update(key, values);
      else {
        // New rows go to the end of the list.
        if (editor.sortable) values.sort_order = state.data[editor.table].length;
        await editor.create(values);
      }
      await refresh();
      toast(row ? "Saved." : `${editor.noun[0].toUpperCase()}${editor.noun.slice(1)} created.`);
    },
    onDelete: row && (async () => {
      try {
        await editor.remove(key);
        closeDrawer(true);
        await refresh();
        toast("Deleted.");
      } catch (err) {
        toast(err.message || "Could not delete. Only admins can delete.", "error");
      }
    }),
    actions: ((editor.actions && editor.actions(row)) || []).map((action) => ({
      ...action,
      run: async () => {
        try {
          await editor.update(key, action.patch);
          closeDrawer(true);
          await refresh();
          toast(`${editor.title(row)}: ${action.label.toLowerCase()} done.`);
        } catch (err) {
          toast(err.message || "Could not update.", "error");
        }
      },
    })),
  });
}

/* ==================================================================
 * Events: the Kanban board
 * ================================================================== */

function eventsInStage(stage) {
  return state.data.events
    .filter((e) => e.stage === stage)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.starts_at).localeCompare(String(b.starts_at)));
}

function renderEventsPage(page) {
  root().innerHTML = `
    ${pageHead(page, { count: state.data.events.length, newLabel: "New event", search: false })}
    <p class="page-intro">Drag a card between columns, or open it and change its stage. The public site works out Upcoming, Live and Finished from the time, so a forgotten card never shows a stale event.</p>
    <div class="board" id="board"></div>`;
  root().querySelector("#page-new").addEventListener("click", () => openEventEditor(null));
  renderBoard();
}

function renderBoard() {
  const board = document.getElementById("board");
  if (!board) return;

  board.innerHTML = STAGES.map((stage) => {
    const inStage = eventsInStage(stage);
    return `
      <div class="board-column">
        <h3>${escapeHTML(stage)} <span class="board-count">${inStage.length}</span></h3>
        <div class="board-dropzone" data-stage="${stage}">
          ${inStage.length ? inStage.map(eventCardAdminHTML).join("") : `<p class="card-empty">Nothing here yet.</p>`}
        </div>
      </div>`;
  }).join("");

  board.querySelectorAll(".board-dropzone").forEach((zone) => {
    if (window.Sortable) {
      new window.Sortable(zone, { group: "board", draggable: ".card", animation: 150, onEnd: onCardDropped });
    }
  });
  board.onclick = (event) => {
    const card = event.target.closest(".card");
    if (card) openEventEditor(card.dataset.id);
  };
  board.onkeydown = (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest(".card");
    if (!card) return;
    event.preventDefault();
    openEventEditor(card.dataset.id);
  };
}

function eventCardAdminHTML(event) {
  return `
    <article class="card" data-id="${escapeAttr(event.id)}" tabindex="0" role="button" aria-label="Edit ${escapeAttr(event.title)}">
      <h4>${escapeHTML(event.title)}</h4>
      <p class="card-meta">${escapeHTML(formatDateTimeLocal(event.starts_at))}</p>
      ${event.group_name ? `<p class="card-meta">${escapeHTML(event.group_name)}</p>` : ""}
    </article>`;
}

async function onCardDropped(evt) {
  const id = evt.item.dataset.id;
  const target = evt.to; // onEnd fires on the SOURCE list; the destination is evt.to
  const stage = target.dataset.stage;
  const previous = state.data.events.map((e) => ({ ...e }));
  const ids = Array.from(target.querySelectorAll(".card")).map((card) => card.dataset.id);

  state.data.events = state.data.events.map((e) => {
    const index = ids.indexOf(e.id);
    if (index === -1) return e;
    return { ...e, sort_order: index, ...(e.id === id ? { stage } : {}) };
  });
  renderBoard();

  try {
    const moved = previous.find((e) => e.id === id);
    if (moved && moved.stage !== stage) await updateEvent(id, { stage });
    await Promise.all(ids.map((cardId, index) => updateEvent(cardId, { sort_order: index })));
    toast(moved && moved.stage !== stage ? `Moved to ${stage}.` : "Order saved.");
  } catch (err) {
    state.data.events = previous;
    renderBoard();
    toast(err.message || "Could not move the event.", "error");
  }
}

function openEventEditor(id) {
  const event = id ? state.data.events.find((e) => e.id === id) : null;
  if (id && !event) return;
  const refresh = async () => {
    await reload("events");
    renderSidebar();
    renderPage();
  };

  openDrawer({
    title: event ? `Edit event: ${event.title}` : "New event",
    fields: EVENT_FIELDS,
    row: event,
    defaults: { stage: "draft", duration_minutes: 60 },
    preview: (v) => {
      if (!v.title || !v.starts_at) return '<p class="empty-note">Add a title and a start time to see the card.</p>';
      const display = deriveEventState(v.starts_at, v.duration_minutes || 60, v.stage);
      const note = v.stage === "draft" ? '<p class="page-note">Drafts are not shown on the site.</p>' : "";
      return `${note}${eventCardHTML({ ...v, display_state: display })}`;
    },
    onSave: async (values) => {
      const patch = { ...values, duration_minutes: values.duration_minutes || 60 };
      if (event) await updateEvent(event.id, patch);
      else await createEvent(patch);
      await refresh();
      toast(event ? "Event saved." : "Event created.");
    },
    onDelete: event && (async () => {
      try {
        await deleteEvent(event.id);
        closeDrawer(true);
        await refresh();
        toast("Event deleted.");
      } catch (err) {
        toast(err.message || "Could not delete. Only admins can delete.", "error");
      }
    }),
  });
}

/* ==================================================================
 * Team (admins only)
 * ================================================================== */

const ROLE_LABELS = { admin: "Admin", editor: "Editor", pending: "No access" };

function renderTeamPage(page) {
  const people = [...state.profiles].sort(
    (a, b) => (a.role === "pending" ? -1 : 0) - (b.role === "pending" ? -1 : 0)
  );
  const pending = people.filter((p) => p.role === "pending").length;

  root().innerHTML = `
    ${pageHead(page, { count: people.length, search: false })}
    <p class="page-intro">
      Everyone who has signed in. New accounts start with no access until
      an admin approves them. Editors add and edit content; admins can also
      delete and manage this list. There is always at least one admin.
    </p>
    ${pending ? `<p class="page-alert">${icon("user")} ${pending} ${pending === 1 ? "account is" : "accounts are"} waiting for approval.</p>` : ""}
    <ol class="list team-list">
      ${people.map((p) => {
        const you = p.id === state.user.id;
        return `
          <li class="list-row${p.role === "pending" ? " is-pending" : ""}" data-id="${escapeAttr(p.id)}">
            <span class="list-thumb">${icon("user")}</span>
            <span class="list-open">
              <strong>${escapeHTML(p.display_name || p.email || "Unknown")}${you ? " (you)" : ""}</strong>
              <span class="sub">${escapeHTML(p.email || "")}</span>
            </span>
            <span class="list-badges"><span class="badge">${ROLE_LABELS[p.role] || p.role}</span></span>
            <span class="team-actions">
              ${p.role === "pending"
                ? `<button type="button" class="btn btn-primary" data-role="editor">${icon("check")}<span>Approve as editor</span></button>`
                : ""}
              <label class="visually-hidden" for="role-${escapeAttr(p.id)}">Role for ${escapeHTML(p.email || "")}</label>
              <select id="role-${escapeAttr(p.id)}" data-role-select>
                ${Object.entries(ROLE_LABELS).map(([value, label]) => `<option value="${value}"${p.role === value ? " selected" : ""}>${label}</option>`).join("")}
              </select>
            </span>
          </li>`;
      }).join("")}
    </ol>`;

  root().querySelectorAll(".team-list .list-row").forEach((li) => {
    const id = li.dataset.id;
    const change = async (role) => {
      try {
        await setProfileRole(id, role);
        state.profiles = await listProfiles();
        renderSidebar();
        renderTeamPage(page);
        toast("Role updated.");
      } catch (err) {
        toast(err.message || "Could not change the role.", "error");
        renderTeamPage(page);
      }
    };
    const approve = li.querySelector("[data-role]");
    if (approve) approve.addEventListener("click", () => change(approve.dataset.role));
    li.querySelector("[data-role-select]").addEventListener("change", (event) => change(event.target.value));
  });
}
