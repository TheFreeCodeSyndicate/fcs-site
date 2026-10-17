// supabase/functions/medium-import/index.ts
// --------------------------------------------------------------------
// Medium import Edge Function.
// Thin shell around importer.js: handles CORS, auth, role verification,
// environment secrets, and network/crypto injection.
// --------------------------------------------------------------------

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { MAX_BYTES, REPO } from "./asset.js";
import { handleAction } from "./importer.js";

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
  const reply = (status: number, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...headers, ...extraHeaders },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });

  try {
    if (req.method !== "POST") return reply(405, { error: "Use POST." });

    let body: any;
    try {
      body = await req.json();
    } catch (_) {
      return reply(400, { error: "Send JSON." });
    }

    const env = (n: string) => Deno.env.get(n) ?? "";
    const asCaller = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false },
    });
    const { data: caller } = await asCaller.auth.getUser();
    if (!caller?.user) return reply(401, { error: "Sign in first." });

    const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });
    const { data: me, error: meError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", caller.user.id)
      .maybeSingle();

    if (meError) {
      return reply(500, { error: `Could not check your role: ${meError.message}` });
    }
    if (me?.role !== "admin" && me?.role !== "editor") {
      return reply(403, { error: "Only editors and admins can import from Medium." });
    }

    const githubToken = env("GITHUB_ASSETS_TOKEN");
    if (body?.action === "import" && !githubToken) {
      return reply(501, {
        error: "Image upload is not set up: add GITHUB_ASSETS_TOKEN under Supabase > Edge Functions > Secrets (see the README).",
      });
    }

    const deps = {
      fetchText: async (url: string) => {
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; fcs-site/1.0)" },
          redirect: "follow",
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return await res.text();
      },
      fetchBytes: async (url: string) => {
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; fcs-site/1.0)" },
          redirect: "follow",
        });
        if (!res.ok) return null;
        const buf = await res.arrayBuffer();
        return {
          bytes: new Uint8Array(buf),
          type: res.headers.get("content-type") || "",
        };
      },
      putAsset: async (bytes: Uint8Array, _ext: string, path: string) => {
        const res = await fetch(
          `https://api.github.com/repos/${REPO}/contents/${path}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${githubToken}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
              "User-Agent": "fcs-site-asset-uploader",
            },
            body: JSON.stringify({
              message: "asset: upload from Medium",
              content: encodeBase64(bytes),
            }),
          }
        );
        if (res.status !== 201) {
          throw new Error(`GitHub PUT failed ${res.status}: ${(await res.text()).slice(0, 160)}`);
        }
        const { commit } = await res.json();
        if (!commit?.sha) {
          throw new Error("GitHub response missing commit sha");
        }
        return {
          sha: commit.sha,
          path,
        };
      },
      limit: 40,
      maxBytes: MAX_BYTES,
      now: new Date(),
      newID: () => crypto.randomUUID(),
    };

    const result = await handleAction(body, deps);
    const extraHeaders: Record<string, string> =
      body?.action === "import" ? { "Cache-Control": "no-store" } : {};

    return reply(result.status, result.body, extraHeaders);
  } catch (err: any) {
    return reply(500, { error: err.message || "Internal error" });
  }
});
