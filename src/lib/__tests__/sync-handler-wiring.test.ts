/**
 * The WIRING of persistAccount — handoff item 4.
 *
 * The two pure policies (resolveAprOnSync, shouldSeedTranches) each have their own suite; what
 * was untested was whether persistAccount actually APPLIES their answers to the row it writes.
 * That gap is exactly how the original defect lived: `apr_plaid_synced` was written but never
 * READ, so a hand-typed APR was overwritten on every sync while the policy that should have
 * prevented it sat unexercised. These tests pin the call sites:
 *   - insert stamps apr_plaid_synced when (and only when) the provider supplied the apr
 *   - update writes the apr the policy DECIDED, not the apr the provider OFFERED
 *   - a kept-manual apr never re-stamps apr_plaid_synced
 *   - tranches are seeded only through shouldSeedTranches — a user's rows are never in the payload
 *   - a manual min_payment is never in the update payload
 *
 * The fake below implements only the exact PostgREST chains persistAccount uses; a new call
 * shape fails loudly rather than vanishing into a stub.
 */

import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { persistAccount } from '../../../supabase/functions/_shared/sync-handler';
import type {
  FinancialConnection,
  NormalizedAccount,
} from '../../../supabase/functions/_shared/providers/index';

type Row = Record<string, unknown>;

/** Captures what persistAccount writes. `existing` = the row the select finds (null = insert path). */
function fakeDb(existing: Row | null) {
  const writes: { inserted?: Row; updated?: Row; updatedId?: unknown } = {};
  const db = {
    from(table: string) {
      if (table !== 'accounts') throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: existing }) }),
          }),
        }),
        insert: async (payload: Row) => {
          writes.inserted = payload;
          return { error: null };
        },
        update: (payload: Row) => ({
          eq: async (_col: string, id: unknown) => {
            writes.updated = payload;
            writes.updatedId = id;
            return { error: null };
          },
        }),
      };
    },
  };
  return { db: db as unknown as SupabaseClient, writes };
}

const connection: FinancialConnection = {
  id: 'conn-1', user_id: 'user-1', provider: 'plaid', provider_item_id: 'item-1',
  institution_id: null, institution_name: 'Discover Bank', access_token: 'tok',
  refresh_token_encrypted: null, id_token_encrypted: null, token_expires_at: null,
  connection_status: 'active', sync_cursor: null, last_synced_at: null,
};

function account(overrides: Partial<NormalizedAccount>): NormalizedAccount {
  return {
    providerAccountId: 'acct-1', name: 'Discover it Card', accountType: 'credit_card',
    balance: 10316.73, creditLimit: 15000, apr: null, minPayment: 229,
    liabilityDataAvailable: true, balanceTranches: [],
    ...overrides,
  };
}

const NOW = '2026-08-14T13:00:00.000Z';

describe('persistAccount — insert path stamps provenance', () => {
  it('stamps apr_plaid_synced true when the provider supplied the apr', async () => {
    const { db, writes } = fakeDb(null);
    await persistAccount(db, 'user-1', connection, account({ apr: 24.99 }), NOW);
    expect(writes.inserted?.apr).toBe(24.99);
    expect(writes.inserted?.apr_plaid_synced).toBe(true);
  });

  it('omits the flag entirely when the provider gave no apr — null must not read as provider-owned', async () => {
    const { db, writes } = fakeDb(null);
    await persistAccount(db, 'user-1', connection, account({ apr: null }), NOW);
    expect(writes.inserted).toBeDefined();
    expect('apr_plaid_synced' in writes.inserted!).toBe(false);
  });

  it('seeds provider tranches on a brand-new row (no user rows exist to protect)', async () => {
    const { db, writes } = fakeDb(null);
    const seed = [{ id: 't1', label: 'Balance transfer', balance: 5037.73, apr: 7.99 }];
    await persistAccount(db, 'user-1', connection, account({ balanceTranches: seed }), NOW);
    expect(writes.inserted?.balance_tranches).toEqual(seed);
  });
});

describe('persistAccount — update path writes the policy decision, not the provider offer', () => {
  // Tre's real Discover: apr 16.6 hand-corrected, apr_plaid_synced false, daily cron offering
  // whatever Plaid has. The 2026-08-14 13:00 UTC run proved this live; these pin it in CI.
  const manualDiscover: Row = {
    id: 'row-1', apr: '16.6', apr_plaid_synced: false,
    credit_limit: 15000, min_payment_is_manual: false, balance_tranches: null,
  };

  it('keeps a manual apr against a provider offer, and does not re-stamp the flag', async () => {
    const { db, writes } = fakeDb(manualDiscover);
    await persistAccount(db, 'user-1', connection, account({ apr: 24.99 }), NOW);
    expect(writes.updatedId).toBe('row-1');
    expect(writes.updated?.apr).toBe(16.6);
    expect('apr_plaid_synced' in writes.updated!).toBe(false);
  });

  it('adopts the provider apr and stamps the flag when the stored apr was provider-owned', async () => {
    const { db, writes } = fakeDb({ ...manualDiscover, apr_plaid_synced: true });
    await persistAccount(db, 'user-1', connection, account({ apr: 24.99 }), NOW);
    expect(writes.updated?.apr).toBe(24.99);
    expect(writes.updated?.apr_plaid_synced).toBe(true);
  });

  it('never puts balance_tranches in the payload when the user already has rows', async () => {
    const userRows = [{ id: 'u1', label: 'Balance transfer promo', balance: 5037.73, apr: 7.99, promo_end_date: '2028-01-04' }];
    const { db, writes } = fakeDb({ ...manualDiscover, balance_tranches: userRows });
    const seed = [{ id: 't1', label: 'Cash advance', balance: 100, apr: 29.99 }];
    await persistAccount(db, 'user-1', connection, account({ balanceTranches: seed }), NOW);
    expect('balance_tranches' in writes.updated!).toBe(false);
  });

  it('seeds tranches on update only when the column is empty', async () => {
    const { db, writes } = fakeDb({ ...manualDiscover, balance_tranches: null });
    const seed = [{ id: 't1', label: 'Balance transfer', balance: 5037.73, apr: 7.99 }];
    await persistAccount(db, 'user-1', connection, account({ balanceTranches: seed }), NOW);
    expect(writes.updated?.balance_tranches).toEqual(seed);
  });

  it('a manual min_payment is never in the update payload', async () => {
    const { db, writes } = fakeDb({ ...manualDiscover, min_payment_is_manual: true });
    await persistAccount(db, 'user-1', connection, account({ minPayment: 350 }), NOW);
    expect('min_payment' in writes.updated!).toBe(false);
  });
});
