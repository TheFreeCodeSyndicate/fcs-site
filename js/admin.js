/*
 * js/admin.js
 * ------------------------------------------------------------------
 * The admin panel. A module, so it imports the same library and
 * adapter the public page uses — a change to event semantics cannot
 * be applied to only one of the two surfaces.
 * ------------------------------------------------------------------
 */

import {
  isConfigured,
  getClientOrThrow,
  getSession,
  getRole,
  signIn,
  signOut,
  createEvent,
  updateEvent,
  deleteEvent,
  createClassSession,
  updateClassSession,
  deleteClassSession,
  createResource,
  updateResource,
  deleteResource,
  createStudyGroup,
  updateStudyGroup,
  deleteStudyGroup,
  createSocialLink,
  updateSocialLink,
  deleteSocialLink,
  saveRepoKind,
  deleteRepoKind,
} from "./supabase.js";
import { nextOccurrence } from "./lib/schedule.js";
import { toLocalInputValue, fromLocalInputValue, formatDateTimeLocal } from "./lib/forms.js";

const STAGES = ["draft", "scheduled", "live", "done"];

const state = {
  user: null,
  role: null,
  events: [],
  classSessions: [],
  resources: [],
  studyGroups: [],
  socialLinks: [],
  repoKinds: [],
  activeTab: "class-schedule",
  editingId: null,
};

const root = () => document.getElementById("admin-root");

function escapeHTML(value) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}

/* innerHTML escapes & < > but NOT " or '. Every interpolation that
 * lands inside an attribute must go through this instead. */
function escapeAttr(value) {
  return escapeHTML(value).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function toast(message, tone) {
  const el = document.getElementById("admin-toast");
  if (!el) return;
  el.textContent = message;
  el.dataset.tone = tone === "error" ? "error" : "ok";
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    el.hidden = true;
  }, 3200);
}

async function readTable(name, order) {
  const { data, error } = await getClientOrThrow()
    .from(name)
    .select("*")
    .order(order || "sort_order");
  if (error) throw error;
  return data || [];
}

const deleteAttrs = () => (state.role === "admin" ? "" : ' disabled title="Admin role required"');

document.addEventListener("DOMContentLoaded", boot);

async function boot() {
  const signout = document.getElementById("admin-signout");
  if (signout) {
    signout.addEventListener("click", () => signOut().then(() => location.reload()));
  }

  if (!isConfigured()) {
    root().innerHTML = `
      <div class="admin-login">
        <h1>Admin panel</h1>
        <p>Supabase is not configured yet.</p>
        <p>Set <code>supabaseUrl</code> and <code>supabaseAnonKey</code> in
           <code>js/config.js</code>, then reload this page.</p>
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

async function onSignedIn(user) {
  const role = await getRole(user.id);
  if (!role) {
    // A real sign-out, not a soft screen: otherwise the session survives a
    // reload and the account sits half-authenticated with no way forward.
    await signOut().catch(() => {});

    root().innerHTML = `
      <div class="admin-login">
        <h1>No access</h1>
        <p>Your account exists but has no <code>profiles</code> row, so it has
           no role and cannot edit anything.</p>
        <p>You have been signed out. Ask an admin to run:</p>
        <p><code>insert into public.profiles (id, email, role)
           select id, email, 'editor' from auth.users where email = '${escapeHTML(user.email)}';</code></p>
        <button type="button" class="btn" id="back-to-login">Back to sign in</button>
      </div>`;
    root().querySelector("#back-to-login").addEventListener("click", renderLogin);
    return;
  }

  state.user = user;
  state.role = role;

  const identity = document.getElementById("admin-identity");
  if (identity) identity.textContent = `${user.email} · ${role}`;
  const signout = document.getElementById("admin-signout");
  if (signout) signout.hidden = false;

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

  root().innerHTML = `
    <div class="admin-toolbar">
      <h1>Events</h1>
      <button type="button" class="btn btn-primary" id="new-event">New event</button>
    </div>
    <div class="board" id="board"></div>
    <div id="edit-panel" hidden></div>
    <div class="admin-tabs" id="admin-tabs" role="tablist"></div>
    <div id="tab-panel" role="tabpanel"></div>`;

  root().querySelector("#new-event").addEventListener("click", () => openEventEditor(null));
  renderBoard();
  renderTabs();
  renderActiveTab();
}

async function loadAll() {
  const [events, classSessions, resources, studyGroups, socialLinks, repoKinds] = await Promise.all([
    readTable("events", "starts_at"),
    readTable("class_sessions"),
    readTable("resources"),
    readTable("study_groups"),
    readTable("social_links"),
    readTable("repo_kinds", "repo_name"),
  ]);
  state.events = events;
  state.classSessions = classSessions;
  state.resources = resources;
  state.studyGroups = studyGroups;
  state.socialLinks = socialLinks;
  state.repoKinds = repoKinds;
}

/* ---- Kanban board --------------------------------------------------- */

/* Manual order first, then time, so a dragged sequence survives reload. */
function eventsInStage(stage) {
  return state.events
    .filter((e) => e.stage === stage)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.starts_at).localeCompare(String(b.starts_at)));
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
          ${
            inStage.length
              ? inStage.map(eventCardAdminHTML).join("")
              : `<p class="card-empty">Nothing here yet.</p>`
          }
        </div>
      </div>`;
  }).join("");

  bindBoard();
}

