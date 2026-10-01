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
  saveRepoKind, deleteRepoKind, refreshSite,
  analyticsReport, getAnalyticsAccess, setAnalyticsAccess,
  listProfiles, setProfileRole, removeMember, watchMyAccess,
  eventMail, listSubscriptions, addSubscribers, removeSubscription, listEmailSends,
  requestPasswordReset, updatePassword,
  listActivity, lastChange, restoreDeleted, inviteMember,
  uploadMemberPhoto, removeMemberPhotos,
} from "./supabase.js";
import { nextOccurrence } from "./lib/schedule.js";
import { deriveEventState } from "./lib/derive.js";
import { toLocalInputValue, fromLocalInputValue, formatDateTimeLocal } from "./lib/forms.js";
import {
  escapeHTML, escapeAttr, safeURL, icon, platformIcon, linkIcon, watchFavicons,
  coreCardHTML, portraitHTML, roleStamp,
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

/* ------------------------------------------------------------------
 * Toasts
 *
 * Every action says what happened, to what: "Created event “Explain-3”".
 * They stack in a corner (full width on phones), at most three at once.
 * A bar shows time left; hovering or focusing a toast pauses it. Errors
 * stay longer and are announced assertively.
 *
 * tone: success | delete | info | error
 * ------------------------------------------------------------------ */
const TOAST_ICONS = { success: "check", delete: "trash", info: "circle-info", error: "square-alert" };
const TOAST_MS = { success: 4200, delete: 4200, info: 5200, error: 8000 };

/* opts.action = { label, run } adds a button (Undo, Stay signed in).
 * opts.sticky keeps the toast until it is dismissed or acted on.
 * Returns the toast element so a caller can dismiss it later. */
function toast(message, tone = "success", { action, sticky = false } = {}) {
  const stack = document.getElementById("toasts");
  if (!stack) return null;
  if (!TOAST_ICONS[tone]) tone = "success";
  const lifetime = action ? Math.max(TOAST_MS[tone], 9000) : TOAST_MS[tone];

  const item = document.createElement("div");
  item.className = `toast toast-${tone}${action ? " has-action" : ""}${sticky ? " is-sticky" : ""}`;
  item.setAttribute("role", tone === "error" ? "alert" : "status");
  item.style.setProperty("--toast-ms", `${lifetime}ms`);
  item.innerHTML = `
    ${icon(TOAST_ICONS[tone], "toast-icon")}
    <p class="toast-text">${escapeHTML(message)}</p>
    ${action ? `<button type="button" class="toast-action">${escapeHTML(action.label)}</button>` : ""}
    <button type="button" class="toast-close" aria-label="Dismiss">${icon("close")}</button>
    ${sticky ? "" : '<span class="toast-timer" aria-hidden="true"></span>'}`;
  stack.append(item);
  if (action) {
    item.querySelector(".toast-action").addEventListener("click", () => {
      dismiss(item);
      action.run();
    });
  }

  // Keep the stack short: the oldest leaves first.
  const live = stack.querySelectorAll(".toast:not(.is-leaving)");
  if (live.length > 3) dismiss(live[0]);

  requestAnimationFrame(() => item.classList.add("is-in"));
  if (sticky) {
    item.querySelector(".toast-close").addEventListener("click", () => dismiss(item));
    return item;
  }

  let remaining = lifetime;
  let started = performance.now();
  let timer = setTimeout(() => dismiss(item), remaining);
  const pause = () => {
    clearTimeout(timer);
    remaining -= performance.now() - started;
    item.classList.add("is-paused");
  };
  const resume = () => {
    started = performance.now();
    timer = setTimeout(() => dismiss(item), Math.max(remaining, 1200));
    item.classList.remove("is-paused");
  };
  item.addEventListener("pointerenter", pause);
  item.addEventListener("pointerleave", resume);
  item.addEventListener("focusin", pause);
  item.addEventListener("focusout", resume);
  item.querySelector(".toast-close").addEventListener("click", () => {
    clearTimeout(timer);
    dismiss(item);
  });
  return item;
}

function dismiss(item) {
  if (item.classList.contains("is-leaving")) return;
  item.classList.add("is-leaving");
  item.classList.remove("is-in");
  const done = () => item.remove();
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) done();
  else setTimeout(done, 200);
}

const quoted = (text) => `“${String(text || "untitled").slice(0, 60)}”`;

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
  const label = button.querySelector("span").textContent;
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    if (button.dataset.armed !== "true") {
      button.dataset.armed = "true";
      button.querySelector("span").textContent = `Click again to ${label.toLowerCase()}`;
      clearTimeout(button.disarm);
      button.disarm = setTimeout(() => {
        button.dataset.armed = "false";
        button.querySelector("span").textContent = label;
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

/* A password-reset link lands here with the recovery token in the URL
 * hash. supabase-js reads it and signs the user in; we show the
 * choose-a-new-password card instead of the panel. Read the flag before
 * anything touches the hash. */
const RECOVERY = /type=(recovery|invite)/.test(location.hash);
const INVITE = /type=invite/.test(location.hash);

/* Why the last sign-out happened, carried across the reload so the
 * sign-in screen can say so. */
const SIGNOUT_REASON = "fcs-signout-reason";
const SIGNOUT_NOTICES = {
  idle: "You were signed out after 30 minutes without activity.",
  removed: "An admin removed your access to this panel, so you were signed out. Ask an admin to invite you again if you need it back.",
  paused: "An admin paused your access to this panel, so you were signed out. Ask an admin to restore it.",
};

async function signOutBecause(reason) {
  try {
    sessionStorage.setItem(SIGNOUT_REASON, reason);
  } catch {
    /* the sign-in screen just will not say why */
  }
  await signOut().catch(() => {});
  location.reload();
}

async function boot() {
  watchFavicons();
  // Clickjacking guard: never run the admin inside another site's frame.
  // (GitHub Pages cannot send a frame-ancestors header.)
  if (window.top !== window.self) {
    document.body.textContent = "The admin panel cannot be shown inside another page.";
    return;
  }

  document.getElementById("admin-signout").addEventListener("click", () =>
    signOut().then(() => location.reload())
  );
  bindDrawer();
  startPixelField();

  if (!isConfigured()) {
    gate(`
      <h1>Admin panel</h1>
      <p class="gate-sub">Supabase is not configured yet. Set <code>supabaseUrl</code> and
         <code>supabaseAnonKey</code> in <code>js/config.js</code>, then reload.</p>`);
    return;
  }

  let session = null;
  try {
    session = await getSession();
  } catch (err) {
    gate(`
      <h1>Cannot reach the database</h1>
      <p class="gate-sub">${escapeHTML(err.message || "Unknown error")}</p>
      <p class="gate-foot">The public site is unaffected and still works from its seed data.</p>`);
    return;
  }

  if (session && RECOVERY) return renderSetPassword(session.user);
  if (!session) {
    let reason = null;
    try {
      reason = sessionStorage.getItem(SIGNOUT_REASON);
      sessionStorage.removeItem(SIGNOUT_REASON);
    } catch {
      /* storage unavailable */
    }
    return renderLogin(SIGNOUT_NOTICES[reason]);
  }
  await onSignedIn(session.user);
}

/* ------------------------------------------------------------------
 * The gate: every signed-out screen is one card on the pixel field.
 * ------------------------------------------------------------------ */

function gate(inner, { form = false } = {}) {
  document.body.classList.add("is-gate");
  const tag = form ? "form" : "div";
  root().innerHTML = `
    <section class="gate">
      <${tag} class="gate-card" ${form ? 'id="gate-form" novalidate' : ""}>
        <span class="gate-mark" aria-hidden="true"><img src="assets/favicon-192.png" alt="" width="56" height="56" /></span>
        ${inner}
      </${tag}>
    </section>`;
  return root().querySelector(".gate-card");
}

function gateField({ id, label, type, icon: iconName, autocomplete, reveal = false }) {
  return `
    <div class="gate-field">
      <label for="${id}">${label}</label>
      <span class="gate-input">
        ${icon(iconName)}
        <input id="${id}" type="${type}" autocomplete="${autocomplete}" required />
        ${reveal ? `<button type="button" class="gate-reveal" data-reveal="${id}" aria-label="Show password" aria-pressed="false">${icon("eye", "icon-eye")}${icon("eye-off", "icon-eye-off")}</button>` : ""}
      </span>
    </div>`;
}

function bindReveal(card) {
  card.querySelectorAll("[data-reveal]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = card.querySelector(`#${button.dataset.reveal}`);
      const shown = input.type === "text";
      input.type = shown ? "password" : "text";
      button.setAttribute("aria-pressed", String(!shown));
      button.setAttribute("aria-label", shown ? "Show password" : "Hide password");
      input.focus();
    });
  });
}

/* Button text and a disabled state while a request is in flight. */
async function busy(button, label, run) {
  const text = button.querySelector("span:last-child");
  const idle = text.textContent;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  text.textContent = label;
  try {
    return await run();
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    text.textContent = idle;
  }
}

/* notice: optional { text, tone: "info" | "ok" } shown above the form;
 * email: prefilled, e.g. right after someone sets their password. */
function renderLogin(notice, { email: prefillEmail = "" } = {}) {
  const note = typeof notice === "string" ? { text: notice, tone: "info" } : notice;
  const card = gate(`
    <h1>Sign in to the panel</h1>
    <p class="gate-sub">For editors and admins of The Free Code Syndicate.</p>
    ${note && note.text ? `<p class="gate-notice gate-notice-${note.tone === "ok" ? "ok" : "info"}" role="status">${icon(note.tone === "ok" ? "check" : "circle-info")}<span>${escapeHTML(note.text)}</span></p>` : ""}
    ${gateField({ id: "login-email", label: "Email", type: "email", icon: "mail", autocomplete: "username" })}
    ${gateField({ id: "login-password", label: "Password", type: "password", icon: "lock", autocomplete: "current-password", reveal: true })}
    <p class="admin-error" id="login-error" role="alert"></p>
    <button type="submit" class="btn btn-primary gate-submit">${icon("login")}<span>Sign in</span></button>
    <div class="gate-divider"><span>or</span></div>
    <button type="button" class="btn gate-secondary" id="forgot">${icon("key")}<span>Email me a reset link</span></button>
    <p class="gate-foot">Accounts are invite-only. Ask a club admin to add you, then sign in here.</p>`, { form: true });

  bindReveal(card);
  const email = card.querySelector("#login-email");
  const errorEl = card.querySelector("#login-error");
  if (prefillEmail) {
    email.value = prefillEmail;
    card.querySelector("#login-password").focus();
  } else {
    email.focus();
  }

  card.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorEl.textContent = "";
    const password = card.querySelector("#login-password").value;
    if (!email.value.trim() || !password) {
      errorEl.textContent = "Enter your email and password.";
      return;
    }
    try {
      const user = await busy(card.querySelector(".gate-submit"), "Signing in…", () =>
        signIn(email.value.trim(), password)
      );
      await onSignedIn(user);
    } catch (err) {
      errorEl.textContent = /invalid login credentials/i.test(err.message || "")
        ? "Wrong email or password. If an admin removed your access, ask them to invite you again."
        : err.message || "Sign in failed.";
    }
  });

  card.querySelector("#forgot").addEventListener("click", async (event) => {
    errorEl.textContent = "";
    if (!email.value.trim()) {
      errorEl.textContent = "Enter your email first, then ask for the link.";
      email.focus();
      return;
    }
    try {
      await busy(event.currentTarget, "Sending…", () =>
        requestPasswordReset(email.value.trim(), `${location.origin}${location.pathname}`)
      );
      toast(`Reset link sent to ${email.value.trim()}. Check your inbox.`, "info");
    } catch (err) {
      errorEl.textContent = err.message || "Could not send the reset link.";
    }
  });
}

