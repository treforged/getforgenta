/**
 * plaid-webhook-register - point EXISTING Plaid items at plaid-webhook (one-shot admin action).
 *
 * New items get the webhook from plaid-create-link-token. Items linked earlier have none, so this
 * sets it with /item/webhook/update. The rules live in _shared/plaid-webhook-register.ts:
 *
 *   {}                                  dry run: /item/get on every item, report current webhook
 *   { apply: true, item_ids: ["..."] }  update only those items
 *   { apply: true, all: true }          update every item
 *
 * Every row reports `before` (read with /item/get BEFORE any write) and `after` (read again AFTER
 * it), so the dry-run output IS the undo list and the apply output is its own confirmation.
 *
 * AUTH: `x-cron-secret` must equal CRON_SECRET - the same guard as plaid-sync-all. That secret
 * lives in the Vault and in this function's env, so only the database (pg_net) or a holder of the
 * service role can call it. verify_jwt = false, like the other cron-called functions.
 *
 * New surface, stated: anyone can POST here; without the secret it returns 401 before any read.
 * The response never carries an access token. /item/get and /item/webhook/update are not billed.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type Candidate,
  cronSecretMatches,
  type ItemOutcome,
  needsUpdate,
  parseRegisterRequest,
  plaidWebhookUrl,
  selectTargets,
} from "../_shared/plaid-webhook-register.ts";

function reply(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ error: "method not allowed" }, 405);
  if (!cronSecretMatches(req.headers.get("x-cron-secret"), Deno.env.get("CRON_SECRET"))) {
    return reply({ error: "unauthorized" }, 401);
  }

  const parsed = parseRegisterRequest(await req.json().catch(() => ({})));
  if (!parsed.ok) return reply({ error: parsed.error }, 400);
  const { req: request } = parsed;

  const clientId = Deno.env.get("PLAID_CLIENT_ID");
  const secret = Deno.env.get("PLAID_SECRET");
  if (!clientId || !secret) return reply({ error: "Plaid not configured" }, 503);
  const base = `https://${Deno.env.get("PLAID_ENV") || "sandbox"}.plaid.com`;
  const webhook = plaidWebhookUrl(Deno.env.get("SUPABASE_URL")!);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: rows, error } = await db
    .from("financial_connections")
    .select("id, user_id, provider_item_id, connection_status, access_token")
    .eq("provider", "plaid")
    .not("access_token", "is", null)
    .order("created_at", { ascending: true });
  if (error) return reply({ error: error.message }, 500);

  const tokenByItem = new Map<string, string>();
  const candidates: Candidate[] = (rows ?? []).map((r) => {
    tokenByItem.set(r.provider_item_id as string, r.access_token as string);
    return {
      connection_id: r.id as string,
      user_id: r.user_id as string,
      item_id: r.provider_item_id as string,
      connection_status: r.connection_status as string,
    };
  });
  const { targets, missing } = selectTargets(candidates, request);

  const plaid = async (path: string, extra: Record<string, unknown>) => {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, secret, ...extra }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${path}: ${body?.error_code ?? res.status} ${body?.error_message ?? ""}`.trim());
    return body;
  };
  const currentWebhook = async (access_token: string): Promise<string | null> =>
    ((await plaid("/item/get", { access_token }))?.item?.webhook as string | null | undefined) || null;

  const results: (ItemOutcome & { connection_id: string; user_id: string; connection_status: string })[] = [];
  for (const t of targets) {
    const access_token = tokenByItem.get(t.item_id)!;
    const row = { ...t, before: null as string | null, after: null as string | null, changed: false, error: null as string | null };
    try {
      row.before = await currentWebhook(access_token);
      if (request.apply && needsUpdate(row.before, webhook)) {
        await plaid("/item/webhook/update", { access_token, webhook });
        row.changed = true;
      }
      row.after = request.apply ? await currentWebhook(access_token) : row.before;
    } catch (e) {
      row.error = e instanceof Error ? e.message : String(e);
    }
    results.push(row);
  }

  const confirmed = results.filter((r) => r.after === webhook).length;
  console.log(`plaid-webhook-register ${request.apply ? "APPLY" : "dry-run"}: ${results.length} items, ` +
    `${results.filter((r) => r.changed).length} changed, ${confirmed} now on the webhook, ` +
    `${results.filter((r) => r.error).length} errors, ${missing.length} not found`);

  return reply({
    mode: request.apply ? "apply" : "dry-run",
    webhook_url: webhook,
    examined: results.length,
    changed: results.filter((r) => r.changed).length,
    confirmed_on_webhook: confirmed,
    errors: results.filter((r) => r.error).length,
    missing,
    results,
  }, 200);
});
