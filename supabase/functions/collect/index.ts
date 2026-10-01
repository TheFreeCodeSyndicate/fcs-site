// supabase/functions/collect/index.ts
// --------------------------------------------------------------------
// Receives the public site's analytics beacons (js/track.js) and
// writes them to analytics_pageviews / analytics_events (migration 016).
//
//   POST text/plain JSON, one of:
//     { type: "view",   key, path, ref, utm_source, utm_medium, utm_campaign,
//                       session, is_new, device, tz }
//     { type: "engage", key, ms }       time the tab was actually in view
//     { type: "event",  name, label, path, session }
//
// Deployed with verify_jwt off: navigator.sendBeacon cannot send an
// Authorization header. So it accepts only the site's own origins,
// ignores bots, caps every field, and always answers 204 so a probe
// learns nothing. Do Not Track and Global Privacy Control are not
// applied: nothing personal is stored (see the privacy note on the site).
// Location is the browser's timezone only: the host passes no country,
// and a VPN would hide the real one anyway. The visitor id is a hash of (today's random salt + IP +
// browser); the IP itself is never stored.
// --------------------------------------------------------------------
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGINS = ["https://thefreecodesyndicate.github.io", "http://localhost:8000"];
const EVENTS = new Set(["join", "copy", "social", "calendar", "notify", "subscribe", "repo", "resource", "member-link", "link", "section"]);
const BOTS = /bot|crawl|spider|slurp|headless|preview|lighthouse|pingdom|monitor|curl|wget|python|go-http|java\//i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const env = (n: string) => Deno.env.get(n) ?? "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const cut = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);

async function visitorId(req: Request) {
  const day = new Date().toISOString().slice(0, 10);
  let { data } = await db.from("analytics_salts").select("salt").eq("day", day).maybeSingle();
  if (!data) {
    await db.from("analytics_salts").upsert({ day }, { onConflict: "day", ignoreDuplicates: true });
    ({ data } = await db.from("analytics_salts").select("salt").eq("day", day).maybeSingle());
  }
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${data?.salt}|${ip}|${req.headers.get("user-agent")}`));
  return [...new Uint8Array(bytes)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const cors = {
    "Access-Control-Allow-Origin": ORIGINS.includes(origin) ? origin : ORIGINS[0],
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    Vary: "Origin",
  };
  const done = () => new Response(null, { status: 204, headers: cors });
  if (req.method === "OPTIONS") return done();
  if (req.method !== "POST" || !ORIGINS.includes(origin)) return done();
  const ua = req.headers.get("user-agent") ?? "";
  if (!ua || BOTS.test(ua)) return done();

  let b: Record<string, unknown>;
  try {
    b = JSON.parse((await req.text()).slice(0, 4000));
  } catch {
    return done();
  }
  const session = cut(b.session, 64);
  if (!session) return done();

  try {
    if (b.type === "view" && typeof b.key === "string" && UUID.test(b.key)) {
      const path = cut(b.path, 200);
      if (!path || !path.startsWith("/")) return done();
      await db.from("analytics_pageviews").insert({
        view_key: b.key,
        path,
        referrer_host: cut(b.ref, 100),
        utm_source: cut(b.utm_source, 60),
        utm_medium: cut(b.utm_medium, 60),
        utm_campaign: cut(b.utm_campaign, 60),
        visitor: await visitorId(req),
        session,
        is_new: b.is_new === true,
        device: ["mobile", "tablet", "desktop"].includes(String(b.device)) ? b.device : null,
        timezone: cut(b.tz, 60),
      });
    } else if (b.type === "engage" && typeof b.key === "string" && UUID.test(b.key)) {
      const ms = Math.min(Math.max(Math.round(Number(b.ms) || 0), 0), 30 * 60 * 1000);
      // Only a recent view from this same tab session can be updated.
      await db.from("analytics_pageviews").update({ engaged_ms: ms })
        .eq("view_key", b.key).eq("session", session)
        .gte("at", new Date(Date.now() - 864e5).toISOString());
    } else if (b.type === "event" && EVENTS.has(String(b.name))) {
      await db.from("analytics_events").insert({
        name: b.name,
        label: cut(b.label, 80),
        path: cut(b.path, 200),
        visitor: await visitorId(req),
        session,
      });
    }
  } catch (err) {
    console.error(err);
  }
  return done();
});