async function renderSetPassword(user) {
  const role = INVITE ? await getRole(user.id).catch(() => null) : null;
  const roleName = { admin: "Admin", editor: "Editor" }[role];
  const heading = INVITE ? "Accept your invite" : "Choose a new password";
  const sub = INVITE
    ? `You have been invited to The Free Code Syndicate's panel${roleName ? ` as <strong>${roleName}</strong>` : ""}.
       Choose a password for <strong>${escapeHTML(user.email)}</strong> to accept.`
    : `For <strong>${escapeHTML(user.email)}</strong>. At least 8 characters.`;

  const card = gate(`
    <h1>${heading}</h1>
    <p class="gate-sub">${sub}</p>
    <input type="email" autocomplete="username" value="${escapeAttr(user.email)}" hidden aria-hidden="true" tabindex="-1" />
    ${gateField({ id: "new-password", label: "Password", type: "password", icon: "lock", autocomplete: "new-password", reveal: true })}
    ${gateField({ id: "confirm-password", label: "Confirm password", type: "password", icon: "lock", autocomplete: "new-password" })}
    <p class="admin-error" id="login-error" role="alert"></p>
    <button type="submit" class="btn btn-primary gate-submit">${icon("check")}<span>${INVITE ? "Accept and set password" : "Save password"}</span></button>
    ${INVITE ? '<p class="gate-foot">At least 8 characters. You can change it later with a reset link.</p>' : ""}`, { form: true });

  bindReveal(card);
  history.replaceState(null, "", location.pathname);
  const input = card.querySelector("#new-password");
  const confirm = card.querySelector("#confirm-password");
  input.focus();
  card.addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorEl = card.querySelector("#login-error");
    if (input.value.length < 8) {
      errorEl.textContent = "Use at least 8 characters.";
      return;
    }
    if (input.value !== confirm.value) {
      errorEl.textContent = "The two passwords do not match.";
      confirm.focus();
      return;
    }
    try {
      await busy(card.querySelector(".gate-submit"), "Saving…", () => updatePassword(input.value));
      // Sign out and come back through the front door: this confirms the
      // new password works, and lets the browser offer to save it.
      await signOut().catch(() => {});
      renderLogin(
        {
          text: INVITE
            ? `You're in${roleName ? ` as ${roleName.toLowerCase()}` : ""}. Sign in with your new password.`
            : "Password changed. Sign in with your new password.",
          tone: "ok",
        },
        { email: user.email }
      );
    } catch (err) {
      errorEl.textContent = err.message || "Could not set the password.";
    }
  });
}

function noAccess(title, body) {
  const card = gate(`
    <h1>${title}</h1>
    ${body}
    <button type="button" class="btn gate-secondary" id="back-to-login">${icon("undo")}<span>Back to sign in</span></button>`);
  card.querySelector("#back-to-login").addEventListener("click", () => renderLogin());
}

/* The twinkling pixel field behind the gate. A few cells change per
 * frame at about 12 fps; still under reduced motion; stops for good once
 * someone signs in. */
