/**
 * Connection revocation, shared by every path that has to cut a user's bank
 * links: account deletion, and subscription lapse from either billing webhook.
 *
 * These three used to carry near-identical copies of a Plaid-only routine.
 * Dispatching through the provider registry means an Akoya connection is
 * revoked on the same paths, which is what the privacy policy commits to.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type FinancialConnection, getProvider } from "./providers/index.ts";
import { CONNECTION_COLUMNS } from "./sync-handler.ts";

/**
 * Revokes every connection the user holds at its provider.
 *
 * Best-effort per connection: one provider being unreachable must never block
 * the deletion or downgrade the caller is performing. Rows are left in place —
 * the caller decides whether to remove them.
 */
export async function revokeAllConnections(
  db: SupabaseClient,
  userId: string,
  logPrefix = "",
): Promise<void> {
  const { data: connections } = await db
    .from("financial_connections")
    .select(CONNECTION_COLUMNS)
    .eq("user_id", userId)
    .returns<FinancialConnection[]>();

  if (!connections || connections.length === 0) return;

  await Promise.all(
    connections.map(async (connection) => {
      try {
        await getProvider(connection.provider).disconnect(connection);
      } catch (e) {
        console.error(
          `${logPrefix}${connection.provider} revoke failed for ${connection.id}:`,
          e,
        );
      }
    }),
  );
}

/**
 * Revokes, then drops the connections and deactivates the accounts they fed.
 *
 * Accounts are deactivated rather than deleted so a user who resubscribes still
 * sees their last known balances.
 */
export async function unlinkAllConnections(
  db: SupabaseClient,
  userId: string,
  logPrefix = "",
): Promise<void> {
  await revokeAllConnections(db, userId, logPrefix);

  await db.from("financial_connections").delete().eq("user_id", userId);
  await db
    .from("accounts")
    .update({ active: false })
    .eq("user_id", userId)
    .not("plaid_account_id", "is", null);
}