function eventCardAdminHTML(event) {
  return `
    <article class="card" data-id="${escapeAttr(event.id)}" tabindex="0" role="button"
             aria-label="Edit ${escapeAttr(event.title)}">
      <h4>${escapeHTML(event.title)}</h4>
      <p class="card-meta">${escapeHTML(formatDateTimeLocal(event.starts_at))}</p>
      ${event.group_name ? `<p class="card-meta">${escapeHTML(event.group_name)}</p>` : ""}
    </article>`;
}

async function onCardDropped(evt) {
  const id = evt.item.dataset.id;
  const target = evt.to; // onEnd fires on the SOURCE list; the destination is evt.to
  const stage = target.dataset.stage;
  const previous = state.events.map((e) => ({ ...e }));
  const ids = Array.from(target.querySelectorAll(".card")).map((card) => card.dataset.id);

  // Optimistic: apply the move and the new order now, revert if a write fails.
  state.events = state.events.map((e) => {
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
    state.events = previous;
    renderBoard();
    toast(err.message || "Could not move the event.", "error");
  }
}

function bindBoard() {
  document.querySelectorAll(".board-dropzone").forEach((zone) => {
    // Without Sortable the board still works: each card's edit form has a
    // stage dropdown, which is also the keyboard-accessible path.
    if (window.Sortable) {
      new window.Sortable(zone, {
        group: "board",
        draggable: ".card",
        animation: 150,
        onEnd: onCardDropped,
      });
    }

    zone.addEventListener("click", (evt) => {
      const card = evt.target.closest(".card");
      if (card) openEventEditor(card.dataset.id);
    });
    zone.addEventListener("keydown", (evt) => {
      if (evt.key !== "Enter" && evt.key !== " ") return;
      const card = evt.target.closest(".card");
      if (!card) return;
      evt.preventDefault();
      openEventEditor(card.dataset.id);
    });
  });
}

/* ---- Event editor --------------------------------------------------- */

function closeEventEditor() {
  const panel = document.getElementById("edit-panel");
  if (!panel) return;
  panel.hidden = true;
  panel.innerHTML = "";
}

function openEventEditor(id) {
  const event = id ? state.events.find((e) => e.id === id) : null;
  if (id && !event) return;

  const panel = document.getElementById("edit-panel");
  if (!panel) return;
  panel.hidden = false;

  const v = (key, fallback = "") => escapeAttr((event && event[key]) || fallback);

  panel.innerHTML = `
    <h2>${event ? "Edit event" : "New event"}</h2>
    <form class="form-grid" id="event-form">
      <label class="field">Title
        <input name="title" required value="${v("title")}" />
      </label>
      <label class="field">Group
        <input name="group_name" value="${v("group_name")}" />
      </label>
      <label class="field">Starts at
        <input name="starts_at" type="datetime-local" required
               value="${escapeAttr(toLocalInputValue(event && event.starts_at))}" />
      </label>
      <label class="field">Duration (minutes)
        <input name="duration_minutes" type="number" min="5" step="5" value="${v("duration_minutes", 60)}" />
      </label>
      <label class="field">Stage
        <select name="stage">
          ${STAGES.map(
            (s) => `<option value="${s}" ${(event ? event.stage : "draft") === s ? "selected" : ""}>${s}</option>`
          ).join("")}
        </select>
      </label>
      <label class="field">Link label
        <input name="link_text" value="${v("link_text")}" />
      </label>
      <label class="field">Link URL
        <input name="link" type="url" value="${v("link")}" />
      </label>
      <label class="field field-wide">Details
        <textarea name="details" rows="3">${escapeHTML((event && event.details) || "")}</textarea>
      </label>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">Save</button>
        ${event ? `<button type="button" class="btn btn-danger" id="delete-event"${deleteAttrs()}>Delete</button>` : ""}
        <button type="button" class="btn" id="cancel-edit">Cancel</button>
      </div>
    </form>`;

  panel.querySelector("input[name='title']").focus();

  panel.querySelector("#event-form").addEventListener("submit", async (evt) => {
    evt.preventDefault();
    const form = new FormData(evt.target);
    const patch = {
      title: String(form.get("title") || "").trim(),
      group_name: String(form.get("group_name") || "").trim() || null,
      details: String(form.get("details") || "").trim() || null,
      starts_at: fromLocalInputValue(form.get("starts_at")),
      duration_minutes: Number(form.get("duration_minutes")) || 60,
      stage: String(form.get("stage") || "draft"),
      link: String(form.get("link") || "").trim() || null,
      link_text: String(form.get("link_text") || "").trim() || null,
    };

    if (!patch.title || !patch.starts_at) {
      toast("A title and a start time are required.", "error");
      return;
    }

    try {
      if (event) await updateEvent(event.id, patch);
      else await createEvent(patch);
      closeEventEditor();
      state.events = await readTable("events", "starts_at");
      renderBoard();
      toast(event ? "Event saved." : "Event created.");
    } catch (err) {
      toast(err.message || "Could not save the event.", "error");
    }
  });

  panel.querySelector("#cancel-edit").addEventListener("click", closeEventEditor);

  const remove = panel.querySelector("#delete-event");
  if (remove) {
    remove.addEventListener("click", async () => {
      if (!confirm(`Delete "${event.title}"? This cannot be undone.`)) return;
      try {
        await deleteEvent(event.id);
        closeEventEditor();
        state.events = await readTable("events", "starts_at");
        renderBoard();
        toast("Event deleted.");
      } catch (err) {
        toast(err.message || "Could not delete. Admin role required.", "error");
      }
    });
  }
}

/* ---- Tabs and the field-schema editors ------------------------------ */

const TABS = [
  { id: "class-schedule", label: "Class schedule" },
  { id: "resources", label: "Resources" },
  { id: "study-groups", label: "Study groups" },
  { id: "social-links", label: "Social links" },
  { id: "repo-kinds", label: "Repo curation" },
];

const WEEKDAYS = (window.FCS_CONFIG && window.FCS_CONFIG.weekdays) || [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

/* One entry per tab: its fields, how a row is summarised, and the named
 * write operations — so the submit handler never switches on a table
 * name string. */
const EDITORS = {
  "class-schedule": {
    table: "class_sessions",
    stateKey: "classSessions",
    intro: "A recurring weekly session. The public countdown picks the next occurrence automatically.",
    title: (r) => r.title,
    subtitle: (r) => {
      const next = nextOccurrence(r, new Date());
      return `${WEEKDAYS[r.weekday] || "?"} ${String(r.start_time || "").slice(0, 5)} · next: ${
        next ? formatDateTimeLocal(next.toISOString()) : "inactive"
      }`;
    },
    fields: [
      { name: "title", label: "Title", type: "text", required: true },
      { name: "group_name", label: "Group", type: "text" },
      { name: "weekday", label: "Weekday", type: "weekday" },
      { name: "start_time", label: "Start time", type: "time", required: true },
      { name: "duration_minutes", label: "Duration (min)", type: "number" },
      { name: "link", label: "Link", type: "url" },
      { name: "is_active", label: "Active", type: "checkbox" },
    ],
    normalise: (values) => ({
      ...values,
      weekday: Number(values.weekday),
      start_time: String(values.start_time || "").slice(0, 5),
      duration_minutes: Number(values.duration_minutes) || 60,
    }),
    create: createClassSession,
    update: updateClassSession,
    remove: deleteClassSession,
  },
  resources: {
    table: "resources",
    stateKey: "resources",
    title: (r) => r.title,
    subtitle: (r) => `${r.kind} · ${r.url}${r.is_published === false ? " · hidden" : ""}`,
    fields: [
      { name: "title", label: "Title", type: "text", required: true },
      { name: "kind", label: "Kind", type: "select", options: ["notes", "video", "paper", "course", "tool", "book"] },
      { name: "url", label: "URL", type: "url", required: true },
      { name: "summary", label: "Summary", type: "text" },
      { name: "group_name", label: "Group", type: "text" },
      { name: "is_published", label: "Published", type: "checkbox" },
    ],
    create: createResource,
    update: updateResource,
    remove: deleteResource,
  },
  "study-groups": {
    table: "study_groups",
    stateKey: "studyGroups",
    title: (r) => r.name,
    subtitle: (r) => `${r.status} · ${r.topic}${r.is_published === false ? " · hidden" : ""}`,
    fields: [
      { name: "name", label: "Name", type: "text", required: true },
      { name: "topic", label: "Topic", type: "text", required: true },
      { name: "status", label: "Status", type: "select", options: ["Active", "Forming", "Paused", "Completed"] },
      { name: "link", label: "Link", type: "url" },
      { name: "link_text", label: "Link label", type: "text" },
      { name: "is_published", label: "Published", type: "checkbox" },
    ],
    create: createStudyGroup,
    update: updateStudyGroup,
    remove: deleteStudyGroup,
  },
  "social-links": {
    table: "social_links",
    stateKey: "socialLinks",
    title: (r) => r.label,
    subtitle: (r) => `${r.platform} · ${r.url}${r.is_published === false ? " · hidden" : ""}`,
    fields: [
      { name: "platform", label: "Platform", type: "select", options: ["discord", "instagram", "whatsapp", "github", "x", "web"] },
      { name: "label", label: "Label", type: "text", required: true },
      { name: "url", label: "URL", type: "url", required: true },
      { name: "hint", label: "Hint", type: "text" },
      { name: "is_published", label: "Published", type: "checkbox" },
    ],
    create: createSocialLink,
    update: updateSocialLink,
    remove: deleteSocialLink,
  },
  "repo-kinds": {
    table: "repo_kinds",
    stateKey: "repoKinds",
    order: "repo_name",
    key: "repo_name", // keyed by name, not id
    intro:
      "Move a GitHub repository between Projects and Resources. Anything not listed here is a Project, so a newly pushed repo needs no entry.",
    title: (r) => r.repo_name,
    subtitle: (r) => `${r.kind}${r.note ? " · " + r.note : ""}`,
    fields: [
      { name: "repo_name", label: "Repository name", type: "text", required: true, lockOnEdit: true },
      { name: "kind", label: "Kind", type: "select", options: ["project", "resource"] },
      { name: "note", label: "Note", type: "text" },
    ],
    // Upsert: create and update are the same operation.
    create: ({ repo_name, ...rest }) => saveRepoKind(repo_name, rest),
    update: (repoName, { repo_name, ...rest }) => saveRepoKind(repoName, rest),
    remove: deleteRepoKind,
  },
};

const rowKey = (editor, row) => row[editor.key || "id"];

function renderTabs() {
  const tabs = document.getElementById("admin-tabs");
  if (!tabs) return;

  tabs.innerHTML = TABS.map(
    (tab) =>
      `<button type="button" role="tab" class="admin-tab" data-tab="${tab.id}"
               aria-selected="${tab.id === state.activeTab}">${tab.label}</button>`
  ).join("");

  tabs.querySelectorAll(".admin-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeTab = button.dataset.tab;
      state.editingId = null;
      renderTabs();
      renderActiveTab();
    });
  });
}

