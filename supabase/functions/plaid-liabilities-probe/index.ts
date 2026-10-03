/**
 * plaid-liabilities-probe - READ-ONLY: what Plaid /liabilities/get says for ONE user's cards (ec48da25).
 *
 * Built to match each card's stored statement balance, due day and minimum against the bank's own
 * figures. It writes NOTHING: no accounts row, no connection row, no cursor. It reads the user's
 * Plaid connections, calls /liabilities/get per item, and returns the facts beside what the sync
 * policy WOULD store, so the table and the policy can be checked against each other.
 *
 *   { user_id: "<uuid>" }    required - a probe is never widened to every user
 *
 * AUTH: `x-cron-secret` must equal CRON_SECRET, the same guard as plaid-webhook-register. That
 * secret lives in the Vault and this function's env, so only the database (pg_net) or a holder of
 * the service role can call it. verify_jwt = false, like the other cron-called functions.
 *
 * New surface, stated: anyone can POST here; without the secret it returns 401 before any read.
 * The response never carries an access token. It does carry one user's card balances, so it is
 * called only from SQL and its reply lives in net._http_response (service-role only).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cronSecretMatches } from "../_shared/plaid-webhook-register.ts";
import {
  dueDayFromDate,
  factsFromPlaidLiability,
  statementAmountStillDue,
} from "../_shared/providers/statement-sync-policy.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reply(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ error: "method not allowed" }, 405);
  if (!cronSecretMatches(req.headers.get("x-cron-secret"), Deno.env.get("CRON_SECRET"))) {
    return reply({ error: "unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const userId = typeof body.user_id === "string" && UUID.test(body.user_id) ? body.user_id : null;
  if (!userId) return reply({ error: "user_id (uuid) is required" }, 400);

  const clientId = Deno.env.get("PLAID_CLIENT_ID");
  const secret = Deno.env.get("PLAID_SECRET");
  if (!clientId || !secret) return reply({ error: "Plaid not configured" }, 503);
  const base = `https://${Deno.env.get("PLAID_ENV") || "sandbox"}.plaid.com`;

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: conns, error } = await db
    .from("financial_connections")
    .select("id, provider_item_id, institution_name, connection_status, access_token")
    .eq("provider", "plaid")
    .eq("user_id", userId)
    .not("access_token", "is", null);
  if (error) return reply({ error: error.message }, 500);

  const today = new Date().toISOString().slice(0, 10);
  const items = [];
  for (const c of conns ?? []) {
    const item: Record<string, unknown> = {
      connection_id: c.id, institution: c.institution_name, connection_status: c.connection_status,
      ok: false, error_code: null, cards: [],
    };
    try {
      const res = await fetch(`${base}/liabilities/get`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, secret, access_token: c.access_token }),
      });
      const out = await res.json().catch(() => ({}));
      item.ok = res.ok;
      if (!res.ok) {
        item.error_code = out?.error_code ?? String(res.status);
      } else {
        const names = new Map<string, Record<string, unknown>>();
        for (const a of (out.accounts ?? [])) names.set(a.account_id, a);
        item.cards = (out.liabilities?.credit ?? []).map((liab: Record<string, unknown>) => {
          const facts = factsFromPlaidLiability(liab);
          const acct = names.get(liab.account_id as string) ?? {};
          return {
            plaid_account_id: liab.account_id,
            name: acct.name ?? null,
            mask: acct.mask ?? null,
            ...facts,
            minimum_payment_amount: liab.minimum_payment_amount ?? null,
            is_overdue: liab.is_overdue ?? null,
            would_store_statement_balance: statementAmountStillDue(facts, today),
            would_seed_due_day: dueDayFromDate(facts.nextPaymentDueDate),
          };
        });
      }
    } catch (e) {
      item.error_code = e instanceof Error ? e.message : String(e);
    }
    items.push(item);
  }

  console.log(`plaid-liabilities-probe: user ${userId.slice(0, 8)}, ${items.length} items, ` +
    `${items.filter((i) => i.ok).length} ok`);
  return reply({ today, examined: items.length, items }, 200);
});
