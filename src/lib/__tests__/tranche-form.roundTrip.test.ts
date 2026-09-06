// THE FORM MUST NOT SILENTLY DESTROY A FIELD THE READER UNDERSTANDS.
//
// ⚠️ THIS HAS NOW HAPPENED TWICE IN THE SAME FILE, WHICH IS WHY IT IS A TEST AND NOT A COMMENT.
//
//   1. `min_payment`, from `ef75f6d5` until 2026-08-22. `parseTranches` read it, `tranchesToRows`
//      dropped it one line later, and `rowsToTranches` could not write it back — so saving a card
//      for ANY reason, a rename or a balance edit, binned its instalment schedule. Tre's Prime
//      Visa carried $524.40/mo of Chase Equal Pay minimums through that window on luck alone.
//      A warning was added to `TranchePayload` saying every field the reader takes must appear
//      there.
//
//   2. `monthly_fee` and `fixed_term`, found 2026-09-06. Added to `BalanceTranche`, parsed,
//      normalised, given their own test file — and never added to the form. So a Chase Pay Over
//      Time fee could not be ENTERED, and would have been ERASED by any save if one had ever been
//      written by hand. **The warning from the first occurrence did not prevent the second.**
//
// So the invariant gets a test that fails on the NEXT new field rather than a sentence somebody
// has to read. The check is a round trip: what `parseTranches` produces must survive
// `tranchesToRows` → `rowsToTranches` unchanged.

import { describe, it, expect } from 'vitest';
import { parseTranches } from '@/lib/balance-tranches';
import { tranchesToRows, rowsToTranches } from '@/lib/tranche-form';

/** Every field the reader understands, all set to a distinctive non-default value. */
const FULL = {
  id: 'tranche-1',
  label: 'PayPal Zettle',
  balance: 1322.5,
  apr: 0,
  promo_end_date: '2027-09-07',
  min_payment: 124.06,
  monthly_fee: 13.85,
  fixed_term: true,
};

describe('the form round trip loses nothing', () => {
  it('⚠️ EVERY field parseTranches produces survives a load-and-save', () => {
    const [read] = parseTranches([FULL]);
    const { tranches } = rowsToTranches(tranchesToRows([FULL]));
    const [written] = parseTranches(tranches);

    // Compared as whole objects, deliberately: naming the fields here would have to be updated by
    // the same person who forgot to update the form, which is no check at all.
    expect(written).toEqual(read);
  });

  it('⚠️ names the fields explicitly too, so a failure says WHICH one was dropped', () => {
    const { tranches } = rowsToTranches(tranchesToRows([FULL]));
    expect(tranches?.[0]).toMatchObject({
      label: 'PayPal Zettle',
      balance: 1322.5,
      apr: 0,
      promo_end_date: '2027-09-07',
      min_payment: 124.06,
      monthly_fee: 13.85,
      fixed_term: true,
    });
  });

  it('a minimal tranche stays minimal — unset fields are ABSENT, not null or ""', () => {
    // The stored shape must stay the one the SQL-seeded rows use, or every card grows keys that
    // carry no information.
    const { tranches } = rowsToTranches(tranchesToRows([
      { id: 'x', label: 'Purchases', balance: 500, apr: 27.49 },
    ]));
    expect(Object.keys(tranches![0]).sort()).toEqual(['apr', 'balance', 'id', 'label']);
  });

  it('⚠️ `fixed_term: false` is not written — only `true` carries information', () => {
    const { tranches } = rowsToTranches(tranchesToRows([{ ...FULL, fixed_term: false }]));
    expect(tranches![0]).not.toHaveProperty('fixed_term');
  });

  it('a zero or negative fee is treated as absent, exactly as min_payment is', () => {
    for (const fee of [0, -5]) {
      const { tranches } = rowsToTranches(tranchesToRows([{ ...FULL, monthly_fee: fee }]));
      expect(tranches![0]).not.toHaveProperty('monthly_fee');
    }
  });
});
