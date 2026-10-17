// supabase/functions/medium-import/index.ts
// --------------------------------------------------------------------
// Medium import Edge Function.
// Thin shell around importer.js: handles CORS, auth, role verification,
// environment secrets, and network/crypto injection.
// --------------------------------------------------------------------

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { MAX_BYTES } from "./asset.js";
import { handleAction } from "./importer.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const reply = (status: number, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return reply(405, { error: "Method not allowed" });
    }

    let body: any;
    try {
      body = await req.json();
    } catch (_) {
      return reply(400, { error: "Invalid JSON body" });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ") || authHeader.trim() === "Bearer") {
      return reply(401, { error: "Missing authorization header" });
    }

    const env = (n: string) => Deno.env.get(n) ?? "";
    const asCaller = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: caller, error: authError } = await asCaller.auth.getUser();
    if (authError || !caller?.user) {
      return reply(401, { error: "Unauthorized" });
    }

    const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });
    const { data: profile, error: roleError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", caller.user.id)
      .single();

    if (roleError) {
      return reply(500, { error: "Failed to verify editor permissions" });
    }
    if (profile?.role !== "admin" && profile?.role !== "editor") {
      return reply(403, { error: "Only editors and admins can import from Medium." });
    }

    const githubToken = env("GITHUB_ASSETS_TOKEN");
    if (body?.action === "import" && !githubToken) {
      return reply(501, { error: "Image storage is not configured (missing GITHUB_ASSETS_TOKEN)." });
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
          `https://api.github.com/repos/TheFreeCodeSyndicate/fcs-assets/contents/${path}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${githubToken}`,
              Accept: "application/vnd.github+json",
              "User-Agent": "fcs-site-asset-uploader",
            },
            body: JSON.stringify({
              message: "asset: upload from Medium",
              content: encodeBase64(bytes),
              branch: "main",
            }),
          }
        );
        if (res.status !== 201) {
          throw new Error(`GitHub PUT failed ${res.status}: ${(await res.text()).slice(0, 160)}`);
        }
        const json = await res.json();
        return {
          sha: json.content?.sha ?? json.commit?.sha ?? "",
          path: json.content?.path ?? path,
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
