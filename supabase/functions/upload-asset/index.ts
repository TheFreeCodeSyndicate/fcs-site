// supabase/functions/upload-asset/index.ts
// --------------------------------------------------------------------
// Blog images. The admin panel sends one picture; this commits it to the
// public fcs-assets repository and answers with its jsDelivr address,
// pinned to that commit so it never changes and never needs purging.
//
//   POST <the image's bytes>   Authorization: Bearer <an editor's or admin's token>
//   -> { url }
//
// The image's type comes from its own first bytes, not from the request.
// SVG is refused (it can carry scripts); the cap is 2 MB. The admin panel
// shrinks images to WebP in the browser first, so real uploads are far
// smaller.
//
// Needs the Edge Function secret GITHUB_ASSETS_TOKEN: a fine-grained
// GitHub token for TheFreeCodeSyndicate/fcs-assets with "Contents: Read
// and write" and nothing else. It never reaches the browser.
// --------------------------------------------------------------------
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { REPO, assetPath, cdnURL, refusal } from "./asset.js";

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
  if (me?.role !== "admin" && me?.role !== "editor") return reply(403, { error: "Only editors and admins can upload images." });

  const token = env("GITHUB_ASSETS_TOKEN");
  if (!token) {
    return reply(501, { error: "Image upload is not set up: add GITHUB_ASSETS_TOKEN under Supabase > Edge Functions > Secrets (see the README)." });
  }

  const bytes = new Uint8Array(await req.arrayBuffer());
  const refused = refusal(bytes);
  if (refused) return reply(400, { error: refused });

  const path = assetPath(bytes, new Date(), crypto.randomUUID());
  // ponytail: no retry; two editors committing in the same second can get a
  // 409 from GitHub, and the message below tells them to try again.
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "fcs-upload-asset",
    },
    body: JSON.stringify({ message: `Add ${path}`, content: encodeBase64(bytes) }),
  });
  if (res.status !== 201) {
    return reply(502, { error: `GitHub refused the image (${res.status}). Try again in a moment. ${(await res.text()).slice(0, 160)}` });
  }
  const { commit } = await res.json();
  return reply(200, { url: cdnURL(commit.sha, path) });
});
