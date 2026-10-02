// supabase/functions/event-mail/index.ts
// --------------------------------------------------------------------
// Email updates about events. POST JSON with an `action`:
//
//   Anyone (the site's anon key):
//     subscribe   { email, event_id | null, company }   event_id null = all events;
//                 company is a honeypot field that people never fill in
//     lookup      { token }                 what a confirm/unsubscribe link is for
//     confirm     { token }
//     unsubscribe { token, everything }     one list, or every list for that email
//
//   Admins only (their own access token):
//     send        { event_id | null, subject, body, test }
//                 event_id: that event's list plus the all-events list;
//                 null: everyone on any list. test: only to yourself.
//
// Mail goes out through Gmail SMTP with the club's app password, stored
// as Edge Function secrets GMAIL_USER and GMAIL_APP_PASSWORD (Supabase >
// Edge Functions > Secrets). The service-role key never leaves Supabase.
// --------------------------------------------------------------------
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6";

const SITE = "https://thefreecodesyndicate.github.io/fcs-site/";
const ALLOWED_ORIGINS = ["http://localhost:8000", "https://thefreecodesyndicate.github.io"];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESEND_AFTER_MS = 10 * 60 * 1000; // one confirm email per address and list per 10 minutes
const SIGNUPS_PER_HOUR = 100; // unconfirmed signups site-wide, to cap abuse of the Gmail quota

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[1],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

const env = (name: string) => Deno.env.get(name) ?? "";
const service = () => createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

/* ---- email ---------------------------------------------------------- */

const esc = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const INK = "#000000", PAPER = "#ffffff", BG = "#fff7e4", ACCENT = "#fcce37", MUTED = "#555248";
const HEAD = "'Arial Black', 'Helvetica Neue', Arial, sans-serif";
const BODY = "Arial, 'Helvetica Neue', Helvetica, sans-serif";
const MONO = "'Courier New', Courier, monospace";

// Same look as the auth emails (tools/email-templates.mjs), trimmed down.
function layout(tag: string, title: string, inner: string, footer: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${BG};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG};"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;"><tr><td style="background:${INK};padding:0 6px 6px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER};border:3px solid ${INK};">
  <tr><td style="background:${ACCENT};border-bottom:3px solid ${INK};padding:16px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="44" valign="middle"><img src="${SITE}assets/favicon-192.png" width="36" height="36" alt="" style="display:block;border:2px solid ${INK};"></td>
      <td valign="middle" style="font-family:${HEAD};font-size:15px;letter-spacing:0.5px;text-transform:uppercase;color:${INK};">The Free Code Syndicate</td>
      <td valign="middle" align="right" style="font-family:${MONO};font-size:12px;font-weight:bold;white-space:nowrap;color:${INK};">${tag}</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:32px 28px 28px;">
    <h1 style="margin:0 0 18px;font-family:${HEAD};font-size:26px;line-height:1.2;color:${INK};">${esc(title)}</h1>
    ${inner}
  </td></tr>
  <tr><td style="border-top:3px solid ${INK};padding:16px 28px;font-family:${MONO};font-size:12px;line-height:1.6;color:${MUTED};">${footer}</td></tr>
</table></td></tr></table></td></tr></table></body></html>`;
}

const para = (html: string) =>
  `<p style="margin:0 0 16px;font-family:${BODY};font-size:16px;line-height:1.55;color:${INK};">${html}</p>`;

const button = (label: string, href: string) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr><td style="background:${INK};padding:0 4px 4px 0;">
  <a href="${esc(href)}" style="display:block;background:${ACCENT};border:3px solid ${INK};padding:14px 26px;font-family:${HEAD};font-size:15px;letter-spacing:0.5px;text-transform:uppercase;color:${INK};text-decoration:none;">${esc(label)} &rarr;</a>
</td></tr></table>`;

// The admin's plain text: blank lines split paragraphs, and links become clickable.
const textToHTML = (text: string) =>
  text.trim().split(/\n{2,}/).map((block) =>
    para(esc(block).replace(/\n/g, "<br>").replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}" style="color:${INK};">${url}</a>`))
  ).join("");

type Event = { id: string; title: string; starts_at: string; link: string | null; group_name: string | null };

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  }) + " IST";

