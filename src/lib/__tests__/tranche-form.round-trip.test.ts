// The Accounts edit form must not destroy a field the reader honours.
//
// `min_payment` reached `balance_tranches` in ef75f6d5 but never reached `tranche-form.ts`, so from
// then until 2026-08-22 the form parsed the value on load, dropped it, and wrote it away on save:
// opening Tre's Prime Visa and pressing save for ANY reason — a rename, a balance edit, a due-day
// change — would have binned $524.40/mo of Chase Equal Pay instalments, silently and with no
// recovery outside SQL. It survived on luck, not on design.
//
// The general rule this locks: ANY field parseTranches reads must survive a load/save cycle
// untouched. The shape below is Tre's real Prime Visa as stored on 2026-08-22.

import { describe, it, expect } from 'vitest';
import { tranchesToRows, rowsToTranches, newTrancheRow } from '../tranche-form';
import { parseTranches } from '../balance-tranches';

const PRIME_VISA_STORED = [
  { id: '0ae30f92-efc5-4d5c-8567-54fb60d000de', apr: 0, label: 'Equal Pay Promo (exp Feb 2027)', balance: 299.32, min_payment: 49.89, promo_end_date: '2027-02-07' },
  { id: 'ca09ac29-3ed6-4e70-a8bc-9513983ae0b6', apr: 0, label: 'Equal Pay Promo (exp Jul 2027)', balance: 3561.65, min_payment: 323.79, promo_end_date: '2027-07-07' },
  { id: '9fbef60c-10aa-43e3-8cdf-ac8121b4eaa6', apr: 0, label: 'Equal Pay Promo (exp Jul 2027, $980.90)', balance: 899.15, min_payment: 81.75, promo_end_date: '2027-07-07' },
  { id: '7061cddb-2b75-4bce-b251-de37f96909dd', apr: 0, label: 'Equal Pay Promo (exp Aug 2027)', balance: 827.63, min_payment: 68.97, promo_end_date: '2027-08-07' },
];

describe('tranche-form — a load/save cycle preserves every field the reader honours', () => {
  it('keeps all four Prime Visa Equal Pay instalments through an untouched save', () => {
    const { tranches, invalidRows } = rowsToTranches(tranchesToRows(PRIME_VISA_STORED));

    expect(invalidRows).toEqual([]);
    expect(tranches).toHaveLength(4);
    // The whole point: $524.40/mo of contractual instalments must still be there.
    const total = tranches!.reduce((s, t) => s + (t.min_payment ?? 0), 0);
    expect(total).toBeCloseTo(524.40, 2);
    expect(tranches!.map(t => t.min_payment)).toEqual([49.89, 323.79, 81.75, 68.97]);
  });

  it('round-trips byte-for-byte through what the reader actually parses', () => {
    const saved = rowsToTranches(tranchesToRows(PRIME_VISA_STORED)).tranches;
    expect(parseTranches(saved)).toEqual(parseTranches(PRIME_VISA_STORED));
  });

  it('is stable under repeated open-and-save, not just the first one', () => {
    const once = rowsToTranches(tranchesToRows(PRIME_VISA_STORED)).tranches;
    const twice = rowsToTranches(tranchesToRows(once)).tranches;
    expect(twice).toEqual(once);
  });

  it('omits min_payment rather than writing 0 when a tranche has no schedule', () => {
    // Tre's Discover balance-transfer promo: a rate with no instalment. The stored shape stays
    // minimal — absent, not `null`, not `0` — matching the SQL-seeded rows.
    const discover = [{ id: '3581c39c', apr: 7.99, label: 'Balance transfer promo', balance: 5037.73, promo_end_date: '2028-01-04' }];
    const [saved] = rowsToTranches(tranchesToRows(discover)).tranches!;
    expect('min_payment' in saved).toBe(false);
  });

  it('accepts a blank instalment typed into a fresh row', () => {
    const row = { ...newTrancheRow(), balance: '1000', apr: '0' };
    expect(row.min_payment).toBe('');
    const { tranches, invalidRows } = rowsToTranches([row]);
    expect(invalidRows).toEqual([]);
    expect('min_payment' in tranches![0]).toBe(false);
  });

  it('carries a user-typed instalment into the payload', () => {
    const row = { ...newTrancheRow(), balance: '1000', apr: '0', min_payment: '83.33' };
    expect(rowsToTranches([row]).tranches![0].min_payment).toBe(83.33);
  });
});
