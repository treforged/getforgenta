/**
 * public-build — unauthenticated Edge Function for shared car build pages.
 *
 * Replaces the former direct PostgREST access pattern, which allowed full
 * enumeration of shared builds and their tokens without requiring the caller
 * to know a specific token. This function enforces exact-token validation
 * server-side using the service role before returning any data.
 *
 * Security properties:
 *   - UUID format is validated before any DB query
 *   - Token must match exactly in the DB (no wildcard or partial match)
 *   - share_token is never included in the response
 *   - Service role bypasses RLS; no public policies needed on build tables
 *   - Origin-allowlisted CORS headers (no wildcard)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  "https://getforgenta.com",
  "https://www.getforgenta.com",
  "https://treforged.com",
  "https://www.treforged.com",
  "http://localhost:8080",
  "http://localhost:3000",
  "http://localhost:5173",
]);

const PRODUCTION_ORIGIN = "https://getforgenta.com";

function buildCorsHeaders(req: Request): Record<string, string> {
  const requestOrigin = req.headers.get("origin") ?? "";
  const allowedOrigin = ALLOWED_ORIGINS.has(requestOrigin)
    ? requestOrigin
    : PRODUCTION_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(
  body: unknown,
  status: number,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(null, { status: 405, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!token || !UUID_RE.test(token)) {
    return jsonResponse({ error: "Not found" }, 404, corsHeaders);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: build, error: buildErr } = await supabase
    .from("car_builds")
    .select("id, name, year, make, model, notes, user_id")
    .eq("share_token", token)
    .single();

  if (buildErr || !build) {
    return jsonResponse({ error: "Not found" }, 404, corsHeaders);
  }

  const [{ data: phases }, { data: items }, { data: profile }] =
    await Promise.all([
      supabase
        .from("car_build_phases")
        .select("id, build_id, title, sort_order, hidden")
        .eq("build_id", build.id)
        .order("sort_order"),
      supabase
        .from("car_build_items")
        .select(
          "id, phase_id, build_id, name, brand, price, link, completed, sort_order",
        )
        .eq("build_id", build.id)
        .order("sort_order"),
      supabase
        .from("profiles")
        .select("display_name")
        .eq("user_id", build.user_id)
        .maybeSingle(),
    ]);

  return jsonResponse(
    {
      build,
      phases: phases ?? [],
      items: items ?? [],
      displayName:
        (profile as Record<string, unknown> | null)?.display_name ?? null,
    },
    200,
    corsHeaders,
  );
});
