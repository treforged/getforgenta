/**
 * rundown-counts - the user COUNTS the daily business rundown reads (Sam's rundown.py).
 *
 * Tre decided 2026-09-18 (cfd733a1): the app publishes the business figure, and no service-role
 * key goes on a local disk because he intends to sell the product. So rundown.py holds only a
 * READ secret for this one endpoint, not a database key.
 *
 * AUTH: header `x-rundown-secret`. The database stores only its SHA-256
 * (public.rundown_read_secret, service_role only). This function hashes the incoming header and
 * compares the hex strings in constant time. A wrong or missing secret gets 401, and the counts
 * are never read before the check passes.
 *
 * Rate limited per IP (10 a minute), the same limiter the link-token function uses.
 *
 * New surface, stated: anyone can POST here. Without the secret it returns 401 and reads nothing
 * but the one hash row. With it, it returns ONE row of integers from business_user_counts():
 * no id, no email, no date. verify_jwt = false because the caller holds no Supabase JWT.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkRateLimit, getClientIp, rateLimitedResponse } from "../_shared/rate-limit.ts";
import { cronSecretMatches } from "../_shared/plaid-webhook-register.ts";

const RATE_LIMIT = { windowMs: 60_000, max: 10 };

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function reply(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") return reply({ error: "method not allowed" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const rl = await checkRateLimit(db, `${getClientIp(req)}:rundown-counts`, RATE_LIMIT);
  if (!rl.allowed) return rateLimitedResponse({}, RATE_LIMIT, rl.resetAt);

  const given = req.headers.get("x-rundown-secret");
  const { data: row } = await db.from("rundown_read_secret").select("sha256_hex").eq("id", 1).maybeSingle();
  // No stored hash, or no header: refuse. cronSecretMatches returns false for an empty expected.
  const ok = given !== null && cronSecretMatches(await sha256Hex(given), row?.sha256_hex ?? undefined);
  if (!ok) return reply({ error: "unauthorized" }, 401);

  const { data, error } = await db.rpc("business_user_counts");
  if (error || !Array.isArray(data) || data.length !== 1) {
    return reply({ error: "counts unavailable" }, 503);
  }
  const c = data[0] as Record<string, number>;
  return reply({
    as_of: new Date().toISOString(),
    total: Number(c.total),
    excluded_reserved: Number(c.excluded_reserved),
    real_users: Number(c.real_users),
    new_7d: Number(c.new_7d),
    active_7d: Number(c.active_7d),
    active_30d: Number(c.active_30d),
  }, 200);
});
