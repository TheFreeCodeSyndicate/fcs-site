// supabase/functions/invite-member/index.ts
// --------------------------------------------------------------------
// Invites someone to the admin panel with a role chosen by an admin.
//
//   POST { email, role: "editor" | "admin", redirectTo }
//   Authorization: Bearer <the signed-in admin's access token>
//
// 1. Confirms the caller is signed in AND has role 'admin' in profiles.
// 2. Sends Supabase's invite email (needs custom SMTP for addresses
//    outside the Supabase organisation; see the README).
// 3. Sets the new profile's role. The signup trigger creates it as
//    'pending'; the service role is trusted by the role guard, so this
//    is the only place a role is granted without an admin clicking it
//    on the Team page.
//
// The service-role key lives only in this function's environment
// (SUPABASE_SERVICE_ROLE_KEY is injected by Supabase); it never
// reaches the browser.
// --------------------------------------------------------------------
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = [
  "http://localhost:8000",
  "https://thefreecodesyndicate.github.io",
];
const ROLES = new Set(["editor", "admin"]);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function cors(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[1];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function reply(origin: string | null, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return reply(origin, 405, { error: "Use POST." });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Who is asking? Resolve the caller from their own token.
  const authHeader = req.headers.get("Authorization") ?? "";
  const asCaller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: caller, error: callerError } = await asCaller.auth.getUser();
  if (callerError || !caller?.user) return reply(origin, 401, { error: "Sign in first." });

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: me, error: meError } = await admin.from("profiles").select("role").eq("id", caller.user.id).maybeSingle();
  if (meError) return reply(origin, 500, { error: `Could not check your role: ${meError.message}` });
  if (me?.role !== "admin") return reply(origin, 403, { error: "Only admins can invite people." });

  let payload: { email?: string; role?: string; redirectTo?: string };
  try {
    payload = await req.json();
  } catch {
    return reply(origin, 400, { error: "Send JSON." });
  }
  const email = String(payload.email ?? "").trim().toLowerCase();
  const role = String(payload.role ?? "editor");
  if (!EMAIL_RE.test(email)) return reply(origin, 400, { error: "That does not look like an email address." });
  if (!ROLES.has(role)) return reply(origin, 400, { error: "Role must be editor or admin." });

  // Supabase itself also checks redirectTo against the project's allowed
  // Redirect URLs, so this cannot send people to an arbitrary site.
  const redirectTo = typeof payload.redirectTo === "string" ? payload.redirectTo : undefined;

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: { invited_role: role, invited_by: caller.user.email },
  });
  if (inviteError) {
    const exists = /already (been )?registered|already exists/i.test(inviteError.message);
    return reply(origin, exists ? 409 : 400, {
      error: exists
        ? "That email already has an account. If they never accepted, delete them under Supabase > Authentication > Users and invite again."
        : inviteError.message,
    });
  }

  const { error: roleError } = await admin.from("profiles").update({ role }).eq("id", invited.user.id);
  if (roleError) return reply(origin, 500, { error: `Invite sent, but the role was not set: ${roleError.message}` });

  return reply(origin, 200, { ok: true, email, role });
});