const eventBox = (e: Event) => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border:2px solid ${INK};"><tr>
  <td width="8" style="background:${ACCENT};border-right:2px solid ${INK};"></td>
  <td style="padding:12px 14px;font-family:${BODY};color:${INK};">
    ${e.group_name ? `<div style="font-family:${MONO};font-size:12px;color:${MUTED};text-transform:uppercase;">${esc(e.group_name)}</div>` : ""}
    <div style="font-family:${HEAD};font-size:17px;">${esc(e.title)}</div>
    <div style="font-size:14px;margin-top:4px;">${esc(when(e.starts_at))}</div>
  </td></tr></table>`;

const listName = (e: Event | null) => (e ? `“${e.title}”` : "all FCS events");

const unsubscribeURL = (token: string) => `${SITE}subscribe.html?unsubscribe=${token}`;

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;
function mailer() {
  if (!env("GMAIL_USER") || !env("GMAIL_APP_PASSWORD")) {
    throw new Error("Email is not set up: add GMAIL_USER and GMAIL_APP_PASSWORD under Supabase > Edge Functions > Secrets.");
  }
  transport ??= nodemailer.createTransport({
    host: "smtp.gmail.com", port: 465, secure: true, pool: true, maxConnections: 1,
    auth: { user: env("GMAIL_USER"), pass: env("GMAIL_APP_PASSWORD") },
  });
  return transport;
}

async function sendMail(to: string, subject: string, html: string, text: string, unsubscribe?: string) {
  await mailer().sendMail({
    from: { name: "The Free Code Syndicate", address: env("GMAIL_USER") },
    to, subject, html, text,
    ...(unsubscribe ? { list: { unsubscribe: { url: unsubscribe, comment: "Unsubscribe" } } } : {}),
  });
}

/* ---- actions -------------------------------------------------------- */

class Reply extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function findEvent(db: SupabaseClient, id: string | null): Promise<Event | null> {
  if (id == null) return null;
  if (!UUID_RE.test(id)) throw new Reply(404, "That event does not exist.");
  const { data, error } = await db.from("events").select("id, title, starts_at, link, group_name").eq("id", id).maybeSingle();
  if (error) throw new Reply(500, error.message);
  if (!data) throw new Reply(404, "That event does not exist.");
  return data;
}

async function subscribe(asVisitor: SupabaseClient, body: Record<string, unknown>) {
  if (body.company) return { ok: true }; // a bot filled the hidden field
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) throw new Reply(400, "That does not look like an email address.");
  // Read the event as a visitor, so drafts and hidden events cannot be subscribed to.
  const event = await findEvent(asVisitor, (body.event_id as string | null) ?? null);

  const db = service();
  let query = db.from("subscriptions").select("token, confirmed_at, created_at").eq("email", email);
  query = event ? query.eq("event_id", event.id) : query.is("event_id", null);
  const { data: existing, error: existingError } = await query.maybeSingle();
  if (existingError) throw new Reply(500, existingError.message);

  // Same answer whether or not the address is already on the list.
  if (existing?.confirmed_at) return { ok: true };
  if (existing && Date.now() - new Date(existing.created_at).getTime() < RESEND_AFTER_MS) return { ok: true };

  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db.from("subscriptions").select("id", { count: "exact", head: true })
    .is("confirmed_at", null).gte("created_at", hourAgo);
  if ((count ?? 0) >= SIGNUPS_PER_HOUR) throw new Reply(429, "Too many signups right now. Try again in an hour.");

  let token = existing?.token as string | undefined;
  if (existing) {
    await db.from("subscriptions").update({ created_at: new Date().toISOString() }).eq("token", token);
  } else {
    const { data, error } = await db.from("subscriptions").insert({ email, event_id: event?.id ?? null }).select("token").single();
    if (error) throw new Reply(500, error.message);
    token = data.token;
  }

  const link = `${SITE}subscribe.html?confirm=${token}`;
  const title = "Confirm your subscription";
  const html = layout("// SUBSCRIBE", title,
    para(`Confirm that <strong>${esc(email)}</strong> should get email updates about ${esc(listName(event))}.`) +
    (event ? eventBox(event) : "") +
    button("Confirm", link) +
    para(`<span style="font-size:13px;color:${MUTED};">If you didn't ask for this, ignore this email and you won't hear from us.</span>`),
    `You got this because ${esc(email)} was entered on ${SITE.replace("https://", "")}.`);
  try {
    await sendMail(email, `Confirm: updates about ${listName(event)}`, html,
      `Confirm that ${email} should get updates about ${listName(event)}:\n${link}\n\nIf you didn't ask for this, ignore this email.`);
  } catch (err) {
    // Undo, so trying again is not blocked by the 10-minute resend guard.
    if (existing) await db.from("subscriptions").update({ created_at: existing.created_at }).eq("token", token);
    else await db.from("subscriptions").delete().eq("token", token);
    throw err;
  }
  return { ok: true };
}

async function byToken(token: unknown) {
  if (typeof token !== "string" || !UUID_RE.test(token)) throw new Reply(404, "This link is not valid.");
  const { data, error } = await service().from("subscriptions")
    .select("id, email, confirmed_at, event:events(id, title, starts_at, link, group_name)")
    .eq("token", token).maybeSingle();
  if (error) throw new Reply(500, error.message); // never dress a database error up as "link used"
  if (!data) throw new Reply(404, "This link has already been used, or the subscription was removed.");
  return data as unknown as { id: string; email: string; confirmed_at: string | null; event: Event | null };
}

const mask = (email: string) => email.replace(/^(.)(.*)(@.*)$/, (_, a, b, c) => a + "•".repeat(Math.min(b.length, 6)) + c);

