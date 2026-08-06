/**
 * akoya-exchange-token
 *
 * Completes the Akoya OAuth flow: validates the CSRF state, trades the
 * authorization code for the token pair, and stores the connection with both
 * tokens encrypted at rest.
 *
 * Runs entirely server-side. Akoya's guidance is explicit that the client
 * secret must never reach the device, and that the authorization code must not
 * be exchanged in the browser and handed back as a token in a URL.
 *
 * The authorization code expires five minutes after issue.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, getClientIp, rateLimitedResponse } from "../_shared/rate-limit.ts";
import {
  encryptTokenSet,
  exchangeAuthorizationCode,
} from "../_shared/providers/akoya.ts";

const MAX_LINKED = 10;
const RATE_LIMIT = { windowMs: 60_000, max: 10 };

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const ip = getClientIp(req);
  const rl = await checkRateLimit(db, `${ip}:akoya-exchange`, RATE_LIMIT);
  if (!rl.allowed) return rateLimitedResponse(cors, RATE_LIMIT, rl.resetAt);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401, cors);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: jwtErr } = await userClient.auth.getUser();
    if (jwtErr || !user) return json({ error: "Unauthorized" }, 401, cors);
    const userId = user.id;

    const body = await req.json().catch(() => ({}));
    const code = typeof body?.code === "string" ? body.code : "";
    const state = typeof body?.state === "string" ? body.state : "";
    if (!code || !state) return json({ error: "code and state are required" }, 400, cors);

    // ── Validate state ───────────────────────────────────────────────────────
    // Must exist, belong to this user, be unconsumed and unexpired. Anything
    // else is either a replay or a forged callback.
    const { data: stateRow } = await db
      .from("oauth_states")
      .select("state, user_id, provider, connector, expires_at, consumed_at")
      .eq("state", state)
      .maybeSingle();

    if (
      !stateRow ||
      stateRow.user_id !== userId ||
      stateRow.provider !== "akoya" ||
      stateRow.consumed_at !== null ||
      new Date(stateRow.expires_at).getTime() < Date.now()
    ) {
      console.warn(`Rejected Akoya callback state for user ${userId}`);
      return json({ error: "This connection request is no longer valid. Please try again." }, 400, cors);
    }

    // Consume before the exchange so a replayed callback can't reuse the code
    // even if the exchange itself is slow.
    const { data: consumed } = await db
      .from("oauth_states")
      .update({ consumed_at: new Date().toISOString() })
      .eq("state", state)
      .is("consumed_at", null)
      .select("state");
    if ((consumed?.length ?? 0) === 0) {
      return json({ error: "This connection request was already used." }, 400, cors);
    }

    const connector = stateRow.connector;
    if (!connector) return json({ error: "Connection request is missing its institution" }, 400, cors);

    const { count } = await db
      .from("financial_connections")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if ((count ?? 0) >= MAX_LINKED) {
      return json({ error: `Maximum ${MAX_LINKED} linked institutions allowed` }, 422, cors);
    }

    // ── Exchange ─────────────────────────────────────────────────────────────
    const tokens = await exchangeAuthorizationCode(code);
    const encrypted = await encryptTokenSet(tokens);

    // institution_id holds the Akoya connector: it is the path segment every
    // subsequent data call needs.
    const { data: connection, error: upsertErr } = await db
      .from("financial_connections")
      .upsert({
        user_id: userId,
        provider: "akoya",
        provider_item_id: connector,
        institution_id: connector,
        institution_name: typeof body?.institution_name === "string"
          ? body.institution_name
          : connector,
        access_token: null,
        refresh_token_encrypted: encrypted.refreshTokenEncrypted,
        id_token_encrypted: encrypted.idTokenEncrypted,
        token_expires_at: encrypted.tokenExpiresAt,
        connection_status: "active",
        // Force the next sync to hit Akoya rather than sit out the cooldown.
        last_synced_at: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,provider,provider_item_id" })
      .select("id, institution_name")
      .single();

    if (upsertErr) {
      console.error("financial_connections upsert failed:", upsertErr.message);
      return json({ error: "Failed to save the connection" }, 500, cors);
    }

    return json(
      {
        connection_id: connection.id,
        institution_name: connection.institution_name,
        provider: "akoya",
      },
      200,
      cors,
    );
  } catch (err) {
    console.error("akoya-exchange-token:", err);
    return json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      500,
      cors,
    );
  }
});
