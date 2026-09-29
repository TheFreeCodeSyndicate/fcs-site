/*
 * js/supabase.js
 * ------------------------------------------------------------------
 * The only module that talks to Supabase. Every function is a narrow,
 * named operation — the UI never receives a query builder, so there
 * is exactly one place to audit.
 *
 * The site never hard-depends on the database: every public read
 * falls back to the seed data in data.js.
 * ------------------------------------------------------------------
 */

/** @returns {boolean} whether a project has been configured */
export function isConfigured() {
  const config = window.FCS_CONFIG || {};
  return Boolean(config.supabaseUrl && config.supabaseAnonKey);
}

let client = null;

/** @returns {object|null} the vendored Supabase client, or null if unconfigured */
export function getClient() {
  if (client) return client;
  if (!isConfigured()) return null;
  const factory = window.supabase && window.supabase.createClient;
  if (!factory) return null;
  // RULE 2: the project key goes in the `apikey` header and the
  // signed-in user's token goes in `Authorization`. The client library
  // keeps those two apart. Sending a user token as the API key is
  // rejected outright with {"message":"Invalid API key"}.
  client = factory(window.FCS_CONFIG.supabaseUrl, window.FCS_CONFIG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return client;
}

/** @returns {object} the client, or throws if the project is not configured */
export function getClientOrThrow() {
  const supabase = getClient();
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

/** Named in the spec's data-flow diagram. Idempotent. */
export function connect() {
  return getClient();
}

/* ---- public reads: fall back to seed data on any failure ------------
 *
 * The `|| fallback` must be applied BEFORE filtering. `readTable`
 * returns null when Supabase is unconfigured; `null.filter` throws and
 * `([]).filter` returns an empty section — either way the seed data is
 * lost and the page silently goes blank.
 * ------------------------------------------------------------------ */

async function readTable(table, order = "sort_order") {
  const supabase = getClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from(table).select("*").order(order);
  if (error) throw error;
  return data || [];
}

export async function getEvents(fallback) {
  try { return (await readTable("events", "starts_at")) || fallback || []; }
  catch { return fallback || []; }
}

export async function getClassSessions(fallback) {
  try { return (await readTable("class_sessions")) || fallback || []; }
  catch { return fallback || []; }
}

export async function getResources(fallback) {
  try { return ((await readTable("resources")) || fallback || []).filter((r) => r.is_published !== false); }
  catch { return fallback || []; }
}

export async function getStudyGroups(fallback) {
  try { return ((await readTable("study_groups")) || fallback || []).filter((g) => g.is_published !== false); }
  catch { return fallback || []; }
}

export async function getSocialLinks(fallback) {
  try { return ((await readTable("social_links")) || fallback || []).filter((l) => l.is_published !== false); }
  catch { return fallback || []; }
}

/* Published core members, active and alumni both: the page shows
 * alumni in their own collapsed list. */
export async function getCoreMembers(fallback) {
  try { return ((await readTable("core_members")) || fallback || []).filter((m) => m.is_published !== false); }
  catch { return fallback || []; }
}

export async function getRepoKinds() {
  try { return (await readTable("repo_kinds", "repo_name")) || []; }
  catch { return []; }
}

/* ---- session and roles ---------------------------------------------- */

export async function getSession() {
  const supabase = getClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return (data && data.session) || null;
}

export async function signIn(email, password) {
  const { data, error } = await getClientOrThrow().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

export async function signOut() {
  const supabase = getClient();
  if (supabase) await supabase.auth.signOut();
}

/* Sends a password-reset email. The link returns to this page, where
 * supabase-js reads the recovery token from the URL and signs the
 * user in for the single purpose of choosing a new password. The page
 * must be listed under Authentication > URL Configuration > Redirect URLs. */
export async function requestPasswordReset(email, redirectTo) {
  const { error } = await getClientOrThrow().auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

export async function updatePassword(password) {
  const { data, error } = await getClientOrThrow().auth.updateUser({ password });
  if (error) throw error;
  return data.user;
}

/** strict: throw on a network or database error instead of answering
 * null, so a hiccup is never mistaken for "this account was removed".
 * @returns {Promise<"admin"|"editor"|"pending"|null>} null = no profile */
export async function getRole(userId, { strict = false } = {}) {
  const supabase = getClient();
  if (!supabase || !userId) return null;
  const { data, error } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (error) {
    if (strict) throw error;
    return null;
  }
  return (data && data.role) || null;
}

/* Calls onChange(role) the moment an admin changes this person's role,
 * or onChange(null) when they remove them (migration 010 publishes
 * profiles to Realtime). Deletes cannot be filtered server-side, so the
 * id is compared here; under RLS a delete event carries only the id. */
export function watchMyAccess(userId, onChange) {
  return getClientOrThrow()
    .channel(`access-${userId}`)
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "profiles" }, (change) => {
      if (change.old && change.old.id === userId) onChange(null);
    })
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${userId}` }, (change) =>
      onChange(change.new.role)
    )
    .subscribe();
}

/* ---- admin writes --------------------------------------------------
 *
 * Named per table rather than generic, so the UI can never address a
 * table it should not touch. `repo_kinds` is keyed by repo_name, not
 * id, so it gets its own operations.
 *
 * RULE 1 lives here: a write refused by RLS comes back as a SUCCESSFUL
 * response with zero rows, not as an error. Verified against the live
 * database — an editor's DELETE returned HTTP 204 and the row survived.
 * So every write asks for the affected rows back and treats an empty
 * result as a refusal. Without this the panel reports "deleted" while
 * nothing happened, every time.
 * ------------------------------------------------------------------ */

const WRITE_OPTS = { count: "exact" };

async function write(operation) {
  const { data, error } = await operation(getClientOrThrow());
  if (error) throw error;
  return data;
}

/** Throws when RLS refused the write by matching zero rows. */
function assertChanged(rows, what) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) {
    throw new Error(
      `${what} was refused: your role does not have permission. No rows were changed.`
    );
  }
  return list.length === 1 ? list[0] : list;
}

export const createEvent = (patch) =>
  write((s) => s.from("events").insert(patch).select().single());

export const updateEvent = (id, patch) =>
  write((s) => s.from("events").update(patch).eq("id", id).select())
    .then((rows) => assertChanged(rows, "Updating the event"));

export const deleteEvent = (id) =>
  write((s) => s.from("events").delete(WRITE_OPTS).eq("id", id).select())
    .then((rows) => assertChanged(rows, "Deleting the event"));

export const createClassSession = (patch) =>
  write((s) => s.from("class_sessions").insert(patch).select().single());

export const updateClassSession = (id, patch) =>
  write((s) => s.from("class_sessions").update(patch).eq("id", id).select())
    .then((rows) => assertChanged(rows, "Updating the class session"));

export const deleteClassSession = (id) =>
  write((s) => s.from("class_sessions").delete(WRITE_OPTS).eq("id", id).select())
    .then((rows) => assertChanged(rows, "Deleting the class session"));

export const createResource = (patch) =>
  write((s) => s.from("resources").insert(patch).select().single());

export const updateResource = (id, patch) =>
  write((s) => s.from("resources").update(patch).eq("id", id).select())
    .then((rows) => assertChanged(rows, "Updating the resource"));

export const deleteResource = (id) =>
  write((s) => s.from("resources").delete(WRITE_OPTS).eq("id", id).select())
    .then((rows) => assertChanged(rows, "Deleting the resource"));

export const createStudyGroup = (patch) =>
  write((s) => s.from("study_groups").insert(patch).select().single());

export const updateStudyGroup = (id, patch) =>
  write((s) => s.from("study_groups").update(patch).eq("id", id).select())
    .then((rows) => assertChanged(rows, "Updating the study group"));

export const deleteStudyGroup = (id) =>
  write((s) => s.from("study_groups").delete(WRITE_OPTS).eq("id", id).select())
    .then((rows) => assertChanged(rows, "Deleting the study group"));

export const createSocialLink = (patch) =>
  write((s) => s.from("social_links").insert(patch).select().single());

export const updateSocialLink = (id, patch) =>
  write((s) => s.from("social_links").update(patch).eq("id", id).select())
    .then((rows) => assertChanged(rows, "Updating the social link"));

export const deleteSocialLink = (id) =>
  write((s) => s.from("social_links").delete(WRITE_OPTS).eq("id", id).select())
    .then((rows) => assertChanged(rows, "Deleting the social link"));

export const createCoreMember = (patch) =>
  write((s) => s.from("core_members").insert(patch).select().single());

export const updateCoreMember = (id, patch) =>
  write((s) => s.from("core_members").update(patch).eq("id", id).select())
    .then((rows) => assertChanged(rows, "Updating the core member"));

export const deleteCoreMember = (id) =>
  write((s) => s.from("core_members").delete(WRITE_OPTS).eq("id", id).select())
    .then((rows) => assertChanged(rows, "Deleting the core member"));

/* ---- team (admins only; RLS returns just your own row otherwise) --- */

export async function listProfiles() {
  const { data, error } = await getClientOrThrow()
    .from("profiles")
    .select("id, email, display_name, role, created_at")
    .order("created_at");
  if (error) throw error;
  return data || [];
}

/* The guard_profile_update trigger (migration 003) refuses role
 * changes by non-admins and removing the last admin; its message comes
 * back as the error. */
export const setProfileRole = (id, role) =>
  write((s) => s.from("profiles").update({ role }).eq("id", id).select())
    .then((rows) => assertChanged(rows, "Changing the role"));

/* Deletes the person's login entirely (migration 009); admins only,
 * and never yourself. Their profile goes with it. */
export async function removeMember(id) {
  const { error } = await getClientOrThrow().rpc("remove_member", { target: id });
  if (error) throw error;
}

/* ---- invites (Edge Function supabase/functions/invite-member) -------
 *
 * The function checks the caller is an admin, sends Supabase's invite
 * email and sets the new account's role. The service-role key it uses
 * never leaves Supabase. */
export const inviteMember = (email, role, redirectTo) =>
  invokeFunction("invite-member", { email, role, redirectTo });

/* ---- event email updates (Edge Function supabase/functions/event-mail)
 *
 * subscribe / lookup / confirm / unsubscribe work for anyone; send is
 * admins only. Lists are read and edited directly (migration 011). */
export const eventMail = (action, payload = {}) => invokeFunction("event-mail", { action, ...payload });

export async function listSubscriptions() {
  const { data, error } = await getClientOrThrow()
    .from("subscriptions")
    .select("id, email, event_id, confirmed_at, added_by, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

/* Admin adds count as confirmed straight away. Addresses already on the
 * list are skipped rather than failing the whole batch. */
export async function addSubscribers(emails, eventId, adminId) {
  const now = new Date().toISOString();
  const rows = emails.map((email) => ({ email, event_id: eventId, confirmed_at: now, added_by: adminId }));
  const { data, error } = await getClientOrThrow()
    .from("subscriptions")
    .upsert(rows, { onConflict: "email,event_id", ignoreDuplicates: true })
    .select("id");
  if (error) throw error;
  return (data || []).length;
}

export const removeSubscription = (id) =>
  write((s) => s.from("subscriptions").delete(WRITE_OPTS).eq("id", id).select())
    .then((rows) => assertChanged(rows, "Removing the subscriber"));

export async function listEmailSends() {
  const { data, error } = await getClientOrThrow()
    .from("email_sends")
    .select("id, title, body, event_id, sent_by_email, recipients, failed, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
}

async function invokeFunction(name, body) {
  const { data, error } = await getClientOrThrow().functions.invoke(name, { body });
  if (error) {
    // The function answers errors as JSON { error }; surface that text.
    let message = error.message;
    try {
      const body = await error.context.json();
      if (body && body.error) message = body.error;
    } catch {
      /* not JSON: keep the generic message */
    }
    throw new Error(message);
  }
  return data;
}

/* ---- activity log, undo and trash ----------------------------------
 *
 * The log is written by database triggers (migration 006); the panel
 * only reads it. A delete keeps a snapshot of the row, so restoring is
 * re-inserting that snapshot with its original id.
 * ------------------------------------------------------------------ */

export async function listActivity(limit = 300) {
  const { data, error } = await getClientOrThrow()
    .from("activity_log")
    .select("id, at, actor_email, action, table_name, row_id, row_label, changed")
    .order("at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

/** The newest log entry for one row: "last edited by X, 2h ago". */
export async function lastChange(table, rowId) {
  const { data, error } = await getClientOrThrow()
    .from("activity_log")
    .select("at, actor_email, action")
    .eq("table_name", table)
    .eq("row_id", String(rowId))
    .order("at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data && data[0]) || null;
}

/* The tables a snapshot may be restored into. Named, so the UI cannot
 * turn this into a general "insert anything anywhere" call. */
const RESTORABLE = new Set([
  "events", "class_sessions", "resources", "study_groups",
  "social_links", "core_members", "repo_kinds",
]);

/** Re-inserts the most recently deleted version of a row. */
export async function restoreDeleted(table, rowId) {
  if (!RESTORABLE.has(table)) throw new Error("That kind of row cannot be restored.");
  const supabase = getClientOrThrow();
  const { data, error } = await supabase
    .from("activity_log")
    .select("snapshot")
    .eq("table_name", table)
    .eq("row_id", String(rowId))
    .eq("action", "delete")
    .order("at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const snapshot = data && data[0] && data[0].snapshot;
  if (!snapshot) throw new Error("There is no deleted copy of that row to restore.");
  return write((s) => s.from(table).insert(snapshot).select().single());
}

/* ---- member photos (Storage bucket from migration 007) --------------- */

const PHOTO_BUCKET = "member-photos";

function bucketPath(url) {
  const marker = `/storage/v1/object/public/${PHOTO_BUCKET}/`;
  const at = String(url || "").indexOf(marker);
  return at === -1 ? null : decodeURIComponent(String(url).slice(at + marker.length));
}

/** Uploads the full photo and its 24px pixel version; returns their URLs. */
export async function uploadMemberPhoto(full, thumb) {
  const bucket = getClientOrThrow().storage.from(PHOTO_BUCKET);
  const base = `members/${crypto.randomUUID()}`;
  const ext = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg" }[full.type] || "webp";
  const files = [[`${base}.${ext}`, full, full.type || "image/webp"], [`${base}-24.png`, thumb, "image/png"]];
  for (const [path, blob, contentType] of files) {
    const { error } = await bucket.upload(path, blob, { contentType, cacheControl: "31536000", upsert: false });
    if (error) throw error;
  }
  return {
    photo_url: bucket.getPublicUrl(files[0][0]).data.publicUrl,
    photo_thumb_url: bucket.getPublicUrl(files[1][0]).data.publicUrl,
  };
}

/** Deletes photos that live in our bucket; other URLs are ignored. */
export async function removeMemberPhotos(urls) {
  const paths = urls.map(bucketPath).filter(Boolean);
  if (!paths.length) return;
  const { error } = await getClientOrThrow().storage.from(PHOTO_BUCKET).remove(paths);
  if (error) throw error;
}

/** repo_kinds is keyed by repo_name, so this upserts rather than inserts. */
export const saveRepoKind = (repoName, patch) =>
  write((s) =>
    s.from("repo_kinds")
      .upsert({ ...patch, repo_name: repoName }, { onConflict: "repo_name" })
      .select()
      .single()
  );

export const deleteRepoKind = (repoName) =>
  write((s) => s.from("repo_kinds").delete(WRITE_OPTS).eq("repo_name", repoName).select())
    .then((rows) => assertChanged(rows, "Deleting the repository kind"));