function startPixelField() {
  const canvas = document.getElementById("pixel-field");
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext("2d");
  const STEP = 16;
  const SIZE = 3;
  let cols = 0;
  let rows = 0;
  let cells = [];

  const colors = () => {
    const css = getComputedStyle(document.documentElement);
    return { ink: css.getPropertyValue("--ink").trim(), accent: css.getPropertyValue("--accent").trim() };
  };

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.ceil(innerWidth / STEP);
    rows = Math.ceil(innerHeight / STEP);
    cells = Array.from({ length: cols * rows }, () => ({
      a: Math.random() < 0.55 ? 0 : Math.random() * 0.35,
      yellow: Math.random() < 0.05,
    }));
  };

  const draw = () => {
    const { ink, accent } = colors();
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const cx = innerWidth / 2;
    const cy = innerHeight / 2;
    const reach = Math.hypot(cx, cy);
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (!cell.a) continue;
      const x = (i % cols) * STEP + (STEP - SIZE) / 2;
      const y = Math.floor(i / cols) * STEP + (STEP - SIZE) / 2;
      // Quieter near the card, busier toward the edges.
      const edge = Math.min(1, Math.hypot(x - cx, y - cy) / reach + 0.15);
      ctx.globalAlpha = cell.a * edge * (cell.yellow ? 2.2 : 1);
      ctx.fillStyle = cell.yellow ? accent : ink;
      ctx.fillRect(x, y, SIZE, SIZE);
    }
    ctx.globalAlpha = 1;
  };

  resize();
  draw();
  window.addEventListener("resize", () => {
    resize();
    draw();
  });

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let last = 0;
  const tick = (t) => {
    if (!document.body.classList.contains("is-gate")) return; // signed in: stop
    if (t - last > 80 && !document.hidden) {
      last = t;
      for (let n = 0; n < Math.ceil(cells.length * 0.02); n++) {
        const cell = cells[(Math.random() * cells.length) | 0];
        cell.a = Math.random() < 0.5 ? 0 : Math.random() * 0.35;
      }
      draw();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function onSignedIn(user) {
  const role = await getRole(user.id);

  // A real sign-out in both cases, so a reload lands on the login form
  // rather than a half-authenticated dead end.
  if (!role || role === "pending") {
    await signOut().catch(() => {});
    if (role === "pending") {
      noAccess("No access yet", `
        <p class="gate-sub">Your account exists, but it has no access: an admin has not approved it yet, or has paused it.</p>
        <p class="gate-foot">Ask an admin to open <strong>Team</strong> in this panel and approve
           <code>${escapeHTML(user.email)}</code>. You have been signed out.</p>`);
    } else {
      noAccess("Access removed", `
        <p class="gate-sub">An admin removed your access to this panel. You have been signed out.</p>
        <p class="gate-foot">Ask an admin to invite you again if you need it back.</p>`);
    }
    return;
  }

  state.user = user;
  state.role = role;
  // Admins always see Analytics; editors only once an admin grants it.
  state.canAnalytics = role === "admin" || (role === "editor" && (await getAnalyticsAccess(user.id).catch(() => false)));
  document.body.classList.remove("is-gate");
  document.getElementById("admin-identity").textContent = `${user.email} · ${role}`;
  document.getElementById("admin-signout").hidden = false;

  root().innerHTML = `<p class="empty-note">Loading content&hellip;</p>`;
  try {
    await loadAll();
  } catch (err) {
    document.body.classList.add("is-gate");
    const card = gate(`
      <h1>Could not load your content</h1>
      <p class="gate-sub">${escapeHTML(err.message || "Unknown error")}</p>
      <button type="button" class="btn btn-primary gate-submit" id="retry">${icon("undo")}<span>Retry</span></button>`);
    card.querySelector("#retry").addEventListener("click", () => location.reload());
    return;
  }

  renderSidebar();
  window.addEventListener("hashchange", onHashChange);
  bindShortcuts();
  startIdleWatch();
  startAccessWatch(user.id);
  go(routeFromHash());
  toast(`Signed in as ${user.email}.`, "info");
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
  { id: "repos", label: "Repositories", icon: "github", site: "#projects" },
  { id: "activity", label: "Activity", icon: "list-box" },
  { id: "analytics", label: "Analytics", icon: "eye", gate: () => isAdmin() || state.canAnalytics },
  { id: "subscribers", label: "Subscribers", icon: "mail", adminOnly: true },
  { id: "team", label: "Team", icon: "shield", adminOnly: true },
];

const visiblePages = () => PAGES.filter((p) => (!p.adminOnly || isAdmin()) && (!p.gate || p.gate()));

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
  if (id === "repos") return state.orgRepos ? state.orgRepos.length : "";
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
  else if (state.route === "activity") renderActivityPage(page);
  else if (state.route === "subscribers") renderSubscribersPage(page);
  else if (state.route === "repos") renderReposPage(page);
  else if (state.route === "analytics") renderAnalyticsPage(page);
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
    intro: "Leads and mentors get the same card; only the stamp's colour tells them apart. Only the links you fill in appear on the site.",
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
      { name: "photo_url", label: "Photo", type: "photo", help: "Square-cropped and shrunk in your browser, then uploaded when you save. Without one, the GitHub avatar is used." },
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
    // Leads and mentors get the same card.
    preview: (v) => `<div class="core-roster">${coreCardHTML(v)}</div>`,
    actions: (row) => row && [
      row.status === "alumni"
        ? { label: "Restore to active", icon: "undo", patch: { status: "active", ended_on: null },
            done: (r) => `Restored ${quoted(r.name)} to active.` }
        : { label: "Move to alumni", icon: "archive", patch: { status: "alumni", ended_on: new Date().toISOString().slice(0, 10) },
            done: (r) => `Moved ${quoted(r.name)} to alumni.`, tone: "info" },
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
    thumb: (r) => linkIcon(r.link, "", "book-open"),
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
    thumb: (r) => linkIcon(r.url, "", "bookmark"),
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
    thumb: (r) => platformIcon(r.platform, "", r.url),
    badges: (r) => [r.is_published === false ? '<span class="badge">Hidden</span>' : ""],
    fields: [
      { name: "platform", label: "Platform", type: "select", options: ["discord", "instagram", "whatsapp", "github", "x", "web", "other"].map((p) => [p, p]), help: "Any other site: pick other, and it shows that site's own icon." },
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

function fieldHTML(field, value, { editing, row } = {}) {
  const id = `f-${field.name}-${++fieldSeq}`;
  const help = field.help ? `<span class="field-help" id="${id}-help">${escapeHTML(field.help)}</span>` : "";
  const error = `<span class="field-error" id="${id}-error" data-error-for="${field.name}" hidden></span>`;
  const described = `aria-describedby="${field.help ? `${id}-help ` : ""}${id}-error"`;
  const wide = field.wide || field.type === "textarea" ? " field-wide" : "";
  const req = field.required ? " required" : "";

  if (field.type === "photo") return photoFieldHTML(field, row || {}, id);

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
  const render = (names) => names.map((n) => fieldHTML(byName[n], row ? row[n] : undefined, { editing, row })).join("");
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
    if (field.type === "photo") {
      out.photo_url = form.elements.photo_url.value || null;
      out.photo_thumb_url = form.elements.photo_thumb_url.value || null;
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
  form._photo = null;
  bindPhotoFields(form);
  showLastChange(opts.table, opts.rowKey);
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
    // The footer wraps to two rows on phones; toasts sit above whatever height it has.
    document.body.style.setProperty("--drawer-footer", `${footer.offsetHeight}px`);
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
    if (changes.length) toast("Order saved.", "info");
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
    table: editor.table,
    rowKey: key,
    onSave: async (raw) => {
      const values = editor.normalise ? editor.normalise(raw) : raw;
      await uploadPendingPhoto(values);
      if (row) await editor.update(key, values);
      else {
        // New rows go to the end of the list.
        if (editor.sortable) values.sort_order = state.data[editor.table].length;
        await editor.create(values);
      }
      // A replaced or removed photo leaves its old files behind; tidy them.
      if (row && row.photo_url && row.photo_url !== values.photo_url) {
        removeMemberPhotos([row.photo_url, row.photo_thumb_url]).catch(() => {});
      }
      await refresh();
      toast(`${row ? "Saved" : "Created"} ${editor.noun} ${quoted(editor.title(values))}.`);
    },
    onDelete: row && (async () => {
      try {
        await editor.remove(key);
        closeDrawer(true);
        await refresh();
        toast(`Deleted ${editor.noun} ${quoted(editor.title(row))}.`, "delete", {
          action: { label: "Undo", run: () => undoDelete(editor.table, key, `${editor.noun} ${quoted(editor.title(row))}`) },
        });
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
          toast(action.done(row), action.tone || "success");
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
    toast(moved && moved.stage !== stage ? `Moved ${quoted(moved.title)} to ${stage}.` : "Order saved.", "info");
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
    table: "events",
    rowKey: event && event.id,
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
      toast(`${event ? "Saved" : "Created"} event ${quoted(values.title)}.`);
    },
    onDelete: event && (async () => {
      try {
        await deleteEvent(event.id);
        closeDrawer(true);
        await refresh();
        toast(`Deleted event ${quoted(event.title)}.`, "delete", {
          action: { label: "Undo", run: () => undoDelete("events", event.id, `event ${quoted(event.title)}`) },
        });
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
      <strong>No access</strong> keeps the account but blocks it; <strong>Remove</strong>
      deletes their login entirely.
    </p>
    <form class="invite-form" id="invite-form" novalidate>
      <div class="field">
        <label for="invite-email">Invite by email</label>
        <input id="invite-email" type="email" autocomplete="off" placeholder="friend@example.com" required />
      </div>
      <div class="field">
        <label for="invite-role">As</label>
        <select id="invite-role"><option value="editor">Editor</option><option value="admin">Admin</option></select>
      </div>
      <button type="submit" class="btn btn-primary">${icon("send")}<span>Send invite</span></button>
      <p class="field-help invite-help">They get an email with a link to choose a password; their role is already set.
        Emails to addresses outside your Supabase team need custom SMTP (see the README).</p>
    </form>
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
              ${p.role === "editor" ? `<button type="button" class="btn btn-quiet" data-analytics aria-pressed="${Boolean(p.can_view_analytics)}" title="Let this editor see the Analytics page">${icon("eye")}<span>Analytics: ${p.can_view_analytics ? "on" : "off"}</span></button>` : ""}
              ${you ? "" : `<button type="button" class="btn btn-danger" data-remove aria-label="Remove ${escapeAttr(p.email || "this account")} completely">${icon("trash")}<span>Remove</span></button>`}
            </span>
          </li>`;
      }).join("")}
    </ol>`;

  const inviteForm = root().querySelector("#invite-form");
  inviteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = inviteForm.querySelector("#invite-email").value.trim();
    const role = inviteForm.querySelector("#invite-role").value;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      toast("Enter the email address to invite.", "error");
      inviteForm.querySelector("#invite-email").focus();
      return;
    }
    try {
      await busy(inviteForm.querySelector("[type=submit]"), "Sending…", () =>
        inviteMember(email, role, `${location.origin}${location.pathname}`)
      );
      state.profiles = await listProfiles();
      renderSidebar();
      renderTeamPage(page);
      toast(`Invited ${email} as ${role}. They will get an email with a link.`, "success");
    } catch (err) {
      toast(err.message || "Could not send the invite.", "error");
    }
  });

  root().querySelectorAll(".team-list .list-row").forEach((li) => {
    const id = li.dataset.id;
    const change = async (role) => {
      try {
        const person = state.profiles.find((p) => p.id === id) || {};
        await setProfileRole(id, role);
        state.profiles = await listProfiles();
        renderSidebar();
        renderTeamPage(page);
        const who = person.email || "the account";
        if (role === "pending") toast(`Removed access for ${who}.`, "delete");
        else if (person.role === "pending") toast(`Approved ${who} as ${role}.`);
        else toast(`${who} is now ${ROLE_LABELS[role].toLowerCase()}.`);
      } catch (err) {
        toast(err.message || "Could not change the role.", "error");
        renderTeamPage(page);
      }
    };
    const approve = li.querySelector("[data-role]");
    if (approve) approve.addEventListener("click", () => change(approve.dataset.role));
    li.querySelector("[data-role-select]").addEventListener("change", (event) => change(event.target.value));
    const analytics = li.querySelector("[data-analytics]");
    if (analytics) analytics.addEventListener("click", async () => {
      const person = state.profiles.find((p) => p.id === id) || {};
      const allowed = !person.can_view_analytics;
      try {
        await busy(analytics, "Saving…", () => setAnalyticsAccess(id, allowed));
        state.profiles = await listProfiles();
        renderTeamPage(page);
        toast(`${person.email || "They"} ${allowed ? "can now see" : "can no longer see"} Analytics.`, allowed ? "success" : "delete");
      } catch (err) {
        toast(err.message || "Could not change analytics access.", "error");
      }
    });
    const remove = li.querySelector("[data-remove]");
    if (remove) armedDelete(remove, async () => {
      const who = (state.profiles.find((p) => p.id === id) || {}).email || "the account";
      try {
        await removeMember(id);
        state.profiles = await listProfiles();
        renderSidebar();
        renderTeamPage(page);
        toast(`Removed ${who}. Their login is deleted; invite them again to bring them back.`, "delete");
      } catch (err) {
        toast(err.message || "Could not remove them.", "error");
      }
    });
  });
}

/* ==================================================================
 * Analytics: first-party, cookie-free numbers for the public site
 * (js/track.js -> the collect Edge Function -> analytics_report()).
 * Admins see it; so do editors an admin has switched it on for, on
 * the Team page. The database enforces the same rule.
 *
 * Charts follow neobrutalism.dev/charts, drawn in plain SVG/CSS: solid
 * fills with a 2px black outline, dashed grey horizontal grid, bars
 * rounded on top, a bordered tooltip card, bordered legend squares, and
 * every chart in a card with a trend line in its footer.
 * ================================================================== */

const ANALYTICS_RANGES = [["24h", "24 hours", 1], ["7d", "7 days", 7], ["30d", "30 days", 30], ["90d", "90 days", 90]];
const SECTION_NAMES = {
  abstract: "Abstract", icarus: "The Icarus Mark", protocol: "Operating Protocol", projects: "Projects",
  resources: "Resources", "study-groups": "Study groups", events: "Events", contribute: "Contribution lanes",
  core: "Core members", join: "Entry",
};
const EVENT_NAMES = {
  join: "Opened a join link", copy: "Copied a Discord handle", social: "Footer social link", calendar: "Calendar",
  notify: "Opened email signup", subscribe: "Signed up for emails", repo: "Opened a project", resource: "Opened a resource",
  "member-link": "Opened a member's link", link: "Opened an event or group link",
};
const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

const fmtSeconds = (s) => {
  const n = Math.round(Number(s) || 0);
  return n >= 60 ? `${Math.floor(n / 60)}m ${n % 60}s` : `${n}s`;
};
const num = (v) => Number(v) || 0;

/* "▲ 50%" style change against the previous period. */
function change(now, before, { lowerIsBetter = false } = {}) {
  const a = num(now);
  const b = num(before);
  if (!b) return { text: a ? "nothing earlier to compare" : "", tone: "", none: true };
  const pct = Math.round(((a - b) / b) * 100);
  if (!pct) return { text: "same as before", tone: "", none: true };
  // Green is up and red is down, except where down is the good news.
  const good = lowerIsBetter ? pct < 0 : pct > 0;
  return { text: `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}%`, tone: good ? "is-good" : "is-bad", pct };
}

/* Every hour or day in the range, including empty ones, in local time
 * (the report groups in the same timezone). */
function analyticsBuckets(since, until, bucket, series) {
  const byStart = new Map(series.map((s) => [Date.parse(s.t), s]));
  const t = new Date(since);
  if (bucket === "hour") t.setMinutes(0, 0, 0);
  else t.setHours(0, 0, 0, 0);
  const out = [];
  while (t < until) {
    const hit = byStart.get(t.getTime()) || {};
    out.push({
      at: new Date(t), visitors: hit.visitors || 0, pageviews: hit.pageviews || 0, sessions: hit.sessions || 0,
      desktop: hit.desktop || 0, mobile: hit.mobile || 0, tablet: hit.tablet || 0,
    });
    if (bucket === "hour") t.setHours(t.getHours() + 1);
    else t.setDate(t.getDate() + 1);
  }
  return out;
}

const bucketLabel = (d, bucket) => bucket === "hour"
  ? d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/* A tidy axis top: four even steps of a round number, close above the data,
 * so the tallest bar or area fills most of the chart. */
function niceMax(max) {
  const raw = Math.max(max, 1) / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * power).find((v) => v >= raw);
  return Math.max(4, step * 4);
}

/* Bars with only the top corners rounded, like Recharts' radius [4,4,0,0]. */
function topRoundedBar(x, y, w, h, r = 4) {
  if (h <= 0) return "";
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/* A smooth line through the points that never overshoots between them
 * (monotone cubic, what Recharts' type="monotone" draws), so a curve
 * cannot dip below zero or above a peak. */
function monotonePath(xs, ys) {
  const n = xs.length;
  if (n === 1) return `M${xs[0]},${ys[0]}`;
  const dx = [], m = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = xs[i + 1] - xs[i];
    m[i] = (ys[i + 1] - ys[i]) / dx[i];
  }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    t[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
  }
  t[n - 1] = m[n - 2];
  let d = `M${xs[0]},${ys[0]}`;
  for (let i = 0; i < n - 1; i++) {
    d += `C${xs[i] + dx[i] / 3},${ys[i] + (t[i] * dx[i]) / 3} ${xs[i + 1] - dx[i] / 3},${ys[i + 1] - (t[i + 1] * dx[i]) / 3} ${xs[i + 1]},${ys[i + 1]}`;
  }
  return d;
}

const CHART_BOX = { W: 760, H: 250, L: 10, R: 10, T: 14, B: 28 };

/* The parts every time chart shares: grid, date ticks, hover targets, a
 * cursor, a tooltip, and a screen-reader table of the same numbers. */
function chartFrame(points, bucket, series, plot, { cursor = "band" } = {}) {
  const { W, H, L, R, T, B } = CHART_BOX;
  const iw = W - L - R, ih = H - T - B;
  const step = iw / Math.max(points.length, 1);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) =>
    `<line class="nb-gridline" x1="${L}" x2="${W - R}" y1="${T + ih - f * ih}" y2="${T + ih - f * ih}" />`).join("");
  const every = Math.max(1, Math.ceil(points.length / 8));
  const ticks = points.map((p, i) => i % every ? "" :
    `<text class="nb-tick" x="${L + step * i + step / 2}" y="${H - 8}" text-anchor="middle">${escapeHTML(bucketLabel(p.at, bucket))}</text>`).join("");
  const hits = points.map((p, i) => `<rect class="nb-hit" data-i="${i}" x="${L + step * i}" y="${T}" width="${step}" height="${ih}" />`).join("");
  const cursorEl = cursor === "line"
    ? `<line class="nb-cursor-line" x1="0" x2="0" y1="${T}" y2="${T + ih}" hidden />`
    : `<rect class="nb-cursor" x="0" y="${T}" width="${step}" height="${ih}" hidden />`;
  return `
    <div class="nb-chart" data-chart data-cursor="${cursor}">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeAttr(series.map((s) => s.label).join(", "))} per ${bucket}">
        ${grid}${cursorEl}${plot({ L, T, iw, ih, step })}${ticks}${hits}
      </svg>
      <div class="nb-tooltip" role="status" hidden></div>
      <table class="visually-hidden">
        <tr><th>${bucket === "hour" ? "Hour" : "Day"}</th>${series.map((s) => `<th>${escapeHTML(s.label)}</th>`).join("")}</tr>
        ${points.map((p) => `<tr><td>${escapeHTML(bucketLabel(p.at, bucket))}</td>${series.map((s) => `<td>${num(p[s.key])}</td>`).join("")}</tr>`).join("")}
      </table>
    </div>`;
}

/* Visitors: stacked areas by device ("Area Chart - Interactive"). */
const DEVICE_LAYERS = [
  { key: "desktop", label: "Desktop", color: "var(--chart-1)" },
  { key: "tablet", label: "Tablet", color: "var(--chart-2)" },
  { key: "mobile", label: "Mobile", color: "var(--chart-3)" },
];

function visitorsAreaHTML(points, bucket) {
  const series = DEVICE_LAYERS;
  return chartFrame(points, bucket, series, ({ L, T, iw, ih, step }) => {
    // Stack from the bottom (mobile) up; draw the tallest stack first so
    // each layer below sits on top of it, as stacked areas look.
    const order = [...series].reverse();
    const totals = points.map((p) => order.reduce((s, l) => s + num(p[l.key]), 0));
    const top = niceMax(Math.max(0, ...totals));
    const xs = points.map((_, i) => L + step * i + step / 2);
    const base = T + ih;
    let running = points.map(() => 0);
    const layers = order.map((layer) => {
      running = running.map((v, i) => v + num(points[i][layer.key]));
      return { layer, ys: running.map((v) => base - (v / top) * ih) };
    });
    return layers.reverse().map(({ layer, ys }) => {
      const line = monotonePath(xs, ys);
      return `<path class="nb-area" style="fill: ${layer.color}" d="${line}L${xs[xs.length - 1]},${base}L${xs[0]},${base}Z" />`;
    }).join("");
  }, { cursor: "line" });
}

/* Page views or visits, one at a time ("Bar Chart - Interactive"). */
function volumeBarsHTML(points, bucket, series) {
  return chartFrame(points, bucket, [series], ({ L, T, iw, ih, step }) => {
    const top = niceMax(Math.max(0, ...points.map((p) => num(p[series.key]))));
    const bw = Math.max(2, Math.min(28, step * 0.62));
    return points.map((p, i) => {
      const h = (num(p[series.key]) / top) * ih;
      return `<path class="nb-bar" style="fill: ${series.color}" d="${topRoundedBar(L + step * i + (step - bw) / 2, T + ih - h, bw, h)}" />`;
    }).join("");
  });
}

/* Hover: cursor and a tooltip listing exactly the series drawn. */
function bindChart(chart, points, bucket, series) {
  if (!chart) return;
  const svg = chart.querySelector("svg");
  const band = chart.querySelector(".nb-cursor");
  const line = chart.querySelector(".nb-cursor-line");
  const tip = chart.querySelector(".nb-tooltip");
  const hide = () => {
    (band || line).setAttribute("hidden", "");
    tip.hidden = true;
  };
  svg.addEventListener("pointermove", (e) => {
    const hit = e.target.closest && e.target.closest(".nb-hit");
    if (!hit) return hide();
    const p = points[Number(hit.dataset.i)];
    const x = Number(hit.getAttribute("x"));
    if (band) band.setAttribute("x", x);
    if (line) {
      const mid = x + Number(hit.getAttribute("width")) / 2;
      line.setAttribute("x1", mid);
      line.setAttribute("x2", mid);
    }
    (band || line).removeAttribute("hidden");
    const when = bucket === "hour"
      ? `${p.at.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, ${bucketLabel(p.at, bucket)}`
      : p.at.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    tip.innerHTML = `<p class="nb-tooltip-label">${escapeHTML(when)}</p>` +
      series.map((s) => `<p><i style="background: ${s.color}"></i>${escapeHTML(s.label)} <strong>${num(p[s.key])}</strong></p>`).join("") +
      (series.length > 1 ? `<p class="nb-tooltip-total">Total <strong>${series.reduce((t, s) => t + num(p[s.key]), 0)}</strong></p>` : "");
    tip.hidden = false;
    const box = chart.getBoundingClientRect();
    tip.style.left = `${Math.min(Math.max(e.clientX - box.left + 14, 0), box.width - tip.offsetWidth)}px`;
    tip.style.top = `${Math.max(e.clientY - box.top - tip.offsetHeight - 12, 0)}px`;
  });
  svg.addEventListener("pointerleave", hide);
}

const legendHTML = (series) =>
  `<ul class="nb-legend">${series.map((s) => `<li><i style="background: ${s.color}"></i>${escapeHTML(s.label)}</li>`).join("")}</ul>`;

/* Donut with the total in the middle (neobrutalism "Pie Chart - Donut
 * with Text"), and a bordered-square legend. */
function donutHTML(rows, { centre, caption }) {
  const total = rows.reduce((s, r) => s + num(r.value), 0);
  const R = 80, r = 50, C = 100;
  const point = (a, rad) => [C + rad * Math.sin(a), C - rad * Math.cos(a)];
  let a0 = 0;
  const slices = total ? rows.filter((row) => num(row.value)).map((row, i) => {
    const a1 = a0 + (num(row.value) / total) * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    // A single 100% slice cannot be drawn as one arc; draw two halves.
    const d = a1 - a0 >= Math.PI * 2 - 1e-6
      ? `M${C},${C - R}A${R},${R} 0 1 1 ${C},${C + R}A${R},${R} 0 1 1 ${C},${C - R}ZM${C},${C - r}A${r},${r} 0 1 0 ${C},${C + r}A${r},${r} 0 1 0 ${C},${C - r}Z`
      : (() => {
        const [x1, y1] = point(a0, R), [x2, y2] = point(a1, R), [x3, y3] = point(a1, r), [x4, y4] = point(a0, r);
        return `M${x1},${y1}A${R},${R} 0 ${large} 1 ${x2},${y2}L${x3},${y3}A${r},${r} 0 ${large} 0 ${x4},${y4}Z`;
      })();
    a0 = a1;
    return `<path class="nb-slice" fill-rule="evenodd" style="fill: ${row.color || CHART_COLORS[i % CHART_COLORS.length]}" d="${d}"><title>${escapeHTML(row.name)}: ${num(row.value)}</title></path>`;
  }).join("") : `<circle class="nb-empty-ring" cx="${C}" cy="${C}" r="${(R + r) / 2}" />`;
  return `
    <div class="nb-donut">
      <svg viewBox="0 0 200 200" role="img" aria-label="${escapeAttr(caption)}">
        ${slices}
        <text class="nb-donut-value" x="${C}" y="${C + 4}" text-anchor="middle">${escapeHTML(String(centre))}</text>
        <text class="nb-donut-caption" x="${C}" y="${C + 24}" text-anchor="middle">${escapeHTML(caption)}</text>
      </svg>
      <ul class="nb-legend">${rows.map((row, i) => `
        <li><i style="background: ${row.color || CHART_COLORS[i % CHART_COLORS.length]}"></i>${escapeHTML(row.name)} <strong>${num(row.value)}</strong></li>`).join("")}</ul>
    </div>`;
}

/* Horizontal bars (neobrutalism "Bar Chart - Horizontal"): the name and
 * value on one line, the bar under them, so a short bar never cuts the
 * name in half. Plain HTML, so it reads well to a screen reader. */
function hbarsHTML(rows, { valueKey = "sessions", nameOf = (r) => r.name, color = "var(--chart-1)" } = {}) {
  if (!rows.length) return '<p class="empty-note">Nothing yet.</p>';
  const max = Math.max(1, ...rows.map((r) => num(r[valueKey])));
  return `<ol class="nb-hbars">${rows.slice(0, 8).map((r) => `
    <li>
      <span class="nb-hbar-name">${escapeHTML(nameOf(r) || "—")}</span>
      <strong>${num(r[valueKey])}</strong>
      <span class="nb-hbar" style="--share: ${Math.max(2, (num(r[valueKey]) / max) * 100)}%; --fill: ${color}"></span>
    </li>`).join("")}</ol>`;
}

/* The card every chart sits in: title, description, body, trend footer. */
function chartCard({ title, description = "", body, footer = "", wide = false, actions = "" }) {
  return `
    <section class="nb-card${wide ? " nb-card-wide" : ""}">
      <header class="nb-card-head">
        <div><h2>${escapeHTML(title)}</h2>${description ? `<p>${escapeHTML(description)}</p>` : ""}</div>
        ${actions}
      </header>
      <div class="nb-card-body">${body}</div>
      ${footer ? `<footer class="nb-card-foot">${footer}</footer>` : ""}
    </section>`;
}

async function renderAnalyticsPage(page, { reuse = false } = {}) {
  const range = ANALYTICS_RANGES.find(([k]) => k === state.analyticsRange) || ANALYTICS_RANGES[1];
  const cached = reuse && state.analyticsLast && state.analyticsLast.range === range[0] ? state.analyticsLast : null;
  const until = cached ? cached.until : new Date();
  const since = new Date(until.getTime() - range[2] * 864e5);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const chips = `
    <div class="page-filters" role="group" aria-label="Period">
      ${ANALYTICS_RANGES.map(([key, label]) => `
        <button type="button" class="chip${key === range[0] ? " is-active" : ""}" aria-pressed="${key === range[0]}" data-range="${key}">${label}</button>`).join("")}
    </div>`;
  const bindChips = () => root().querySelectorAll("[data-range]").forEach((chip) =>
    chip.addEventListener("click", () => {
      state.analyticsRange = chip.dataset.range;
      renderAnalyticsPage(page);
    }));
  let report = cached && cached.report;
  if (!report) {
    root().innerHTML = `${pageHead(page, { search: false })}${chips}<p class="empty-note">Counting&hellip;</p>`;
    bindChips();
  }
  try {
    report = report || await analyticsReport(since.toISOString(), until.toISOString(), tz);
    state.analyticsLast = { range: range[0], until, report };
  } catch (err) {
    root().innerHTML = `${pageHead(page, { search: false })}<div class="empty-state"><p>Could not load analytics: ${escapeHTML(err.message || "unknown error")}</p></div>`;
    return;
  }
  if (state.route !== "analytics") return;

  const c = report.current || {};
  const p = report.previous || {};
  const span = `the last ${range[1]}`;
  const kpis = [
    ["Visitors", c.visitors, change(c.visitors, p.visitors), "Different people each day, added up over the period"],
    ["New visitors", c.new_sessions, change(c.new_sessions, p.new_sessions), "Visits from a browser that had never been here before"],
    ["Visits", c.sessions, change(c.sessions, p.sessions), "One per browser tab session"],
    ["Page views", c.pageviews, change(c.pageviews, p.pageviews), ""],
    ["Bounce rate", c.bounce_rate != null ? `${c.bounce_rate}%` : "—", change(c.bounce_rate, p.bounce_rate, { lowerIsBetter: true }), "Visits that saw one page for under 10 seconds"],
    ["Time in view", c.avg_engaged_s != null ? fmtSeconds(c.avg_engaged_s) : "—", change(c.avg_engaged_s, p.avg_engaged_s), "Average per visit, only while the tab was visible"],
    ["Pages per visit", c.pages_per_session ?? "—", change(c.pages_per_session, p.pages_per_session), ""],
  ];
  const points = analyticsBuckets(since, until, report.bucket, report.series || []);
  // Page views card: page views or visits, switched from its header.
  const VOLUME = {
    pageviews: { key: "pageviews", label: "Page views", color: "var(--chart-2)", total: c.pageviews, before: p.pageviews },
    sessions: { key: "sessions", label: "Visits", color: "var(--chart-4)", total: c.sessions, before: p.sessions },
  };
  const volume = VOLUME[state.analyticsSeries] || VOLUME.pageviews;
  const trendLine = (now, before) => {
    const t = change(now, before);
    return `<p>${t.pct
      ? `<strong class="${t.tone}">Trending ${t.pct > 0 ? "up" : "down"} by ${Math.abs(t.pct)}%</strong> compared with the ${escapeHTML(range[1])} before`
      : t.none && t.text.startsWith("nothing") ? `Nothing in the ${escapeHTML(range[1])} before to compare with` : "Same as the period before"}</p>
      <p class="nb-card-range">${escapeHTML(since.toLocaleDateString("en-GB", { day: "numeric", month: "short" }))} – ${escapeHTML(until.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }))}, times in ${escapeHTML(tz)}</p>`;
  };
  const returning = Math.max(0, num(c.sessions) - num(c.new_sessions));
  const empty = !num(c.pageviews);

  root().innerHTML = `
    ${pageHead(page, { search: false })}
    <p class="page-intro">
      Visits to the public site over ${escapeHTML(span)}, compared with the ${escapeHTML(range[1])} before.
      No cookies and no IP addresses are stored, and visitors who ask browsers not to track them are not counted.
    </p>
    ${chips}
    ${empty ? `<div class="empty-state"><p>No visits recorded in this period yet. Numbers appear as people visit the live site (visits from your own computer on localhost are not counted).</p></div>` : ""}
    <div class="kpi-grid">
      ${kpis.map(([label, value, delta, hint]) => `
        <div class="kpi ${delta.tone}"${hint ? ` title="${escapeAttr(hint)}"` : ""}>
          <span class="kpi-label">${label}</span>
          <strong class="kpi-value">${escapeHTML(String(value ?? 0))}</strong>
          ${delta.text ? `<span class="kpi-delta ${delta.none ? "is-none" : delta.tone}">${delta.text}</span>` : ""}
        </div>`).join("")}
    </div>
    <div class="nb-grid">
      ${chartCard({
        wide: true,
        title: "Visitors",
        description: `Showing visitors by device ${report.bucket === "hour" ? "per hour" : "per day"} for ${span}`,
        actions: `
          <label class="nb-select">
            <span class="visually-hidden">Period</span>
            <select data-range-select>
              ${ANALYTICS_RANGES.map(([k, label]) => `<option value="${k}"${k === range[0] ? " selected" : ""}>Last ${label}</option>`).join("")}
            </select>
          </label>`,
        body: `<div data-visitors>${visitorsAreaHTML(points, report.bucket)}</div>${legendHTML(DEVICE_LAYERS)}`,
        footer: trendLine(c.visitors, p.visitors),
      })}
      ${chartCard({
        wide: true,
        title: volume.label,
        description: `${volume.key === "pageviews" ? "Pages opened" : "Browser tab sessions"} ${report.bucket === "hour" ? "per hour" : "per day"} for ${span}`,
        actions: `
          <div class="nb-switch" role="group" aria-label="Show">
            ${Object.values(VOLUME).map((v) => `
              <button type="button" data-series="${v.key}" aria-pressed="${v.key === volume.key}">
                <span>${v.label}</span><strong>${num(v.total)}</strong>
              </button>`).join("")}
          </div>`,
        body: `<div data-volume>${volumeBarsHTML(points, report.bucket, volume)}</div>`,
        footer: trendLine(volume.total, volume.before),
      })}
      ${chartCard({
        title: "New and returning",
        description: "Visits from browsers seen here before, or not.",
        body: donutHTML([
          { name: "New", value: c.new_sessions, color: "var(--chart-1)" },
          { name: "Returning", value: returning, color: "var(--chart-2)" },
        ], { centre: num(c.sessions) ? `${Math.round((num(c.new_sessions) / num(c.sessions)) * 100)}%` : "—", caption: "new" }),
      })}
      ${chartCard({
        title: "Devices",
        description: "By screen width.",
        body: donutHTML((report.devices || []).map((d) => ({ name: d.name, value: d.sessions })), { centre: num(c.sessions), caption: "visits" }),
      })}
      ${chartCard({
        title: "Actions",
        description: "What visitors did, by number of times.",
        body: hbarsHTML(report.events || [], { valueKey: "count", nameOf: (r) => EVENT_NAMES[r.name] || r.name, color: "var(--chart-3)" }),
      })}
      ${chartCard({
        title: "Sections read",
        description: "Visits that stopped on each section for a second or more.",
        body: hbarsHTML(report.sections || [], { nameOf: (r) => SECTION_NAMES[r.name] || r.name, color: "var(--chart-1)" }),
      })}
      ${chartCard({
        title: "Referrers",
        description: "Where visits came from.",
        body: hbarsHTML(report.referrers || [], { color: "var(--chart-2)" }),
      })}
      ${chartCard({
        title: "Campaigns",
        description: "Links tagged with ?utm_source=…, for example ?utm_source=instagram.",
        body: hbarsHTML(report.campaigns || [], { color: "var(--chart-4)" }),
      })}
      ${chartCard({
        title: "Pages",
        description: "Page views per page.",
        body: hbarsHTML(report.pages || [], { valueKey: "views", color: "var(--chart-5)" }),
      })}
      ${chartCard({
        title: "Regions",
        description: "From the visitor's timezone, so a rough guide.",
        body: hbarsHTML(report.regions || [], { color: "var(--chart-2)" }),
      })}
    </div>`;
  bindChips();
  bindChart(root().querySelector("[data-visitors] [data-chart]"), points, report.bucket, DEVICE_LAYERS);
  bindChart(root().querySelector("[data-volume] [data-chart]"), points, report.bucket, [volume]);
  root().querySelector("[data-range-select]").addEventListener("change", (e) => {
    state.analyticsRange = e.target.value;
    renderAnalyticsPage(page);
  });
  root().querySelectorAll("[data-series]").forEach((button) =>
    button.addEventListener("click", () => {
      state.analyticsSeries = button.dataset.series;
      renderAnalyticsPage(page, { reuse: true });
    }));
}

/* ==================================================================
 * Repositories: every repo in the GitHub organisation, and where it
 * shows on the site. A repo with no choice saved is a Project (or
 * hidden, if it is archived on GitHub), so a newly pushed one appears
 * with nobody touching this page.
 *
 * Also here: pin projects to the top (in an order you set), link a
 * repo to a study group (it is listed on that group's card), and
 * "Refresh now", which re-reads GitHub and redeploys the site.
 *
 * The list comes from data/github.json (written by the deploy
 * workflow), or from GitHub's API when that file is empty (locally) or
 * on Refresh. Choices are saved to repo_kinds with upserts, never
 * deletes: only admins may delete, and editors curate repos as well.
 * ================================================================== */

const REPO_PLACES = [
  ["project", "Project", "Listed under Projects"],
  ["resource", "Resource", "Listed under Resources"],
  ["hidden", "Hidden", "Not shown on the site"],
];

async function loadOrgRepos({ fresh = false } = {}) {
  if (state.orgRepos && !fresh) return state.orgRepos;
  let repos = [];
  if (!fresh) {
    try {
      const snap = await (await fetch("data/github.json", { cache: "no-cache" })).json();
      repos = Array.isArray(snap.repos) ? snap.repos : [];
    } catch {
      /* no snapshot: ask GitHub below */
    }
  }
  if (!repos.length) {
    const res = await fetch(`https://api.github.com/orgs/${encodeURIComponent(window.GITHUB_ORG)}/repos?per_page=100&sort=pushed`, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-cache",
    });
    if (!res.ok) throw new Error(res.status === 403 ? "GitHub's hourly limit for this network is used up; try again later." : `GitHub answered ${res.status}.`);
    repos = await res.json();
  }
  state.orgRepos = repos.sort((a, b) => new Date(b.pushed_at || b.updated_at) - new Date(a.pushed_at || a.updated_at));
  return state.orgRepos;
}

async function renderReposPage(page) {
  root().innerHTML = `${pageHead(page, { search: false })}<p class="empty-note">Loading the organisation's repositories&hellip;</p>`;
  let repos;
  try {
    repos = await loadOrgRepos();
  } catch (err) {
    root().innerHTML = `${pageHead(page, { search: false })}<div class="empty-state"><p>Could not list the repositories: ${escapeHTML(err.message || "unknown error")}</p></div>`;
    return;
  }
  if (state.route !== "repos") return;
  renderSidebar(); // now that the count is known

  const saved = new Map(state.data.repo_kinds.map((r) => [r.repo_name, r]));
  const entry = (name) => saved.get(name) || {};
  const placeOf = (r) => entry(r.name).kind || (r.archived ? "hidden" : "project");
  const isPinned = (r) => placeOf(r) === "project" && entry(r.name).pinned;
  const pinnedRepos = repos.filter(isPinned).sort((a, b) => (entry(a.name).sort_order || 0) - (entry(b.name).sort_order || 0));
  // Pinned first, in their order, as on the site; then the rest by last push.
  const ordered = [...pinnedRepos, ...repos.filter((r) => !isPinned(r))];
  const filter = state.repoFilter || "all";
  const shown = ordered.filter((r) => filter === "all" || placeOf(r) === filter);
  const count = (kind) => repos.filter((r) => placeOf(r) === kind).length;
  const groups = state.data.study_groups || [];
  // Choices for repos that were renamed or deleted on GitHub.
  const orphans = state.data.repo_kinds.filter((r) => !repos.some((repo) => repo.name === r.repo_name));

  root().innerHTML = `
    ${pageHead(page, { count: repos.length, search: false })}
    <p class="page-intro">
      Every public repository in the organisation. Choose where each one shows:
      under <strong>Projects</strong>, under <strong>Resources</strong>, or nowhere.
      New repositories show as Projects, and archived ones are hidden, until you choose otherwise.
      Pinned projects come first on the site.
    </p>
    <div class="repo-toolbar">
      <div class="page-filters" role="group" aria-label="Show">
        ${[["all", `All (${repos.length})`], ...REPO_PLACES.map(([k, label]) => [k, `${k === "hidden" ? label : `${label}s`} (${count(k)})`])].map(([value, label]) => `
          <button type="button" class="chip${filter === value ? " is-active" : ""}" aria-pressed="${filter === value}" data-repo-filter="${value}">${label}</button>`).join("")}
      </div>
      <button type="button" class="btn" id="repo-refresh" title="Re-read the list from GitHub and redeploy the site">${icon("undo")}<span>Refresh now</span></button>
    </div>
    ${shown.length ? `<ol class="list repo-list">${shown.map((r) => {
      const place = placeOf(r);
      const choice = entry(r.name);
      const pinned = isPinned(r);
      const pinIndex = pinnedRepos.indexOf(r);
      return `
        <li class="list-row repo-row${place === "hidden" ? " is-hidden" : ""}" data-repo="${escapeAttr(r.name)}">
          <span class="list-thumb">${icon("github")}</span>
          <span class="list-open">
            <strong>
              <a href="${safeURL(r.html_url)}" target="_blank" rel="noopener">${escapeHTML(r.name)}</a>
              ${pinned ? '<span class="badge">Pinned</span>' : ""}
              ${r.archived ? '<span class="badge badge-muted" title="Archived on GitHub">Archived</span>' : ""}
            </strong>
            <span class="sub">${escapeHTML([r.language, r.description].filter(Boolean).join(" · ") || "No description")}</span>
            <span class="sub">Pushed ${escapeHTML(ago(r.pushed_at || r.updated_at))}${r.stargazers_count ? `, ★ ${r.stargazers_count}` : ""}</span>
            ${place === "resource" ? `
              <label class="repo-note">
                <span class="visually-hidden">Note for ${escapeHTML(r.name)}</span>
                <input type="text" data-repo-note maxlength="140" value="${escapeAttr(choice.note || "")}" placeholder="Why it is worth reading (shown when the repo has no description)" />
              </label>` : ""}
            ${place !== "hidden" ? `
              <span class="repo-extras">
                ${place === "project" ? `
                  <button type="button" class="btn btn-quiet" data-pin aria-pressed="${pinned}">${icon("bookmark")}<span>${pinned ? "Unpin" : "Pin to top"}</span></button>
                  ${pinned ? `
                    <button type="button" class="icon-btn" data-move="-1" aria-label="Move ${escapeAttr(r.name)} up"${pinIndex === 0 ? " disabled" : ""}>${icon("arrow-up")}</button>
                    <button type="button" class="icon-btn" data-move="1" aria-label="Move ${escapeAttr(r.name)} down"${pinIndex === pinnedRepos.length - 1 ? " disabled" : ""}>${icon("arrow-down")}</button>` : ""}` : ""}
                <label class="repo-group">
                  <span>Study group</span>
                  <select data-repo-group>
                    <option value="">None</option>
                    ${groups.map((g) => `<option value="${escapeAttr(g.id)}"${choice.group_id === g.id ? " selected" : ""}>${escapeHTML(g.name)}</option>`).join("")}
                  </select>
                </label>
              </span>` : ""}
          </span>
          <span class="repo-place" role="radiogroup" aria-label="Where ${escapeAttr(r.name)} shows">
            ${REPO_PLACES.map(([kind, label, hint]) => `
              <button type="button" role="radio" aria-checked="${place === kind}" title="${hint}" data-place="${kind}">${label}</button>`).join("")}
          </span>
        </li>`;
    }).join("")}</ol>` : '<div class="empty-state"><p>No repositories here.</p></div>'}
    ${orphans.length ? `
      <h2 class="page-subhead">No longer on GitHub</h2>
      <p class="field-help">These were renamed or deleted on GitHub, so the choice saved for them does nothing.</p>
      <ol class="list">${orphans.map((r) => `
        <li class="list-row" data-orphan="${escapeAttr(r.repo_name)}">
          <span class="list-thumb">${icon("archive")}</span>
          <span class="list-open"><strong>${escapeHTML(r.repo_name)}</strong><span class="sub">Saved as ${escapeHTML(r.kind)}</span></span>
          <button type="button" class="btn btn-danger" data-remove${isAdmin() ? "" : ' disabled title="Only admins can delete"'}>${icon("trash")}<span>Remove</span></button>
        </li>`).join("")}</ol>` : ""}`;

  const again = () => renderReposPage(page);
  const save = async (patches, message) => {
    try {
      await Promise.all(patches.map(([name, patch]) => saveRepoKind(name, patch)));
      await reload("repo_kinds");
      renderSidebar();
      again();
      if (message) toast(message, "success");
    } catch (err) {
      toast(err.message || "Could not save that.", "error");
    }
  };

  root().querySelectorAll("[data-repo-filter]").forEach((chip) =>
    chip.addEventListener("click", () => {
      state.repoFilter = chip.dataset.repoFilter;
      again();
    })
  );

  root().querySelector("#repo-refresh").addEventListener("click", async (e) => {
    const button = e.currentTarget;
    try {
      await busy(button, "Refreshing…", async () => {
        await loadOrgRepos({ fresh: true });
        await refreshSite();
      });
      toast("Re-read from GitHub. The site is redeploying and will match in about two minutes.", "success");
    } catch (err) {
      toast(err.message || "Could not refresh.", "error");
    }
    again();
  });

  root().querySelectorAll(".repo-row").forEach((row) => {
    const name = row.dataset.repo;
    const repo = repos.find((r) => r.name === name);
    row.querySelectorAll("[data-place]").forEach((button) =>
      button.addEventListener("click", () => {
        const kind = button.dataset.place;
        if (kind === placeOf(repo)) return;
        const label = REPO_PLACES.find(([k]) => k === kind)[2].toLowerCase();
        save([[name, { kind }]], `${name}: ${label}.`);
      })
    );
    const note = row.querySelector("[data-repo-note]");
    if (note) note.addEventListener("change", () => save([[name, { kind: "resource", note: note.value.trim() || null }]], `Saved the note for ${name}.`));

    const pin = row.querySelector("[data-pin]");
    if (pin) {
      pin.addEventListener("click", () => {
        const nowPinned = !isPinned(repo);
        const last = pinnedRepos.reduce((max, r) => Math.max(max, entry(r.name).sort_order || 0), -1);
        save([[name, nowPinned ? { kind: "project", pinned: true, sort_order: last + 1 } : { pinned: false }]],
          nowPinned ? `Pinned ${name} to the top of Projects.` : `Unpinned ${name}.`);
      });
    }
    row.querySelectorAll("[data-move]").forEach((button) =>
      button.addEventListener("click", () => {
        // Renumber the pins in their new order, so ties can never stick.
        const list = [...pinnedRepos];
        const i = list.indexOf(repo);
        const j = i + Number(button.dataset.move);
        [list[i], list[j]] = [list[j], list[i]];
        save(list.map((r, k) => [r.name, { sort_order: k }]));
      })
    );
    const group = row.querySelector("[data-repo-group]");
    if (group) {
      group.addEventListener("change", () => {
        const g = groups.find((x) => x.id === group.value);
        save([[name, { kind: placeOf(repo), group_id: group.value || null }]],
          g ? `${name} is now listed on ${g.name}.` : `${name} is no longer linked to a study group.`);
      });
    }
  });

  root().querySelectorAll("[data-orphan]").forEach((row) => {
    armedDelete(row.querySelector("[data-remove]"), async () => {
      try {
        await deleteRepoKind(row.dataset.orphan);
        await reload("repo_kinds");
        renderSidebar();
        again();
        toast(`Removed the saved choice for ${row.dataset.orphan}.`, "delete");
      } catch (err) {
        toast(err.message || "Could not remove it.", "error");
      }
    });
  });
}

/* ==================================================================
 * Subscribers: email lists per event, plus "all events"
 *
 * Visitors join from the public site and confirm by email; admins can
 * add addresses directly. Sending goes through the event-mail Edge
 * Function: an event's update reaches that event's list and the
 * all-events list; an "all events" update reaches everyone on any list.
 * ================================================================== */

const people = (n) => `${n} ${n === 1 ? "person" : "people"}`;

async function renderSubscribersPage(page) {
  root().innerHTML = `${pageHead(page, { search: false })}<p class="empty-note">Loading the lists&hellip;</p>`;
  let subs, sends;
  try {
    [subs, sends] = await Promise.all([listSubscriptions(), listEmailSends()]);
  } catch (err) {
    root().innerHTML = `${pageHead(page, { search: false })}<div class="empty-state"><p>Could not load the lists: ${escapeHTML(err.message || "unknown error")}.</p></div>`;
    return;
  }
  if (state.route !== "subscribers") return;

  const events = [...state.data.events].sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at));
  const list = events.some((e) => e.id === state.subsList) ? state.subsList : "all";
  const eventId = list === "all" ? null : list;
  const event = events.find((e) => e.id === eventId);
  const confirmed = subs.filter((s) => s.confirmed_at);
  const onList = subs.filter((s) => (s.event_id || null) === eventId);
  // Who a send reaches, one email per address.
  const reach = new Set(confirmed.filter((s) => !eventId || !s.event_id || s.event_id === eventId).map((s) => s.email)).size;
  const countFor = (id) => subs.filter((s) => (s.event_id || null) === id && s.confirmed_at).length;
  const listName = event ? `“${event.title}”` : "all events";
  const history = sends.filter((s) => !eventId || s.event_id === eventId);

  root().innerHTML = `
    ${pageHead(page, { count: new Set(confirmed.map((s) => s.email)).size, search: false })}
    <p class="page-intro">
      People who asked for email updates about events. Visitors sign up on the site and
      confirm by email; addresses you add here count straight away. Every email has an
      unsubscribe link.
    </p>
    <div class="field subs-picker">
      <label for="subs-list">List</label>
      <select id="subs-list">
        <option value="all">All events (${countFor(null)})</option>
        ${events.map((e) => `<option value="${escapeAttr(e.id)}"${list === e.id ? " selected" : ""}>${escapeHTML(e.title)}, ${escapeHTML(new Date(e.starts_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }))} (${countFor(e.id)})</option>`).join("")}
      </select>
    </div>

    <form class="subs-card" id="subs-compose" novalidate>
      <h2>Send an update</h2>
      <p class="field-help">${eventId
        ? `Goes to this event's list and the all-events list: <strong>${people(reach)}</strong>. The email shows the event's date and link.`
        : `Goes to everyone on any list: <strong>${people(reach)}</strong>.`}</p>
      <div class="field">
        <label for="subs-subject">Subject</label>
        <input id="subs-subject" maxlength="150" required value="${escapeAttr(event ? `Update: ${event.title}` : "")}" />
      </div>
      <div class="field">
        <label for="subs-body">Message</label>
        <textarea id="subs-body" rows="7" maxlength="20000" required placeholder="Plain text. Leave a blank line between paragraphs; links become clickable."></textarea>
      </div>
      <div class="subs-buttons">
        <button type="button" class="btn" id="subs-test">${icon("mail")}<span>Send a test to me</span></button>
        <button type="button" class="btn btn-primary" id="subs-send"${reach ? "" : " disabled"}>${icon("send")}<span>Send to ${people(reach)}</span></button>
      </div>
    </form>

    <form class="subs-card" id="subs-add" novalidate>
      <h2>On this list (${onList.length})</h2>
      <div class="field">
        <label for="subs-emails">Add people to ${escapeHTML(listName)}</label>
        <textarea id="subs-emails" rows="2" placeholder="one@example.com, two@example.com"></textarea>
        <p class="field-help">Separate addresses with commas or new lines. They are added without a confirmation email, so only add people who expect to hear from the club.</p>
      </div>
      <div class="subs-buttons"><button type="submit" class="btn">${icon("user-plus")}<span>Add</span></button></div>
      ${onList.length ? `<ol class="list subs-list">${onList.map((s) => `
        <li class="list-row" data-id="${escapeAttr(s.id)}">
          <span class="list-thumb">${icon("mail")}</span>
          <span class="list-open">
            <strong>${escapeHTML(s.email)}</strong>
            <span class="sub">${s.added_by ? "Added by an admin" : "Signed up on the site"}, ${escapeHTML(ago(s.created_at))}</span>
          </span>
          <span class="list-badges"><span class="badge${s.confirmed_at ? "" : " badge-muted"}">${s.confirmed_at ? "Subscribed" : "Not confirmed yet"}</span></span>
          <button type="button" class="btn btn-danger" data-remove aria-label="Remove ${escapeAttr(s.email)}">${icon("trash")}<span>Remove</span></button>
        </li>`).join("")}</ol>` : '<p class="empty-note">Nobody yet.</p>'}
    </form>

    <section class="subs-card">
      <h2>Sent (${history.length})</h2>
      ${history.length ? `<ol class="list">${history.map((s) => `
        <li class="list-row">
          <span class="list-thumb">${icon("send")}</span>
          <span class="list-open">
            <strong>${escapeHTML(s.title)}</strong>
            <span class="sub">${escapeHTML(who(s.sent_by_email))}, ${escapeHTML(ago(s.created_at))}, to ${people(s.recipients)}${s.failed ? `, ${s.failed} failed` : ""}</span>
          </span>
        </li>`).join("")}</ol>` : '<p class="empty-note">Nothing sent from this list yet.</p>'}
    </section>`;

  const again = () => renderSubscribersPage(page);
  root().querySelector("#subs-list").addEventListener("change", (e) => {
    state.subsList = e.target.value;
    again();
  });

  const compose = root().querySelector("#subs-compose");
  const draft = () => {
    const subject = compose.querySelector("#subs-subject").value.trim();
    const body = compose.querySelector("#subs-body").value.trim();
    if (!subject || !body) {
      toast("Write a subject and a message first.", "error");
      compose.querySelector(subject ? "#subs-body" : "#subs-subject").focus();
      return null;
    }
    return { event_id: eventId, subject, body };
  };
  const testButton = compose.querySelector("#subs-test");
  testButton.addEventListener("click", async () => {
    const payload = draft();
    if (!payload) return;
    try {
      await busy(testButton, "Sending…", () => eventMail("send", { ...payload, test: true }));
      toast(`Test sent to ${state.user.email}.`, "success");
    } catch (err) {
      toast(err.message || "Could not send the test.", "error");
    }
  });
  armedDelete(compose.querySelector("#subs-send"), async () => {
    const payload = draft();
    if (!payload) return;
    try {
      const { sent, failed } = await eventMail("send", payload);
      toast(`Sent to ${people(sent)}${failed ? `; ${failed} failed` : ""}.`, failed ? "error" : "success");
      again();
    } catch (err) {
      toast(err.message || "Could not send.", "error");
    }
  });

  const add = root().querySelector("#subs-add");
  add.addEventListener("submit", async (e) => {
    e.preventDefault();
    const raw = add.querySelector("#subs-emails").value.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    const bad = raw.filter((x) => !EMAIL_RE.test(x));
    if (!raw.length || bad.length) {
      toast(bad.length ? `Not an email address: ${bad.slice(0, 3).join(", ")}` : "Enter at least one email address.", "error");
      return;
    }
    const emails = [...new Set(raw)];
    try {
      const added = await busy(add.querySelector("[type=submit]"), "Adding…", () => addSubscribers(emails, eventId, state.user.id));
      const skipped = emails.length - added;
      toast(`Added ${added} to ${listName}${skipped ? `; ${skipped} already on it` : ""}.`, "success");
      again();
    } catch (err) {
      toast(err.message || "Could not add them.", "error");
    }
  });
  add.querySelectorAll("[data-remove]").forEach((button) => {
    const id = button.closest("[data-id]").dataset.id;
    armedDelete(button, async () => {
      try {
        await removeSubscription(id);
        toast("Removed from the list.", "delete");
        again();
      } catch (err) {
        toast(err.message || "Could not remove them.", "error");
      }
    });
  });
}

