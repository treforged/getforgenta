/**
 * money-glance — GET, read-only: the caller's own Safe to Spend snapshot, for Leo (ask 1dc2c388;
 * design forged-glass docs/DESIGN-leo-money-glance.md).
 *
 * 200 {amount_cents, payday, horizon, low_point_cents, low_date, floor_cents, computed_at}, the
 * 7-key contract agreed with Vera. 404 {"missing":"no-snapshot"}; 401 {"error":"unauthorized"};
 * 429 {"error":"rate-limited"}; anything else {"error":"failed"}.
 *
 * NEVER USES THE SERVICE-ROLE KEY. The client is the anon key plus the CALLER's Authorization
 * header, so RLS (user_id = auth.uid()) scopes the read to their own row. The 30/min limit goes
 * through `money_glance_rate_ok()`, a definer helper that counts only the caller's key, because the
 * rate_limits table is revoked from users. Survives per-user RLS by construction (the app-will-be-
 * sold rule). Logs never carry an amount, a row or a token.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { shapeGlance } from "./shape.ts";

Deno.serve(async (req) => {
  const cors = { ...getCorsHeaders(req), "Access-Control-Allow-Methods": "GET, OPTIONS" };
  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET") return json(405, { error: "method-not-allowed" });

  const auth = req.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return json(401, { error: "unauthorized" });

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) {
    console.error("[money-glance] missing SUPABASE_URL or SUPABASE_ANON_KEY");
    return json(500, { error: "server-misconfigured" });
  }

  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return json(401, { error: "unauthorized" });

  const { data: ok, error: rlErr } = await supabase.rpc("money_glance_rate_ok");
  if (rlErr) {
    console.error("[money-glance] rate check failed:", rlErr.code ?? "unknown");
    return json(500, { error: "failed" });
  }
  if (ok !== true) return json(429, { error: "rate-limited" });

  const { data: row, error: readErr } = await supabase
    .from("safe_to_spend_snapshot")
    .select("amount_cents, payday, horizon, low_point_cents, low_date, floor_cents, computed_at")
    .maybeSingle();
  if (readErr) {
    console.error("[money-glance] read failed:", readErr.code ?? "unknown");
    return json(500, { error: "failed" });
  }
  if (!row) return json(404, { missing: "no-snapshot" });

  const body = shapeGlance(row as Record<string, unknown>);
  if (!body) {
    console.error("[money-glance] malformed snapshot row");
    return json(500, { error: "failed" });
  }
  return json(200, body);
});
