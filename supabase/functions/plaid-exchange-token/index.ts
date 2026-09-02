/**
 * plaid-exchange-token
 *
 * Exchanges a Plaid public_token (from Link success callback) for a permanent
 * access_token + item_id, then persists to plaid_items.
 *
 * Also runs a secondary check on max 3 linked institutions (defense-in-depth
 * alongside plaid-create-link-token).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, getClientIp, rateLimitedResponse } from "../_shared/rate-limit.ts";
import { planSupersededConnections } from "../_shared/supersede-connection.ts";
import { planAccountRetirement } from "../_shared/retire-accounts.ts";

const MAX_LINKED  = 10;
const RATE_LIMIT  = { windowMs: 60_000, max: 10 };

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const ip = getClientIp(req);
  const rl = await checkRateLimit(supabase, `${ip}:plaid-exchange`, RATE_LIMIT);
  if (!rl.allowed) return rateLimitedResponse(corsHeaders, RATE_LIMIT, rl.resetAt);

  try {
    const PLAID_CLIENT_ID = Deno.env.get("PLAID_CLIENT_ID");
    const PLAID_SECRET    = Deno.env.get("PLAID_SECRET");
    if (!PLAID_CLIENT_ID || !PLAID_SECRET) {
      return new Response(JSON.stringify({ error: "Plaid not configured" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const plaidEnv  = Deno.env.get("PLAID_ENV") || "sandbox";
    const plaidBase = `https://${plaidEnv}.plaid.com`;

    // Verify JWT
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: jwtErr } = await userClient.auth.getUser();
    if (jwtErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;

    // Premium gate
    const { data: sub } = await supabase
      .from("user_subscriptions")
      .select("plan, subscription_status")
      .eq("user_id", userId)
      .maybeSingle();
    const isActive = sub?.plan === "premium" &&
      ["active", "trialing"].includes(sub?.subscription_status ?? "");
    if (!isActive) {
      return new Response(JSON.stringify({ error: "Premium subscription required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Defense-in-depth cap. Counts connections across every provider so an
    // Akoya fallback also occupies a slot.
    const { count } = await supabase
      .from("financial_connections")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if ((count ?? 0) >= MAX_LINKED) {
      return new Response(JSON.stringify({ error: `Maximum ${MAX_LINKED} linked institutions allowed` }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse body
    let public_token: string;
    let institution_id: string | null = null;
    let institution_name: string | null = null;
    try {
      const body = await req.json();
      public_token     = body.public_token;
      institution_id   = body.institution_id   ?? null;
      institution_name = body.institution_name ?? null;
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!public_token) {
      return new Response(JSON.stringify({ error: "public_token required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Exchange public_token → access_token + item_id
    const exchangeRes = await fetch(`${plaidBase}/item/public_token/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: PLAID_CLIENT_ID, secret: PLAID_SECRET, public_token }),
    });
    const exchangeBody = await exchangeRes.json();
    if (!exchangeRes.ok) {
      console.error("Plaid exchange error:", JSON.stringify(exchangeBody));
      return new Response(JSON.stringify({ error: exchangeBody.error_message ?? "Plaid exchange failed" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { access_token, item_id } = exchangeBody;

    // ── THE INSTITUTION ID MUST NOT DEPEND ON THE CLIENT ────────────────────────
    // Supersession is keyed on `institution_id`, and `planSupersededConnections` returns an EMPTY
    // ARRAY when it is null - deliberately, because without it there is no safe way to tell "the
    // same bank again" from "a second bank". That safety turns into a silent no-op the moment the
    // id goes missing.
    //
    // Which is exactly what happened on 2026-09-02. The HOSTED (native) flow gets its
    // institution_id from Plaid's link-session results, and for Robinhood that came back null. So
    // the client posted null, the supersede block was skipped entirely, and Tre ended up with TWO
    // active Robinhood connections double-counting $2,054.85 - while the web flow, which gets the
    // id from Link metadata, had been superseding correctly all along.
    //
    // `/item/get` answers it authoritatively from the access token we just minted, so the tidy-up
    // no longer depends on which flow the user came through or on what the provider chose to echo
    // back. Non-fatal: a failure here leaves institution_id null, which is exactly today's
    // behaviour rather than a worse one.
    if (!institution_id) {
      try {
        const itemRes = await fetch(`${plaidBase}/item/get`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: PLAID_CLIENT_ID, secret: PLAID_SECRET, access_token }),
        });
        const itemBody = await itemRes.json();
        if (itemRes.ok) {
          institution_id = itemBody.item?.institution_id ?? null;
          console.log(`Resolved institution_id ${institution_id} from /item/get (client sent none)`);
        } else {
          console.error("Plaid /item/get failed:", JSON.stringify(itemBody));
        }
      } catch (e) {
        console.error("Plaid /item/get threw:", e instanceof Error ? e.message : String(e));
      }
    }

    // Resolve institution name if not passed from Link metadata
    if (!institution_name && institution_id) {
      try {
        const instRes = await fetch(`${plaidBase}/institutions/get_by_id`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: PLAID_CLIENT_ID,
            secret: PLAID_SECRET,
            institution_id,
            country_codes: ["US"],
          }),
        });
        const instBody = await instRes.json();
        institution_name = instBody.institution?.name ?? null;
      } catch {
        // Non-fatal — institution_name just stays null
      }
    }

    // Persist to financial_connections (service role bypasses RLS).
    // Reset last_synced_at so the next sync always hits Plaid fresh, even if the
    // item was synced recently (covers the reconnect case).
    const { error: insertErr } = await supabase.from("financial_connections").upsert({
      user_id: userId,
      provider: "plaid",
      provider_item_id: item_id,
      access_token,
      institution_id,
      institution_name,
      connection_status: "active",
      last_synced_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,provider,provider_item_id" });

    if (insertErr) {
      console.error("plaid_items insert error:", insertErr.message);
      return new Response(JSON.stringify({ error: "Failed to save linked bank" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── SUPERSEDE THE OLD LINK TO THIS SAME BANK ────────────────────────────────
    // Plaid issues NEW account ids on a re-link, so `persistAccount` cannot recognise the accounts
    // it already has and inserts duplicates instead. Both connections then keep syncing and the
    // stale rows sit in net worth forever — which is exactly what happened to Robinhood on
    // 2026-08-21 ($251.53 counted twice, two rows with the same name).
    //
    // Failures here are logged and swallowed on purpose: the link itself succeeded, the user's
    // token is saved, and refusing a working connection because the tidy-up failed would trade a
    // cosmetic problem for a real one. The duplicate is visible and fixable; a lost link is not.
    if (institution_id) {
      try {
        const { data: priorConnections } = await supabase
          .from("financial_connections")
          .select("id, institution_id, provider_item_id, connection_status")
          .eq("user_id", userId);

        const superseded = planSupersededConnections(priorConnections ?? [], {
          institution_id,
          provider_item_id: item_id,
        });

        if (superseded.length > 0) {
          const nowIso = new Date().toISOString();
          // `revoked` is the one status `plaid-sync-all` skips. Without this the old item keeps
          // syncing and re-activates the very rows deactivated below.
          await supabase.from("financial_connections")
            .update({ connection_status: "revoked", updated_at: nowIso })
            .in("id", superseded);
          // A duplicate nobody references is DELETED; one something points at is only hidden.
          // See retire-accounts.ts for why that split rather than "delete them all".
          const { data: staleRows } = await supabase.from("accounts")
            .select("id").eq("user_id", userId).in("connection_id", superseded);
          const staleIds: string[] = (staleRows ?? []).map((r: { id: string }) => r.id);

          if (staleIds.length > 0) {
            // ⚠️ A FAILED LOOKUP MUST MEAN "REFERENCED", NEVER "NOT REFERENCED". If any of these
            // queries errors and we treat its result as empty, the plan deletes rows that a goal
            // or a rule still points at. So an error here marks EVERYTHING referenced, which
            // degrades to the old deactivate-only behaviour instead of to data loss.
            let lookupFailed = false;
            const referenced = new Set<string>();
            const collect = (
              rows: Record<string, unknown>[] | null,
              err: unknown,
              cols: string[],
            ) => {
              if (err) { lookupFailed = true; return; }
              for (const row of rows ?? []) {
                for (const c of cols) {
                  const v = row[c];
                  if (typeof v === "string" && v) referenced.add(v);
                }
              }
            };

            const goals = await supabase.from("savings_goals")
              .select("linked_account").eq("user_id", userId).in("linked_account", staleIds);
            collect(goals.data, goals.error, ["linked_account"]);

            const rules = await supabase.from("recurring_rules")
              .select("payment_source, deposit_account").eq("user_id", userId);
            collect(rules.data, rules.error, ["payment_source", "deposit_account"]);

            const txns = await supabase.from("transactions")
              .select("account, payment_source").eq("user_id", userId).in("account", staleIds);
            collect(txns.data, txns.error, ["account", "payment_source"]);

            const funds = await supabase.from("car_funds")
              .select("linked_account, loan_payment_account").eq("user_id", userId);
            collect(funds.data, funds.error, ["linked_account", "loan_payment_account"]);

            const plan = lookupFailed
              ? { deletable: [], deactivateOnly: staleIds }
              : planAccountRetirement(staleIds, referenced);

            if (plan.deactivateOnly.length > 0) {
              await supabase.from("accounts")
                .update({ active: false, updated_at: nowIso })
                .eq("user_id", userId).in("id", plan.deactivateOnly);
            }
            if (plan.deletable.length > 0) {
              await supabase.from("accounts")
                .delete().eq("user_id", userId).in("id", plan.deletable);
            }
            console.log(
              `Retired ${staleIds.length} account(s): deleted ${plan.deletable.length}, ` +
              `kept ${plan.deactivateOnly.length} that are still referenced` +
              (lookupFailed ? " (reference lookup FAILED - nothing deleted)" : ""),
            );
          }
          console.log(
            `Superseded ${superseded.length} prior connection(s) to ${institution_id} for user ${userId}`,
          );
        }
      } catch (supersedeErr) {
        console.error("plaid-exchange-token supersede step failed:", supersedeErr);
      }
    }

    return new Response(JSON.stringify({ institution_name, plaid_item_id: item_id }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("plaid-exchange-token:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
