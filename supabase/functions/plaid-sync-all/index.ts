/**
 * plaid-sync-all
 *
 * Called by pg_cron every day at 13:00 UTC (8am EST / 9am EDT).
 * Syncs balances for ALL premium users across EVERY provider — despite the
 * name, which is kept because the pg_cron schedule references it.
 * Secured by CRON_SECRET header — no user JWT required.
 *
 * This used to carry its own copy of the Plaid sync logic. It now shares
 * _shared/sync-handler.ts with the interactive endpoints, so provider rules,
 * the minimum-payment policy and the rotation mutex only exist in one place.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  CONNECTION_COLUMNS,
  syncConnection,
} from "../_shared/sync-handler.ts";
import type { FinancialConnection, ProviderContext } from "../_shared/providers/index.ts";

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected || secret !== expected) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Only sync paying subscribers.
  const { data: premiumSubs, error: subsErr } = await db
    .from("user_subscriptions")
    .select("user_id")
    .eq("plan", "premium")
    .in("subscription_status", ["active", "trialing"]);

  if (subsErr) {
    console.error("Failed to fetch premium subscriptions:", subsErr.message);
    return new Response(JSON.stringify({ error: subsErr.message }), { status: 500 });
  }

  const premiumUserIds = (premiumSubs ?? []).map((s) => s.user_id);
  if (premiumUserIds.length === 0) {
    return new Response(
      JSON.stringify({ synced: 0, reason: "no active premium users" }),
      { status: 200 },
    );
  }

  const { data: connections, error: connErr } = await db
    .from("financial_connections")
    .select(CONNECTION_COLUMNS)
    .in("user_id", premiumUserIds)
    .neq("connection_status", "revoked")
    .returns<FinancialConnection[]>();

  if (connErr) {
    console.error("Failed to fetch financial_connections:", connErr.message);
    return new Response(JSON.stringify({ error: connErr.message }), { status: 500 });
  }

  if (!connections || connections.length === 0) {
    return new Response(JSON.stringify({ synced: 0 }), { status: 200 });
  }

  // BATCH tells Akoya no consumer is waiting on the response, so providers can
  // deprioritise it against real-time traffic. Plaid ignores the context.
  const ctx: ProviderContext = {
    lastAccessAt: new Date().toISOString(),
    interaction: "BATCH",
  };

  let totalSynced = 0;
  for (const connection of connections) {
    const touched = await syncConnection(db, connection, ctx);
    totalSynced += touched.length;
  }

  console.log(
    `Daily sync complete: ${totalSynced} accounts across ${connections.length} connections`,
  );
  return new Response(
    JSON.stringify({ synced: totalSynced, connections: connections.length }),
    { status: 200 },
  );
});
