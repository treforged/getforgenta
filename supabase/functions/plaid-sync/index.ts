/**
 * plaid-sync — retained endpoint name, provider-agnostic behaviour.
 *
 * This function used to hold the Plaid sync logic directly. That logic now lives
 * in _shared/sync-handler.ts and dispatches by provider, so this endpoint syncs
 * a user's Akoya connections too.
 *
 * It stays deployed under the old name because the nightly cron job and app
 * builds already in users' hands call it. New callers should use financial-sync.
 *
 * The legacy request shapes are still honoured by the shared handler:
 *   { action: "delink", plaid_item_id }
 *   { force?: boolean, item_id?: string }
 */

import { handleSync } from "../_shared/sync-handler.ts";

Deno.serve(handleSync);