/* ==================================================================
 * Activity log, undo and trash
 * ================================================================== */

const TABLE_NOUNS = {
  events: "event", class_sessions: "session", resources: "resource",
  study_groups: "group", social_links: "link", core_members: "member",
  repo_kinds: "repo curation", profiles: "account", email_sends: "email",
};
const ACTION_VERBS = { create: "created", update: "edited", delete: "deleted", restore: "restored" };
const ACTION_ICONS = { create: "plus", update: "pencil", delete: "trash", restore: "undo" };

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function ago(iso) {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

const who = (email) => (email ? email.split("@")[0] : "Someone in the SQL editor");

/* "Last edited by ronit, 2 hours ago" under the drawer title. */
async function showLastChange(table, rowId) {
  const meta = document.getElementById("drawer-meta");
  if (!meta) return;
  meta.textContent = "";
  if (!table || rowId == null) return;
  try {
    const change = await lastChange(table, rowId);
    if (!change || !drawer.open) return;
    meta.textContent = `${ACTION_VERBS[change.action] === "created" ? "Created" : "Last edited"} by ${who(change.actor_email)}, ${ago(change.at)}`;
    meta.title = new Date(change.at).toLocaleString("en-GB");
  } catch {
    /* the log is a nicety here; the editor works without it */
  }
}

/* Re-insert the most recently deleted copy of a row. */
async function undoDelete(table, rowId, label) {
  try {
    await restoreDeleted(table, rowId);
    await reload(table);
    renderSidebar();
    renderPage();
    toast(`Restored ${label}.`, "success");
  } catch (err) {
    toast(err.message || "Could not restore.", "error");
  }
}

function rowExists(table, rowId) {
  const rows = state.data[table] || [];
  return rows.some((r) => String(r.id != null ? r.id : r.repo_name) === String(rowId));
}

async function renderActivityPage(page) {
  root().innerHTML = `
    ${pageHead(page, { search: false })}
    <p class="page-intro">
      Every change made in this panel or the database, newest first. Deleted
      items keep a full copy, so anything removed can be restored from here.
    </p>
    <div class="page-filters" role="group" aria-label="Show">
      ${[["all", "Everything"], ["delete", "Deleted"], ["restore", "Restored"]].map(([value, label]) => `
        <button type="button" class="chip${(state.activityFilter || "all") === value ? " is-active" : ""}"
                aria-pressed="${(state.activityFilter || "all") === value}" data-activity="${value}">${label}</button>`).join("")}
    </div>
    <div id="activity-body"><p class="empty-note">Loading the log&hellip;</p></div>`;

  root().querySelectorAll("[data-activity]").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.activityFilter = chip.dataset.activity;
      renderActivityPage(page);
    });
  });

  const body = root().querySelector("#activity-body");
  let entries;
  try {
    entries = await listActivity();
  } catch (err) {
    body.innerHTML = `<div class="empty-state"><p>Could not read the log: ${escapeHTML(err.message || "unknown error")}.</p></div>`;
    return;
  }
  if (state.route !== "activity") return;

  const filter = state.activityFilter || "all";
  const shown = entries.filter((e) => filter === "all" || e.action === filter);
  if (!shown.length) {
    body.innerHTML = `<div class="empty-state"><p>${filter === "all" ? "Nothing has changed yet." : "Nothing here."}</p></div>`;
    return;
  }

  body.innerHTML = `<ol class="list activity-list">${shown.map((e) => {
    const noun = TABLE_NOUNS[e.table_name] || e.table_name;
    const restorable = e.action === "delete" && e.table_name !== "profiles" && !rowExists(e.table_name, e.row_id);
    const fields = e.action === "update" && e.changed && e.changed.length ? `changed ${e.changed.join(", ")}` : "";
    return `
      <li class="list-row activity-row activity-${e.action}">
        <span class="list-thumb activity-icon">${icon(ACTION_ICONS[e.action] || "pencil")}</span>
        <span class="list-open">
          <strong>${escapeHTML(who(e.actor_email))} ${e.table_name === "email_sends" ? "sent" : ACTION_VERBS[e.action] || e.action} ${escapeHTML(noun)} ${escapeHTML(quoted(e.row_label))}</strong>
          <span class="sub"><time datetime="${escapeAttr(e.at)}" title="${escapeAttr(new Date(e.at).toLocaleString("en-GB"))}">${escapeHTML(ago(e.at))}</time>${fields ? `, ${escapeHTML(fields)}` : ""}</span>
        </span>
        ${restorable ? `<button type="button" class="btn" data-restore="${escapeAttr(e.table_name)}" data-row="${escapeAttr(e.row_id)}" data-label="${escapeAttr(`${noun} ${quoted(e.row_label)}`)}">${icon("undo")}<span>Restore</span></button>` : ""}
      </li>`;
  }).join("")}</ol>
  ${shown.length >= 300 ? '<p class="page-note">Showing the latest 300 changes.</p>' : ""}`;

  body.querySelectorAll("[data-restore]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      await undoDelete(button.dataset.restore, button.dataset.row, button.dataset.label);
    });
  });
}

