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
          // Deactivated, never deleted — the row, its history and its id all survive, and one flag
          // undoes it. References are NOT re-pointed: see supersede-connection.ts on why an
          // automatic remap would guess, on money.
          await supabase.from("accounts")
            .update({ active: false, updated_at: nowIso })
            .eq("user_id", userId)
            .in("connection_id", superseded);
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
