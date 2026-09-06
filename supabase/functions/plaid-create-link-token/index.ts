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
import { decideBankLink, FREE_LINK_USED_MESSAGE } from "../_shared/bank-link-entitlement.ts";

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

    // 4.1 — Gate: the FIRST connection is free, the SECOND is where premium starts.
    //
    // Until 2026-09-06 this returned 403 to everyone without premium, so the only 2 of 31
    // accounts that ever linked a bank did it BECAUSE they already had premium. Twenty-nine
    // were asked for $89.99 for automatic bank sync without ever seeing it work on their own
    // money, and zero have ever paid. Premium keeps all 10 institutions — the free tier gained
    // one, premium lost nothing.
    //
    // ⚠️ THIS IS A READ, NOT A WRITE. The grant is CONSUMED in plaid-exchange-token, once an
    // item actually exists: Plaid bills on the item, and somebody who opens Link and backs out
    // has cost nothing. Burning their one free link on an abandoned flow would be charging them
    // for our own modal.
    //
    // ⚠️ A RELINK IS NOT A NEW LINK and must not be gated. It carries `plaid_item_id`, and
    // refusing it would strand a free user whose bank needs re-auth with a connection they
    // cannot repair — taking away something they already have, which this change must not do.
    // The count of live connections is unchanged by a relink, so an ungated relink cannot be
    // used to obtain a second one.
    let gateBody: Record<string, unknown> = {};
    try { gateBody = await req.clone().json(); } catch { /* no body */ }
    const isRelink = typeof gateBody.plaid_item_id === "string" && gateBody.plaid_item_id.length > 0;

    if (!isRelink) {
      // Counts every provider, not just Plaid, so an Akoya fallback connection still occupies
      // a slot — both for the premium ceiling and for the single free one.
      const decision = await decideBankLink(supabase, userId, MAX_LINKED);
      if (!decision.allowed) {
        return new Response(JSON.stringify({
          error: decision.reason === "free_link_used"
            ? FREE_LINK_USED_MESSAGE
            : `Maximum ${MAX_LINKED} linked institutions allowed`,
          code: decision.reason,
        }), {
          status: decision.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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
      // ⚠️ THE COMMENT THAT USED TO BE HERE WAS WRONG, AND IT COST THREE WEEKS.
      // It said "the app's redirect_uri does not apply and passing both is
      // rejected", so this branch deliberately omitted `redirect_uri`. Plaid says
      // the exact opposite, and this is the error every native tap was getting
      // (Tre, 2026-09-02, from the device):
      //
      //   "redirect_uri and hosted_link.completion_redirect_uri must be set when
      //    hosted_link.is_mobile_app is set to true"
      //
      // Both are required together. They are different things: `redirect_uri` is
      // the HTTPS URI Plaid hands an OAuth bank back to and MUST be whitelisted in
      // the Plaid dashboard, while `completion_redirect_uri` is the app-scheme URI
      // Plaid sends the user to once the hosted flow finishes.
      if (!redirectUri) {
        // Fail here, with the reason, rather than posting a request Plaid will
        // reject with a message the client never surfaces. Silence is what made
        // this take three weeks to see.
        return new Response(JSON.stringify({
          error: "hosted_link_requires_redirect_uri",
          message:
            "Hosted Link needs an HTTPS redirect_uri as well as the app-scheme " +
            "completion URI. Set VITE_PLAID_OAUTH_REDIRECT_URI in the app's env " +
            "AND whitelist that exact URI in the Plaid dashboard under " +
            "Team Settings > API > Allowed redirect URIs.",
        }), {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      linkTokenBody.redirect_uri = redirectUri;
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