/* ==================================================================
 * Member photos
 *
 * Picked photos are square-cropped and shrunk in the browser (480px
 * WebP, plus a 24px PNG for the pixel portrait), previewed as data:
 * URLs, and only uploaded when the drawer is saved, so a discarded
 * edit leaves nothing behind in Storage.
 * ================================================================== */

function photoFieldHTML(field, row, id) {
  const current = row.photo_url || "";
  const shown = current ? `<img src="${escapeAttr(current)}" alt="Current photo" width="72" height="72" />` : icon("image");
  return `
    <div class="field field-wide field-photo" data-photo-field>
      <span class="field-label">${escapeHTML(field.label)}</span>
      <div class="photo-row">
        <span class="photo-preview" data-photo-preview>${shown}</span>
        <div class="photo-actions">
          <label class="btn photo-pick">
            ${icon("upload")}<span data-photo-pick-label>${current ? "Replace photo" : "Upload photo"}</span>
            <input type="file" class="visually-hidden" accept="image/png,image/jpeg,image/webp"
                   data-photo-input aria-describedby="${id}-help ${id}-error" />
          </label>
          <button type="button" class="btn btn-quiet" data-photo-remove${current ? "" : " hidden"}>${icon("trash")}<span>Remove photo</span></button>
        </div>
      </div>
      <span class="field-help" id="${id}-help">${escapeHTML(field.help || "")}</span>
      <span class="field-error" id="${id}-error" data-error-for="photo_url" hidden></span>
      <input type="hidden" name="photo_url" value="${escapeAttr(current)}" />
      <input type="hidden" name="photo_thumb_url" value="${escapeAttr(row.photo_thumb_url || "")}" />
    </div>`;
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file is not an image this browser can read."));
    img.src = src;
  });
}

