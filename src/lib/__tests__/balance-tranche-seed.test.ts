/**
 * Auto-seeding balance tranches from Plaid's aprs[].
 *
 * Two things are load-bearing here and both are about NOT writing:
 *  1. `promo_end_date` is user-entered and Plaid has no equivalent, so nothing produced by the
 *     sync may ever carry that key — a null written over a real date is silent data loss.
 *  2. An account that already has tranches is the user's; the sync leaves the column alone.
 *
 * The seed is asserted through `parseTranches` — the real consumer in src/lib/balance-tranches.ts —
 * rather than by shape alone, so a seed that the app would silently discard fails here.
 */

import { describe, expect, it } from 'vitest';
import { parseTranches } from '../balance-tranches';
import {
  shouldSeedTranches,
  trancheLabelForAprType,
  tranchesFromPlaidAprs,
} from '../../../supabase/functions/_shared/providers/balance-tranche-seed';

/** Deterministic ids so assertions can name them. */
function seqIds(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

/** A card shaped like Tre's real Discover: a promo balance transfer plus the purchase rate. */
const DISCOVER_APRS = [
  {
    apr_type: 'balance_transfer_apr',
    apr_percentage: 7.99,
    balance_subject_to_apr: 5037.73,
    interest_charge_amount: 33.53,
  },
  {
    apr_type: 'purchase_apr',
    apr_percentage: 16.6,
    balance_subject_to_apr: 5279.12,
    interest_charge_amount: 72.92,
  },
];

describe('tranchesFromPlaidAprs', () => {
  it('seeds a tranche from a non-purchase rate carrying a balance', () => {
    const tranches = tranchesFromPlaidAprs(DISCOVER_APRS, seqIds());

    expect(tranches).toEqual([
      { id: 'id-1', label: 'Balance transfer', balance: 5037.73, apr: 7.99 },
    ]);
  });

  it('EXCLUDES purchase_apr — it is the account-level rate, not a tranche', () => {
    const tranches = tranchesFromPlaidAprs(DISCOVER_APRS, seqIds());

    expect(tranches.map((t) => t.apr)).not.toContain(16.6);
    // Seeding it too would double-count the purchase balance against the remainder.
    expect(tranches).toHaveLength(1);
  });

  it('NEVER emits promo_end_date — Plaid has no such field to supply', () => {
    const tranches = tranchesFromPlaidAprs(
      [
        { apr_type: 'special', apr_percentage: 0, balance_subject_to_apr: 1200 },
        ...DISCOVER_APRS,
      ],
      seqIds(),
    );

    expect(tranches.length).toBeGreaterThan(0);
    for (const t of tranches) {
      expect(Object.keys(t)).toEqual(['id', 'label', 'balance', 'apr']);
      expect('promo_end_date' in t).toBe(false);
    }
    // And the consumer reads the absence as "permanent rate", not as a cleared date.
    expect(parseTranches(tranches).map((t) => t.promo_end_date)).toEqual([null, null]);
  });

  it('skips entries with a zero, negative or absent balance_subject_to_apr', () => {
    const tranches = tranchesFromPlaidAprs(
      [
        { apr_type: 'balance_transfer_apr', apr_percentage: 0, balance_subject_to_apr: 0 },
        { apr_type: 'cash_apr', apr_percentage: 29.99, balance_subject_to_apr: null },
        { apr_type: 'special', apr_percentage: 4.99 },
        { apr_type: 'cash_apr', apr_percentage: 29.99, balance_subject_to_apr: -50 },
      ],
      seqIds(),
    );

    // An absent balance is "no reading", not a zero — neither is worth a row the user must delete.
    expect(tranches).toEqual([]);
  });

  it('skips entries with an unusable apr_percentage', () => {
    const tranches = tranchesFromPlaidAprs(
      [
        { apr_type: 'cash_apr', apr_percentage: null, balance_subject_to_apr: 400 },
        { apr_type: 'special', apr_percentage: 'n/a', balance_subject_to_apr: 400 },
        { apr_type: 'special', apr_percentage: -1, balance_subject_to_apr: 400 },
      ],
      seqIds(),
    );

    expect(tranches).toEqual([]);
  });

  it('accepts numerics sent as strings', () => {
    const tranches = tranchesFromPlaidAprs(
      [{ apr_type: 'cash_apr', apr_percentage: '29.99', balance_subject_to_apr: '150.25' }],
      seqIds(),
    );

    expect(tranches).toEqual([
      { id: 'id-1', label: 'Cash advance', balance: 150.25, apr: 29.99 },
    ]);
  });

  it('tolerates a missing, malformed or non-array aprs payload', () => {
    expect(tranchesFromPlaidAprs(undefined)).toEqual([]);
    expect(tranchesFromPlaidAprs(null)).toEqual([]);
    expect(tranchesFromPlaidAprs({})).toEqual([]);
    expect(tranchesFromPlaidAprs([null, 'nonsense', 42], seqIds())).toEqual([]);
    // An entry with no apr_type cannot be labelled honestly, so it is dropped.
    expect(tranchesFromPlaidAprs([{ apr_percentage: 5, balance_subject_to_apr: 10 }])).toEqual([]);
  });

  it('produces a seed parseTranches accepts unchanged', () => {
    const tranches = tranchesFromPlaidAprs(DISCOVER_APRS, seqIds());
    const parsed = parseTranches(tranches);

    expect(parsed).toEqual([
      { id: 'id-1', label: 'Balance transfer', balance: 5037.73, apr: 7.99, promo_end_date: null, min_payment: null },
    ]);
  });

  it('defaults to real uuids when no id factory is injected', () => {
    const [tranche] = tranchesFromPlaidAprs(DISCOVER_APRS);

    expect(tranche.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});

describe('trancheLabelForAprType', () => {
  it('names the rates Plaid documents the way a statement would', () => {
    expect(trancheLabelForAprType('balance_transfer_apr')).toBe('Balance transfer');
    expect(trancheLabelForAprType('cash_apr')).toBe('Cash advance');
    expect(trancheLabelForAprType('special')).toBe('Promotional rate');
  });

  it('humanises an apr_type it has never seen rather than dropping the balance', () => {
    expect(trancheLabelForAprType('introductory_apr')).toBe('Introductory');
    expect(trancheLabelForAprType('deferred_interest_apr')).toBe('Deferred interest');
    // Never blank: parseTranches would silently substitute 'Promo balance'.
    expect(trancheLabelForAprType('_apr')).toBe('Promotional rate');
  });
});

describe('shouldSeedTranches', () => {
  const seed = [{ id: 'id-1', label: 'Balance transfer', balance: 100, apr: 7.99 }];

  it('seeds when the column is null or an empty array', () => {
    expect(shouldSeedTranches(null, seed)).toBe(true);
    expect(shouldSeedTranches(undefined, seed)).toBe(true);
    expect(shouldSeedTranches([], seed)).toBe(true);
  });

  it('REFUSES when the account already has tranches', () => {
    const userEntered = [
      { id: 'u-1', label: 'Promo from Prime Visa', balance: 5037.73, apr: 7.99, promo_end_date: '2028-01-04' },
    ];

    expect(shouldSeedTranches(userEntered, seed)).toBe(false);
  });

  it('refuses on an unrecognised column shape rather than guessing', () => {
    expect(shouldSeedTranches({ tranches: [] }, seed)).toBe(false);
    expect(shouldSeedTranches('[]', seed)).toBe(false);
  });

  it('writes nothing when the provider supplied no tranches', () => {
    // An empty seed must not overwrite null with [] — that is a write with no information in it.
    expect(shouldSeedTranches(null, [])).toBe(false);
    expect(shouldSeedTranches([], [])).toBe(false);
  });
});
