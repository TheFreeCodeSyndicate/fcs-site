// supabase/functions/unsplash/index.ts
// --------------------------------------------------------------------
// The cover picker's Unsplash tab. Searches Unsplash for editors and
// admins, so the API key stays here and never reaches the browser.
//
//   POST { action: "search", query, page }   -> { results, totalPages }
//        (no query: Unsplash's "Wallpapers" topic, as a starting page)
//   POST { action: "download", download }     -> { ok }
//        Unsplash's rules: tell them when a photo is actually used.
//
// Photos are hotlinked from Unsplash's CDN (also their rule), and the
// photographer is credited with a link back, as the guidelines ask.
//
// Needs the Edge Function secret UNSPLASH_ACCESS_KEY: the "Access Key"
// of an app at https://unsplash.com/oauth/applications.
// --------------------------------------------------------------------
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = ["http://localhost:8000", "https://thefreecodesyndicate.github.io"];
const UTM = "utm_source=the_free_code_syndicate&utm_medium=referral";

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[1],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

// deno-lint-ignore no-explicit-any
const photo = (p: any) => ({
  id: p.id,
  alt: p.alt_description || p.description || "",
  thumb: p.urls.small,
  // Wide enough for a full-width cover, sized by Unsplash's image service.
  url: `${p.urls.raw}&w=2400&q=80&fm=jpg&fit=max`,
  name: p.user.name,
  profile: `${p.user.links.html}?${UTM}`,
  link: `${p.links.html}?${UTM}`,
  download: p.links.download_location,
});

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
  const { data: me } = await admin.from("profiles").select("role").eq("id", caller.user.id).maybeSingle();
  if (me?.role !== "admin" && me?.role !== "editor") return reply(403, { error: "Only editors and admins can search Unsplash." });

  const key = env("UNSPLASH_ACCESS_KEY");
  if (!key) {
    return reply(501, { error: "Unsplash is not set up yet: add UNSPLASH_ACCESS_KEY under Supabase > Edge Functions > Secrets (see the README)." });
  }
  const api = (path: string) => fetch(`https://api.unsplash.com${path}`, { headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" } });

  let body: { action?: string; query?: string; page?: number; download?: string };
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "Send JSON." });
  }

  if (body.action === "download") {
    // Only Unsplash's own download-tracking links.
    if (!/^https:\/\/api\.unsplash\.com\/photos\/[\w-]+\/download(\?|$)/.test(body.download ?? "")) return reply(400, { error: "Not an Unsplash download link." });
    const res = await api(body.download!.replace("https://api.unsplash.com", ""));
    return reply(res.ok ? 200 : 502, { ok: res.ok });
  }

  const page = Math.max(1, Math.min(Number(body.page) || 1, 50));
  const query = String(body.query ?? "").trim().slice(0, 100);
  const res = query
    ? await api(`/search/photos?query=${encodeURIComponent(query)}&page=${page}&per_page=24&orientation=landscape&content_filter=high`)
    : await api(`/topics/wallpapers/photos?page=${page}&per_page=24&orientation=landscape`);
  if (!res.ok) return reply(502, { error: `Unsplash answered ${res.status}. ${res.status === 403 ? "The hourly limit may be used up; try again later." : ""}` });
  const data = await res.json();
  const list = Array.isArray(data) ? data : data.results;
  return reply(200, { results: list.map(photo), totalPages: Array.isArray(data) ? 50 : data.total_pages });
});
