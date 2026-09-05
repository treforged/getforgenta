/**
 * revenue-push — sends a revenue SUMMARY to the Conductor's own database.
 *
 * WHY PUSH INSTEAD OF LETTING THE BOARD READ. The alternative was giving the
 * Conductor a Supabase credential. A service_role key would hand the board WRITE
 * access to every financial table here — transactions, accounts, debts,
 * subscriptions — to serve one SELECT. The anon key reads nothing under RLS and
 * ships inside Forgenta's web app, so anything it can read is effectively public,
 * and a revenue table is not that. So no Forgenta credential exists on the board
 * at all: the blast radius is one summary table it already owns.
 *
 * WHAT GOES OVER THE WIRE: counts, grouped. No user id, no customer id, no
 * email, no amount. The receiving table cannot identify a person because nothing
 * on a row belongs to one — and Nora's endpoint rejects those field names, so the
 * rule is enforced on both sides rather than trusted on one.
 *
 * ⛔ IT SENDS WHAT THE TABLE SAYS, INCLUDING WHAT IS WRONG WITH IT. No cleaning,
 * no coalescing a bad value into a good one. The board renders a malformed group
 * as malformed and says so on screen. A push that tidies its source hides drift
 * instead of showing it, and the drift is the reason to look at the panel at all.
 * (`plan='active'` was exactly that: one row, three and a half months, a real
 * subscriber silently on the free tier. It is fixed in the TABLE and a CHECK
 * constraint now forbids it — which is where such a fix belongs.)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CONDUCTOR_URL = Deno.env.get("CONDUCTOR_URL") ?? "https://conductor.treforged.com/api/session";

/** One line per (provider, plan, status). `ending` counts cancel_at_period_end. */
interface RevenueLine {
  provider: string; plan: string; status: string;
  /**
   * PAYING subscribers only.
   *
   * ⚠️ This used to be every row in the group, which meant five comped accounts were pushed
   * to Tre as five active Stripe subscribers while the account's entire charge history was one
   * $4.99 test payment on his own card. A number that reads as traction and is not is the
   * expensive kind of wrong, so `revenue_summary_lines` now filters this to `not is_comp`.
   */
  count: number;
  ending: number;
  /**
   * Carried for free. Reported ALONGSIDE the paying count, never folded into it.
   *
   * How many people are on a comp is real information Tre wants; it just must never be
   * totalled as revenue. Dropping them would answer the reporting bug by hiding data, which
   * is not the same thing as fixing it.
   */
  comped: number;
}

/** Nora's endpoint caps this; sending more is a 400 for the whole push. */
const MAX_LINES = 200;

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected || secret !== expected) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }

  const conductorSecret = Deno.env.get("CONDUCTOR_SESSION_SECRET");
  if (!conductorSecret) {
    return new Response(JSON.stringify({ error: "CONDUCTOR_SESSION_SECRET is not set" }), { status: 500 });
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Grouped in SQL rather than in JS: the rows never leave the database
  // individually, so there is no point in the process where a per-user record
  // exists in memory and could be logged by accident.
  const { data, error } = await db.rpc("revenue_summary_lines");
  if (error) {
    return new Response(JSON.stringify({ error: `summary query failed: ${error.message}` }), { status: 500 });
  }

  const lines = (data ?? []) as RevenueLine[];
  if (lines.length === 0) {
    // Not an error worth 500ing on, but not silence either: zero groups means
    // the table is empty or the query changed shape, and both deserve saying.
    return new Response(JSON.stringify({ pushed: 0, note: "no subscription rows to summarise" }), { status: 200 });
  }
  if (lines.length > MAX_LINES) {
    return new Response(JSON.stringify({ error: `${lines.length} lines exceeds the endpoint's ${MAX_LINES}` }), { status: 500 });
  }

  const res = await fetch(CONDUCTOR_URL, {
    method: "POST",
    headers: { "x-session-secret": conductorSecret, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "revenue", sessionId: crypto.randomUUID(), lines }),
  });
  const body = await res.text();
  if (!res.ok) {
    // 400 = no usable lines, 503 = it did not store. Both are reported with the
    // status, because "the push failed" without the code is not diagnosable.
    return new Response(JSON.stringify({ error: `conductor refused: ${res.status}`, body }), { status: 502 });
  }

  // Totals in the response so a person reading the cron output sees the split without having
  // to add up the groups themselves -- and cannot mistake the comped figure for revenue.
  const paying = lines.reduce((n, l) => n + (l.count ?? 0), 0);
  const comped = lines.reduce((n, l) => n + (l.comped ?? 0), 0);

  return new Response(JSON.stringify({
    pushed: lines.length, paying, comped, conductor: JSON.parse(body),
  }, null, 2), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