async function processPhoto(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Use a JPG, PNG or WebP image.");
  if (file.size > 15 * 1024 * 1024) throw new Error("That image is over 15 MB. Pick a smaller one.");
  const img = await loadImage(await readAsDataURL(file));

  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  const draw = (size) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    return canvas;
  };
  const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

  const big = draw(Math.min(480, side));
  const small = draw(24);
  // Browsers that cannot encode WebP hand back PNG; both are allowed.
  const full = await toBlob(big, "image/webp", 0.86);
  const thumb = await toBlob(small, "image/png");
  if (!full || !thumb) throw new Error("This browser could not process the image.");
  if (full.size > 1024 * 1024) throw new Error("That photo is still over 1 MB after shrinking.");
  return { full, thumb, fullURL: big.toDataURL(full.type, 0.86), thumbURL: small.toDataURL("image/png") };
}

function bindPhotoFields(form) {
  form.querySelectorAll("[data-photo-field]").forEach((field) => {
    const preview = field.querySelector("[data-photo-preview]");
    const input = field.querySelector("[data-photo-input]");
    const remove = field.querySelector("[data-photo-remove]");
    const error = field.querySelector("[data-error-for]");
    const changed = () => form.dispatchEvent(new Event("input", { bubbles: true }));

    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      input.value = "";
      if (!file) return;
      error.hidden = true;
      try {
        const photo = await processPhoto(file);
        form._photo = photo;
        form.elements.photo_url.value = photo.fullURL;
        form.elements.photo_thumb_url.value = photo.thumbURL;
        preview.innerHTML = `<img src="${photo.fullURL}" alt="New photo, not uploaded yet" width="72" height="72" />`;
        field.querySelector("[data-photo-pick-label]").textContent = "Replace photo";
        remove.hidden = false;
        changed();
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
      }
    });

    remove.addEventListener("click", () => {
      form._photo = null;
      form.elements.photo_url.value = "";
      form.elements.photo_thumb_url.value = "";
      preview.innerHTML = icon("image");
      field.querySelector("[data-photo-pick-label]").textContent = "Upload photo";
      remove.hidden = true;
      changed();
    });
  });
}