function fieldHTML(field, value, editing) {
  const name = field.name;

  if (field.type === "checkbox") {
    // Every checkbox column defaults to true, so a missing value is checked.
    return `<label class="checkbox-row"><input type="checkbox" name="${name}"${
      value !== false ? " checked" : ""
    } /> ${field.label}</label>`;
  }

  if (field.type === "select" || field.type === "weekday") {
    const options =
      field.type === "weekday"
        ? WEEKDAYS.map((label, i) => [String(i), label])
        : field.options.map((o) => [o, o]);
    const selected = value == null ? options[0][0] : String(value);
    return `<label class="field">${field.label}
      <select name="${name}">${options
        .map(([val, label]) => `<option value="${val}"${val === selected ? " selected" : ""}>${label}</option>`)
        .join("")}</select>
    </label>`;
  }

  return `<label class="field">${field.label}
    <input name="${name}" type="${field.type}"${field.required ? " required" : ""}${
      field.lockOnEdit && editing ? " readonly" : ""
    } value="${escapeAttr(value == null ? "" : value)}" />
  </label>`;
}

function renderActiveTab() {
  const panel = document.getElementById("tab-panel");
  const editor = EDITORS[state.activeTab];
  if (!panel || !editor) return;

  const rows = state[editor.stateKey] || [];
  const editing = state.editingId;
  const row = editing ? rows.find((r) => rowKey(editor, r) === editing) : null;

  panel.innerHTML = `
    ${editor.intro ? `<p class="empty-note">${escapeHTML(editor.intro)}</p>` : ""}
    <h3>${editing ? "Edit row" : "Add a row"}</h3>
    <form class="form-grid" id="row-form">
      ${editor.fields.map((field) => fieldHTML(field, row ? row[field.name] : undefined, editing)).join("")}
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${editing ? "Save changes" : "Add"}</button>
        ${editing ? `<button type="button" class="btn" data-action="cancel-edit">Cancel</button>` : ""}
      </div>
    </form>
    <div class="editor-list">
      ${
        rows.length
          ? rows
              .map(
                (r) => `
        <div class="editor-row${rowKey(editor, r) === editing ? " is-editing" : ""}" data-key="${escapeAttr(rowKey(editor, r))}">
          <span class="grow">
            <strong>${escapeHTML(editor.title(r))}</strong>
            <span class="sub">${escapeHTML(editor.subtitle(r))}</span>
          </span>
          <button type="button" class="btn" data-action="edit">Edit</button>
          <button type="button" class="btn btn-danger" data-action="delete"${deleteAttrs()}>Delete</button>
        </div>`
              )
              .join("")
          : `<p class="card-empty">Nothing here yet.</p>`
      }
    </div>`;

  bindTabPanel(editor);
}

