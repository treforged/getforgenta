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
 *
 * Maintenance log (2026-08-12):
 *   - Published only when the build's own `maintenance_public` flag is true.
 *     The switch is PER BUILD, so it travels with the share link; there is no
 *     per-entry flag, because a per-entry one fails silently the first time an
 *     owner forgets to mark a row private.
 *   - The SELECT below is a COLUMN ALLOWLIST, and the omissions are the point:
 *     `cost`, `vendor` and `notes` are NEVER sent. Showing that the oil was
 *     changed at 92,400 miles is the feature; publishing what someone paid and
 *     the name of their local shop is a different one. A cost never crosses the
 *     network, rather than being sent and hidden in the browser.
 *   - `car_maintenance_logs` gets NO anon RLS policy. See
 *     20260812_car_builds_maintenance_public.sql for why re-adding one would
 *     restore the enumeration hole 20260615_fix_public_rls.sql closed.
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
    .select(
      "id, name, year, make, model, notes, user_id, photos, maintenance_public",
    )
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

  // The share gate. Not fetched at all when the flag is off, so a private log
  // cannot be leaked by a later refactor that forgets to filter the response.
  const maintenancePublic = build.maintenance_public === true;
  const { data: maintenance } = maintenancePublic
    ? await supabase
      .from("car_maintenance_logs")
      .select(
        "id, service, service_date, odometer, next_due_date, next_due_odometer",
      )
      .eq("build_id", build.id)
      .order("service_date", { ascending: false })
    : { data: null };

  // `maintenance_public` is the owner's own setting and tells the page whether an
  // empty list means "nothing logged" or "not shared" — but it is not build data,
  // so it is stripped from the build object and reported once, on its own.
  const { maintenance_public: _flag, ...publicBuild } = build as Record<
    string,
    unknown
  >;

  return jsonResponse(
    {
      build: publicBuild,
      phases: phases ?? [],
      items: items ?? [],
      maintenancePublic,
      maintenance: maintenance ?? [],
      displayName:
        (profile as Record<string, unknown> | null)?.display_name ?? null,
    },
    200,
    corsHeaders,
  );
});