/* On save: a data: URL in photo_url means a picked photo that is not
 * uploaded yet. Upload it and swap in the real URLs. */
async function uploadPendingPhoto(values) {
  if (!values || !String(values.photo_url || "").startsWith("data:")) return;
  const form = document.getElementById("drawer-form");
  if (!form || !form._photo) throw new Error("The new photo was lost. Pick it again.");
  Object.assign(values, await uploadMemberPhoto(form._photo.full, form._photo.thumb));
  form._photo = null;
}

/* ==================================================================
 * Idle sign-out
 *
 * 30 minutes without a click, key, scroll or touch in any admin tab
 * signs you out, for shared and lab computers. A sticky toast warns two
 * minutes before. Activity is shared between tabs through localStorage.
 * ================================================================== */

const IDLE_MS = 30 * 60 * 1000;
const IDLE_WARN_MS = 2 * 60 * 1000;
const ACTIVE_KEY = "fcs-admin-last-active";

/* An admin removing or pausing someone signs them out at once: live
 * through Realtime, and again whenever the tab comes back into view (in
 * case the connection dropped while the laptop slept). */
function startAccessWatch(userId) {
  const changed = async (role) => {
    if (role === state.role) return;
    if (!role) return signOutBecause("removed");
    if (role === "pending") return signOutBecause("paused");
    state.role = role;
    document.getElementById("admin-identity").textContent = `${state.user.email} · ${role}`;
    toast(`An admin made you ${ROLE_LABELS[role].toLowerCase()}.`, "info", {
      sticky: true,
      action: { label: "Reload", run: () => location.reload() },
    });
  };
  try {
    watchMyAccess(userId, changed);
  } catch {
    /* no Realtime: the visibility check below still catches it */
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    getRole(userId, { strict: true }).then(changed, () => {
      /* offline for a moment; check again next time */
    });
  });
}

