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
function fakeDb(existing: Row | null, owned: Row[] = [], byId: Record<string, Row> = {}) {
  const writes: { inserted?: Row; updated?: Row; updatedId?: unknown } = {};
  const db = {
    from(table: string) {
      if (table !== 'accounts') throw new Error(`unexpected table ${table}`);
      return {
        // Three chains now, and each is spelled out rather than stubbed loosely:
        //   .eq(user).eq(plaid).maybeSingle()  the provider-id lookup
        //   .eq(user)                          the claim scan, awaited directly
        //   .eq(id).maybeSingle()              re-reading a claimed row
        select: () => ({
          eq: (col: string, val: unknown) => ({
            eq: () => ({ maybeSingle: async () => ({ data: existing }) }),
            maybeSingle: async () => ({ data: col === 'id' ? (byId[String(val)] ?? null) : existing }),
            then: (res: (v: { data: Row[] }) => unknown) => res({ data: owned }),
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

// A USER-CHOSEN NAME IS THEIRS (2026-08-21).
//
// The name used to be written from the provider on every single sync, which is why the edit form
// disabled the field: letting a user rename an account only for the next sync to revert it is worse
// than not offering the rename at all. The cost was that the app could not tell two accounts apart
// when the provider gave them the SAME name — Robinhood handed back two rows both called
// "Robinhood individual", one personal and one traded by an agent.
//
// Would-fail check: remove the `delete update.name` line and the first test here fails while every
// other test in this file stays green.
describe('persistAccount — a renamed account keeps its name', () => {
  it('leaves `name` out of the update entirely once the user has renamed it', async () => {
    const { db, writes } = fakeDb({ id: 'row-1', name_is_manual: true, min_payment_is_manual: false });
    await persistAccount(db, 'user-1', connection, account({ name: 'Robinhood individual' }), NOW);
    expect(writes.updated).toBeDefined();
    expect('name' in writes.updated!).toBe(false);
  });

  it('still writes the provider name when the user has NOT renamed it', async () => {
    const { db, writes } = fakeDb({ id: 'row-1', name_is_manual: false, min_payment_is_manual: false });
    await persistAccount(db, 'user-1', connection, account({ name: 'Discover it Card' }), NOW);
    expect(writes.updated?.name).toBe('Discover it Card');
  });

  it('treats a missing flag as not-manual — every pre-migration row is unaffected', async () => {
    const { db, writes } = fakeDb({ id: 'row-1', min_payment_is_manual: false });
    await persistAccount(db, 'user-1', connection, account({ name: 'Discover it Card' }), NOW);
    expect(writes.updated?.name).toBe('Discover it Card');
  });

  it('NEVER lets the flag protect `institution` — that stays provider-owned', async () => {
    // Tre, 2026-08-21: "allow user account rename... still block institution change."
    const { db, writes } = fakeDb({ id: 'row-1', name_is_manual: true, min_payment_is_manual: false });
    await persistAccount(db, 'user-1', connection, account({}), NOW);
    expect(writes.updated?.institution).toBe('Discover Bank');
  });

  it('does not stamp the flag itself — only the edit form may claim a name', async () => {
    const { db, writes } = fakeDb({ id: 'row-1', name_is_manual: false, min_payment_is_manual: false });
    await persistAccount(db, 'user-1', connection, account({}), NOW);
    expect('name_is_manual' in writes.updated!).toBe(false);
  });
});

// ── CLAIM-ON-FIRST-SYNC ──────────────────────────────────────────────────────
// The pure decision has its own suite (`account-claim.test.ts`). What is pinned here is the
// WIRING: that persistAccount UPDATES the claimed row instead of inserting a second one, and
// that the update carries the provider id so every later sync takes the ordinary path.
//
// The defect being prevented: a card the user typed in has no plaid_account_id, so linking that
// bank inserted a duplicate — debt counted twice, a phantom credit limit, and the manual fields
// and surplus rank stranded on the original.
describe('persistAccount — claim-on-first-sync', () => {
  const handMade = {
    id: 'hand-1', account_type: 'credit_card', institution: 'Discover Bank',
    plaid_account_id: null, card_start_date: null,
  };
  const claimedRow = {
    id: 'hand-1', apr: null, apr_plaid_synced: null, credit_limit: 15000,
    min_payment_is_manual: null, name_is_manual: null, balance_tranches: null,
  };

  it('UPDATES the hand-made card instead of inserting a duplicate', async () => {
    const { db, writes } = fakeDb(null, [handMade], { 'hand-1': claimedRow });
    await persistAccount(db, 'user-1', connection, account({}), NOW);
    expect(writes.inserted, 'a duplicate row was inserted — this is the defect').toBeUndefined();
    expect(writes.updatedId).toBe('hand-1');
  });

  it('stamps the provider id on the claim, so later syncs match normally', async () => {
    const { db, writes } = fakeDb(null, [handMade], { 'hand-1': claimedRow });
    await persistAccount(db, 'user-1', connection, account({}), NOW);
    expect(writes.updated?.plaid_account_id).toBe('acct-1');
  });

  it('inserts as before when nothing is claimable', async () => {
    const other = { ...handMade, institution: 'Chase' };
    const { db, writes } = fakeDb(null, [other], {});
    await persistAccount(db, 'user-1', connection, account({}), NOW);
    expect(writes.inserted).toBeDefined();
    expect(writes.updatedId).toBeUndefined();
  });

  it('does NOT stamp a provider id on an ordinary update — only on a claim', async () => {
    // The already-linked path must not start rewriting plaid_account_id on every sync.
    const { db, writes } = fakeDb(claimedRow, [], {});
    await persistAccount(db, 'user-1', connection, account({}), NOW);
    expect(writes.updated).toBeDefined();
    expect('plaid_account_id' in (writes.updated ?? {})).toBe(false);
  });

  it('leaves a not-yet-open planned card alone and inserts instead', async () => {
    const planned = { ...handMade, card_start_date: '2027-01-01' };
    const { db, writes } = fakeDb(null, [planned], {});
    await persistAccount(db, 'user-1', connection, account({}), NOW);
    expect(writes.inserted, 'a planned card must never be welded to a real one').toBeDefined();
    expect(writes.updatedId).toBeUndefined();
  });
});
