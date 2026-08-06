/**
 * financial-sync — provider-agnostic account sync.
 *
 * The implementation lives in _shared/sync-handler.ts, which plaid-sync also
 * serves so both endpoint names behave identically.
 */

import { handleSync } from "../_shared/sync-handler.ts";

Deno.serve(handleSync);
