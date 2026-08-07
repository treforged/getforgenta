/**
 * plaid-create-link-token
 *
 * Phase 4.1 — gated behind plan_status = active/trialing (premium only)
 * Phase 4.3 — rejects if user already has >= 10 linked institutions
 * Phase 4.5 — enables only `transactions` + `balance` products
 *
 * Required env vars (set in Supabase dashboard → Edge Functions → Secrets):
 *   PLAID_CLIENT_ID
 *   PLAID_SECRET
 *   PLAID_ENV  (sandbox | production)  defaults to sandbox
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, getClientIp, rateLimitedResponse } from "../_shared/rate-limit.ts";

const MAX_LINKED = 10;
const RATE_LIMIT = { windowMs: 60_000, max: 10 };

/**
 * Where Plaid sends the user once Hosted Link finishes. Pinned here rather than
 * accepted from the client: it is a redirect target, and taking one from request
 * input would let a caller point the end of a Plaid session anywhere. Matches
 * CFBundleURLSchemes in ios/App/App/Info.plist and the appUrlOpen handler in
 * src/App.tsx. Custom scheme by Plaid's requirement — https is rejected.
 */
const HOSTED_COMPLETION_URI = "com.treforged.forged://plaid-complete";

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Rate limit
  const ip = getClientIp(req);
  const rl = await checkRateLimit(supabase, `${ip}:plaid-link-token`, RATE_LIMIT);
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

    // 4.1 — Gate: premium only
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

    // 4.3 — Enforce max 10 linked institutions.
    // Counts every provider, not just Plaid, so an Akoya fallback connection
    // still occupies a slot.
    const { count } = await supabase
      .from("financial_connections")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    if ((count ?? 0) >= MAX_LINKED) {
      return new Response(JSON.stringify({ error: `Maximum ${MAX_LINKED} linked institutions allowed` }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Accept optional redirect_uri, plaid_item_id and hosted-link opt-in from client
    let bodyJson: Record<string, unknown> = {};
    try { bodyJson = await req.clone().json(); } catch { /* no body */ }
    const redirectUri   = typeof bodyJson.redirect_uri   === "string" ? bodyJson.redirect_uri   : undefined;
    const relinkItemId  = typeof bodyJson.plaid_item_id  === "string" ? bodyJson.plaid_item_id  : undefined;
    // Native clients ask for Hosted Link: Plaid hosts the whole flow on its own
    // page, which we open in an SFSafariViewController / Custom Tab instead of
    // rendering Plaid's iframe inside our webview. See the client for why.
    const hosted        = bodyJson.hosted === true;

    const linkTokenBody: Record<string, unknown> = {
      client_id:    PLAID_CLIENT_ID,
      secret:       PLAID_SECRET,
      client_name:  "Forgenta",
      country_codes: ["US"],
      language:     "en",
      user: { client_user_id: userId },
    };
    if (hosted) {
      // Hosted Link runs Plaid's own OAuth hand-off on Plaid's domain, so the
      // app's redirect_uri does not apply and passing both is rejected.
      linkTokenBody.hosted_link = {
        is_mobile_app: true,
        completion_redirect_uri: HOSTED_COMPLETION_URI,
      };
    } else if (redirectUri) {
      linkTokenBody.redirect_uri = redirectUri;
    }

    if (relinkItemId) {
      // Update mode — re-link existing item to add liabilities product
      // Read the base table, not the plaid_items view — the view deliberately
      // omits access_token so it can never leak through PostgREST.
      const { data: plaidItem } = await supabase
        .from("financial_connections")
        .select("access_token")
        .eq("user_id", userId)
        .eq("provider", "plaid")
        .eq("provider_item_id", relinkItemId)
        .maybeSingle();

      if (!plaidItem?.access_token) {
        return new Response(JSON.stringify({ error: "Plaid item not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      linkTokenBody.access_token = plaidItem.access_token;
      linkTokenBody.additional_consented_products = ["liabilities"];
    } else {
      // New link — transactions required; liabilities optional so institutions
      // without liability accounts (checking-only banks, credit unions, etc.) still connect.
      linkTokenBody.products = ["transactions"];
      linkTokenBody.optional_products = ["liabilities"];
    }

    const res = await fetch(`${plaidBase}/link/token/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(linkTokenBody),
    });
    const body = await res.json();
    if (!res.ok) {
      console.error("Plaid link/token/create error:", JSON.stringify(body));
      return new Response(JSON.stringify({ error: body.error_message ?? "Plaid error" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (hosted && !body.hosted_link_url) {
      // Hosted Link is a dashboard-enabled feature. Failing loudly here beats
      // handing the client a token it has no way to open.
      console.error("Plaid returned no hosted_link_url; is Hosted Link enabled for this client?");
      return new Response(JSON.stringify({ error: "Hosted Link is not enabled for this Plaid client" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (hosted) {
      // Bind the link_token to this user. plaid-hosted-link-result trades a
      // link_token for a public_token, so without this row anyone holding a
      // leaked hosted_link_url could attach someone else's bank to their own
      // account. Same single-use, service-role-only store Akoya uses; the TTL is
      // widened to 30 minutes because a real person picking a bank and doing MFA
      // routinely takes longer than the table's 10-minute default.
      const { error: stateErr } = await supabase.from("oauth_states").insert({
        state:        body.link_token,
        user_id:      userId,
        provider:     "plaid",
        redirect_uri: HOSTED_COMPLETION_URI,
        expires_at:   new Date(Date.now() + 30 * 60_000).toISOString(),
      });
      if (stateErr) {
        console.error("Failed to persist plaid hosted link state:", stateErr.message);
        return new Response(JSON.stringify({ error: "Could not start the connection" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(
      JSON.stringify({
        link_token: body.link_token,
        ...(hosted ? { hosted_link_url: body.hosted_link_url } : {}),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("plaid-create-link-token:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
