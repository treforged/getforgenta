// Who may link a bank, now that the FIRST one is free and the SECOND is where premium starts.
//
// Every assertion here is protecting real money. Plaid bills per linked Item, so the expensive
// mistake is not refusing somebody - it is letting one account mint items in a loop. The two
// cases that matter most:
//
//   1. `free_bank_link_grants` is consulted at all. Unlinking HARD-DELETES the
//      `financial_connections` row, so a gate that only counted live rows would be a retry loop:
//      link free, unlink, link free again, one paid item every time. The test "a free account
//      that unlinked cannot link again" is that loop, and it fails the moment the grant lookup
//      is dropped.
//   2. A FAILED grant lookup refuses. A gate that opens when its own read errors is not a gate.
//
// Would-fail checks (each verified by mutation): make the grant lookup unconditional-allow and
// the unlink case fails; treat a lookup error as "no grant" and the error case fails; drop the
// live-connection check and the simultaneous-second-link case fails.

import { describe, it, expect } from 'vitest';
import {
  decideBankLink,
  FREE_LINK_LIMIT,
} from '../../../supabase/functions/_shared/bank-link-entitlement';

const MAX_LINKED = 10;

interface StubState {
  plan?: string;
  status?: string;
  liveConnections: number;
  grantRow?: { user_id: string } | null;
  grantError?: boolean;
}

/**
 * The narrowest stub that still exercises the real code path. It answers exactly the three
 * queries `decideBankLink` makes, and throws on anything else - a stub that silently answered
 * an unexpected query would let the function under test drift without a test noticing.
 */
function stubClient(state: StubState) {
  return {
    from(table: string) {
      if (table === 'user_subscriptions') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: state.plan
                  ? { plan: state.plan, subscription_status: state.status }
                  : null,
              }),
            }),
          }),
        };
      }
      if (table === 'financial_connections') {
        return {
          select: () => ({
            eq: async () => ({ count: state.liveConnections }),
          }),
        };
      }
      if (table === 'free_bank_link_grants') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: state.grantError ? null : (state.grantRow ?? null),
                error: state.grantError ? { message: 'boom' } : null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };
}

const decide = (state: StubState) => decideBankLink(stubClient(state), 'user-1', MAX_LINKED);

describe('decideBankLink', () => {
  it('lets a brand-new free account link its first bank', async () => {
    const d = await decide({ liveConnections: 0, grantRow: null });
    expect(d).toEqual({ allowed: true, tier: 'free' });
  });

  it('refuses a free account that already has a live connection', async () => {
    const d = await decide({ liveConnections: 1, grantRow: null });
    expect(d).toEqual({ allowed: false, reason: 'free_link_used', status: 402 });
  });

  it('refuses a free account that UNLINKED and is trying again', async () => {
    // The retry loop. No live connections, but the grant was spent - and every one of these
    // costs a paid Plaid item, so this is the assertion that protects the bill.
    const d = await decide({ liveConnections: 0, grantRow: { user_id: 'user-1' } });
    expect(d).toEqual({ allowed: false, reason: 'free_link_used', status: 402 });
  });

  it('refuses when the grant lookup itself FAILS', async () => {
    // A gate that opens when its own read errors is not a gate.
    const d = await decide({ liveConnections: 0, grantError: true });
    expect(d).toEqual({ allowed: false, reason: 'free_link_used', status: 402 });
  });

  it('lets premium link a second bank, where a free account is refused', async () => {
    const premium = await decide({ plan: 'premium', status: 'active', liveConnections: 1 });
    expect(premium).toEqual({ allowed: true, tier: 'premium' });

    const free = await decide({ liveConnections: 1, grantRow: null });
    expect(free.allowed).toBe(false);
  });

  it('treats a trialing subscription as premium', async () => {
    const d = await decide({ plan: 'premium', status: 'trialing', liveConnections: 3 });
    expect(d).toEqual({ allowed: true, tier: 'premium' });
  });

  it('does NOT treat a cancelled premium plan as premium', async () => {
    // It falls back to the free rules rather than to "allowed": one connection, then the wall.
    const d = await decide({ plan: 'premium', status: 'canceled', liveConnections: 1, grantRow: null });
    expect(d).toEqual({ allowed: false, reason: 'free_link_used', status: 402 });
  });

  it('still stops premium at the MAX_LINKED ceiling', async () => {
    const d = await decide({ plan: 'premium', status: 'active', liveConnections: MAX_LINKED });
    expect(d).toEqual({ allowed: false, reason: 'max_linked', status: 422 });
  });

  it('ignores a spent grant for a premium account', async () => {
    // Somebody who used the free link and THEN paid must not be held to the free rule.
    const d = await decide({
      plan: 'premium', status: 'active', liveConnections: 1, grantRow: { user_id: 'user-1' },
    });
    expect(d).toEqual({ allowed: true, tier: 'premium' });
  });

  it('grants exactly one free link', () => {
    expect(FREE_LINK_LIMIT).toBe(1);
  });
});
