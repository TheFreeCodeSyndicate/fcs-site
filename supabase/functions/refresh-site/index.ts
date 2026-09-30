// supabase/functions/refresh-site/index.ts
// --------------------------------------------------------------------
// "Refresh now" in the admin's Repositories page: runs the site's
// deploy workflow straight away, so a newly pushed or archived repo
// shows without waiting for the next 30-minute run.
//
//   POST (no body)   Authorization: Bearer <an editor's or admin's token>
//
// Needs the Edge Function secret GITHUB_DISPATCH_TOKEN: a fine-grained
// GitHub token for TheFreeCodeSyndicate/fcs-site with "Actions: Read and
// write" and nothing else. It never reaches the browser.
// --------------------------------------------------------------------
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const REPO = "TheFreeCodeSyndicate/fcs-site";
const WORKFLOW = "pages.yml";
const ALLOWED_ORIGINS = ["http://localhost:8000", "https://thefreecodesyndicate.github.io"];

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[1],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const headers = { ...cors(origin), "Content-Type": "application/json" };
  const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });

  const env = (n: string) => Deno.env.get(n) ?? "";
  const asCaller = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const { data: caller } = await asCaller.auth.getUser();
  if (!caller?.user) return reply(401, { error: "Sign in first." });
  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const { data: me, error: meError } = await admin.from("profiles").select("role").eq("id", caller.user.id).maybeSingle();
  if (meError) return reply(500, { error: `Could not check your role: ${meError.message}` });
  if (me?.role !== "admin" && me?.role !== "editor") return reply(403, { error: "Only editors and admins can refresh the site." });

  const token = env("GITHUB_DISPATCH_TOKEN");
  if (!token) {
    return reply(501, { error: "Refreshing is not set up: add GITHUB_DISPATCH_TOKEN under Supabase > Edge Functions > Secrets (see the README)." });
  }
  // ponytail: no cooldown; GitHub queues runs one at a time (the workflow's
  // concurrency group), so repeated clicks cost queued deploys, nothing worse.
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "fcs-refresh-site",
    },
    body: JSON.stringify({ ref: "master" }),
  });
  if (res.status !== 204) {
    return reply(502, { error: `GitHub refused the deploy (${res.status}): ${(await res.text()).slice(0, 200)}` });
  }
  return reply(200, { ok: true });
});