async function lookup(body: Record<string, unknown>) {
  const row = await byToken(body.token);
  return { email: mask(row.email), list: listName(row.event), confirmed: Boolean(row.confirmed_at) };
}

async function confirm(body: Record<string, unknown>) {
  const row = await byToken(body.token);
  if (!row.confirmed_at) await service().from("subscriptions").update({ confirmed_at: new Date().toISOString() }).eq("id", row.id);
  return { email: mask(row.email), list: listName(row.event) };
}

async function unsubscribe(body: Record<string, unknown>) {
  const row = await byToken(body.token);
  const db = service();
  const { error } = body.everything
    ? await db.from("subscriptions").delete().eq("email", row.email)
    : await db.from("subscriptions").delete().eq("id", row.id);
  if (error) throw new Reply(500, error.message);
  return { email: mask(row.email), list: body.everything ? "every FCS list" : listName(row.event) };
}

async function send(asCaller: SupabaseClient, body: Record<string, unknown>) {
  const { data: caller } = await asCaller.auth.getUser();
  if (!caller?.user) throw new Reply(401, "Sign in first.");
  const db = service();
  const { data: me, error: meError } = await db.from("profiles").select("role").eq("id", caller.user.id).maybeSingle();
  if (meError) throw new Reply(500, `Could not check your role: ${meError.message}`);
  if (me?.role !== "admin") throw new Reply(403, "Only admins can email subscribers.");

  const subject = String(body.subject ?? "").trim();
  const text = String(body.body ?? "").trim();
  if (!subject || subject.length > 150) throw new Reply(400, "Write a subject (up to 150 characters).");
  if (!text || text.length > 20000) throw new Reply(400, "Write a message.");
  const event = await findEvent(db, (body.event_id as string | null) ?? null);

  // Who gets it: one email per address, unsubscribing from the most specific list it came from.
  let query = db.from("subscriptions").select("email, token, event_id").not("confirmed_at", "is", null);
  if (event) query = query.or(`event_id.eq.${event.id},event_id.is.null`);
  const { data: rows, error } = await query;
  if (error) throw new Reply(500, error.message);
  const recipients = new Map<string, string>();
  for (const r of rows ?? []) {
    if (!recipients.has(r.email) || r.event_id === event?.id) recipients.set(r.email, r.token);
  }

  const render = (token: string | null) => {
    const unsub = token ? unsubscribeURL(token) : null;
    const html = layout(event ? "// EVENT UPDATE" : "// UPDATE", subject,
      (event ? eventBox(event) : "") + textToHTML(text) + (event?.link ? button("Open the event", event.link) : ""),
      unsub
        ? `You're getting this because you subscribed to updates about ${esc(listName(event))}.<br><a href="${esc(unsub)}" style="color:${INK};font-weight:bold;">Unsubscribe</a>`
        : "This is a test send, only to you.");
    const plain = `${subject}\n\n${event ? `${event.title}, ${when(event.starts_at)}\n\n` : ""}${text}\n\n${unsub ? `Unsubscribe: ${unsub}` : ""}`;
    return { html, plain, unsub };
  };

  if (body.test) {
    const { html, plain } = render(null);
    await sendMail(caller.user.email!, `[Test] ${subject}`, html, plain);
    return { sent: 1, failed: 0, test: true };
  }
  if (!recipients.size) throw new Reply(400, "Nobody is on this list yet.");

  // ponytail: one request sends them all, one by one (~0.5s each), so a list of a few hundred
  // fits the function's time limit; beyond that, queue the sends in a table and drain it on a cron.
  let sent = 0, failed = 0;
  for (const [email, token] of recipients) {
    const { html, plain, unsub } = render(token);
    try {
      await sendMail(email, subject, html, plain, unsub!);
      sent++;
    } catch (err) {
      console.error(`send to one recipient failed: ${(err as Error).message}`);
      failed++;
    }
  }
  // Recorded as the admin, so the activity log names them.
  await asCaller.from("email_sends").insert({
    title: subject, body: text, event_id: event?.id ?? null, sent_by_email: caller.user.email, recipients: sent, failed,
  });
  return { sent, failed };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const headers = { ...cors(origin), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Use POST." }), { status: 405, headers });

  const asCaller = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  try {
    const body = await req.json().catch(() => { throw new Reply(400, "Send JSON."); });
    const actions: Record<string, () => Promise<unknown>> = {
      subscribe: () => subscribe(asCaller, body),
      lookup: () => lookup(body),
      confirm: () => confirm(body),
      unsubscribe: () => unsubscribe(body),
      send: () => send(asCaller, body),
    };
    const run = actions[String(body.action)];
    if (!run) throw new Reply(400, "Unknown action.");
    return new Response(JSON.stringify(await run()), { headers });
  } catch (err) {
    const status = err instanceof Reply ? err.status : 500;
    if (status === 500) console.error(err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status, headers });
  }
});
