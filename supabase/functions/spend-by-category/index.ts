/**
 * spend-by-category — GET, read-only: the caller's month-to-date spending by bank category, for Leo
 * (ask fbc5671a, Vera). Contract and the spending rules: ./aggregate.ts.
 *
 * GET ?month=YYYY-MM (optional; default is the current UTC month - Leo should pass its local month).
 * 200 {month, categories:[{name, spent_cents}], computed_at}. An empty month is 200 with
 * categories [] (no bank rows is a real answer, not an error). 400 {"error":"bad-month"};
 * 401 {"error":"unauthorized"}; 429 {"error":"rate-limited"}; anything else {"error":"failed"}.
 *
 * NEVER USES THE SERVICE-ROLE KEY: the anon key plus the CALLER's Authorization header, so RLS
 * scopes the read. ⚠️ RLS ALSO LETS A LINKED PARTNER READ THESE ROWS (synced_transactions_select_
 * partner), so the query filters user_id = the caller explicitly - without it, a user with a
 * partner link would hear their partner's spending summed into their own. 30/min through
 * `spend_by_category_rate_ok()`. Logs never carry an amount, a row or a token.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { aggregateSpend, monthRange, parseMonth } from "./aggregate.ts";

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

  const now = new Date();
  const rawMonth = new URL(req.url).searchParams.get("month");
  const month = rawMonth === null ? now.toISOString().slice(0, 7) : parseMonth(rawMonth);
  if (!month) return json(400, { error: "bad-month" });

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) {
    console.error("[spend-by-category] missing SUPABASE_URL or SUPABASE_ANON_KEY");
    return json(500, { error: "server-misconfigured" });
  }

  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return json(401, { error: "unauthorized" });

  const { data: ok, error: rlErr } = await supabase.rpc("spend_by_category_rate_ok");
  if (rlErr) {
    console.error("[spend-by-category] rate check failed:", rlErr.code ?? "unknown");
    return json(500, { error: "failed" });
  }
  if (ok !== true) return json(429, { error: "rate-limited" });

  const { from, to } = monthRange(month);
  const { data: rows, error: readErr } = await supabase
    .from("synced_transactions")
    .select("amount, date, category, pending, provider_transaction_id, pending_transaction_id")
    .eq("user_id", userData.user.id)
    .gte("date", from)
    .lt("date", to)
    .limit(5000);
  if (readErr) {
    console.error("[spend-by-category] read failed:", readErr.code ?? "unknown");
    return json(500, { error: "failed" });
  }
  return json(200, aggregateSpend(rows ?? [], month, now));
});
