/**
 * Whether a Plaid sync may overwrite `accounts.apr`.
 *
 * THE BUG: `min_payment` had a real manual guard, `apr` had none — the sync stored
 * `account.apr ?? existing.apr`, so a rate the user typed was replaced every night by whatever
 * the provider reported, with no trace. The real case is Tre's Discover, whose true purchase rate
 * (~16.6%, derived from the interest actually charged) contradicts the 12.89% blended figure:
 * correcting it in the app held only until the next sync.
 *
 * The flag that fixes it already existed and was already being written — `apr_plaid_synced`,
 * "the stored apr came from Plaid". These tests pin down reading it. No migration.
 */

import { describe, expect, it } from 'vitest';
import { resolveAprOnSync } from '../../../supabase/functions/_shared/providers/apr-sync-policy';

describe('resolveAprOnSync', () => {
  it("KEEPS a manual apr and does not claim it for Plaid", () => {
    // Tre's Discover, exactly: 16.6 entered by hand, flag false, Plaid offering the blended 12.89.
    const decision = resolveAprOnSync(12.89, 16.6, false);

    expect(decision.apr).toBe(16.6);
    expect(decision.markPlaidSynced).toBe(false);
    expect(decision.keptManual).toBe(true);
  });

  it('treats a NULL flag as manual too — an apr no sync claimed was typed by a person', () => {
    // Legacy rows predate the flag. Freezing a stale provider rate is visible and one tap to fix;
    // overwriting a hand-entered one destroys a number no provider can give back.
    const decision = resolveAprOnSync(12.89, 16.6, null);

    expect(decision.apr).toBe(16.6);
    expect(decision.markPlaidSynced).toBe(false);
    expect(decision.keptManual).toBe(true);
  });

  it('UPDATES an apr that came from Plaid, and keeps the flag set', () => {
    const decision = resolveAprOnSync(18.24, 16.99, true);

    expect(decision.apr).toBe(18.24);
    expect(decision.markPlaidSynced).toBe(true);
    expect(decision.keptManual).toBe(false);
  });

  it('accepts the provider value when the account has never had an apr', () => {
    expect(resolveAprOnSync(21.49, null, null)).toEqual({
      apr: 21.49,
      markPlaidSynced: true,
      keptManual: false,
    });
    // A brand-new row, before any flag exists.
    expect(resolveAprOnSync(21.49, null, false)).toEqual({
      apr: 21.49,
      markPlaidSynced: true,
      keptManual: false,
    });
  });

  it('leaves everything alone when the provider returned no apr', () => {
    // Absence is not a correction. The stored value survives whatever its origin, and the flag
    // is never touched — so a Plaid-owned rate does not get reclassified as manual by silence.
    expect(resolveAprOnSync(null, 16.6, false)).toEqual({
      apr: 16.6,
      markPlaidSynced: false,
      keptManual: false,
    });
    expect(resolveAprOnSync(null, 16.99, true)).toEqual({
      apr: 16.99,
      markPlaidSynced: false,
      keptManual: false,
    });
    expect(resolveAprOnSync(null, null, null)).toEqual({
      apr: null,
      markPlaidSynced: false,
      keptManual: false,
    });
  });

  it('treats a stored 0% as a real rate, not as "no apr"', () => {
    // A 0% intro card is a real thing. `existing.apr ?? null` would keep it, but a truthiness
    // check would not — and would hand the account back to Plaid.
    const decision = resolveAprOnSync(19.99, 0, false);

    expect(decision.apr).toBe(0);
    expect(decision.keptManual).toBe(true);
  });

  it('never invents a value: a manual apr is returned unchanged, not re-derived', () => {
    // Guards against a future "blend the two" temptation — there is one owner, and it wins whole.
    for (const stored of [7.99, 12.89, 16.6, 29.99]) {
      expect(resolveAprOnSync(5, stored, false).apr).toBe(stored);
    }
  });
});