function collectForm(form) {
  const data = new FormData(form);
  const out = {};
  for (const [key, value] of data.entries()) {
    out[key] = typeof value === "string" && value.trim() === "" ? null : value;
  }
  form.querySelectorAll('input[type="checkbox"]').forEach((box) => {
    out[box.name] = box.checked;
  });
  return out;
}

async function reloadTab(editor) {
  state[editor.stateKey] = await readTable(editor.table, editor.order);
  state.editingId = null;
  renderActiveTab();
}

function bindTabPanel(editor) {
  const form = document.getElementById("row-form");
  form.addEventListener("submit", async (evt) => {
    evt.preventDefault();
    const editing = state.editingId;
    let values = collectForm(form);
    if (editor.normalise) values = editor.normalise(values);

    try {
      if (editing) await editor.update(editing, values);
      else await editor.create(values);
      await reloadTab(editor);
      toast(editing ? "Changes saved." : "Saved.");
    } catch (err) {
      toast(err.message || "Could not save.", "error");
    }
  });

  const cancel = document.querySelector("[data-action='cancel-edit']");
  if (cancel) {
    cancel.addEventListener("click", () => {
      state.editingId = null;
      renderActiveTab();
    });
  }

  document.querySelectorAll(".editor-row [data-action='edit']").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingId = button.closest(".editor-row").dataset.key;
      renderActiveTab();
      const first = document.querySelector("#row-form input:not([readonly]), #row-form select");
      if (first) first.focus();
    });
  });

  document.querySelectorAll(".editor-row [data-action='delete']").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("Delete this row? This cannot be undone.")) return;
      try {
        await editor.remove(button.closest(".editor-row").dataset.key);
        await reloadTab(editor);
        toast("Deleted.");
      } catch (err) {
        toast(err.message || "Could not delete. Admin role required.", "error");
      }
    });
  });
}