function startIdleWatch() {
  let lastWrite = 0;
  let warning = null;
  const mark = (force = false) => {
    const now = Date.now();
    if (!force && now - lastWrite < 5000) return;
    lastWrite = now;
    try {
      localStorage.setItem(ACTIVE_KEY, String(now));
    } catch {
      /* private mode: this tab still tracks itself */
    }
  };
  ["pointerdown", "keydown", "wheel", "touchstart"].forEach((type) =>
    addEventListener(type, () => mark(), { passive: true })
  );
  mark(true);

  setInterval(async () => {
    // The shared value is the truth: any tab's activity keeps all tabs in.
    let last = lastWrite;
    try {
      last = Number(localStorage.getItem(ACTIVE_KEY)) || lastWrite;
    } catch {
      /* no storage: this tab's own time */
    }
    const idle = Date.now() - last;

    if (idle >= IDLE_MS) {
      await signOutBecause("idle");
    } else if (idle >= IDLE_MS - IDLE_WARN_MS && !warning) {
      warning = toast("No activity for 28 minutes. You will be signed out in 2 minutes.", "info", {
        sticky: true,
        action: { label: "Stay signed in", run: () => mark(true) },
      });
    } else if (idle < IDLE_MS - IDLE_WARN_MS && warning) {
      dismiss(warning);
      warning = null;
    }
  }, 15000);
}
