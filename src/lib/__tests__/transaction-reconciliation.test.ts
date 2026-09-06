// RECONCILING A PLANNED TRANSACTION WITH ITS REAL BANK ROW.
//
// ⚠️ THE FALSE-MERGE CASES MATTER MORE THAN THE TRUE ONE, and they come first below. A missed
// match costs somebody one manual edit. A WRONG match hides a real transaction they never see
// again — their money, gone from view, with the app reporting success. So every case that must
// REFUSE is pinned before the case that must succeed.
//
// Would-fail checks, all confirmed by mutation:
//   • drop the `origin !== 'manual'` guard and a bank-imported row is offered a merge with itself
//   • drop the contested-claim filter and two planned rows are both offered the same bank charge
//   • drop the direction gate and a refund reconciles a purchase
//   • return `typedAmount` instead of `actualAmount` and the silently-wrong number survives the fix

import { describe, it, expect } from 'vitest';
import {
  proposeReconciliation, proposeReconciliations, reconciledPatch,
  type PlannedTransaction,
} from '@/lib/transaction-reconciliation';
import type { MatchableTransaction } from '@/lib/transaction-matching';

const ACCT = 'acct-checking';

const planned = (over: Partial<PlannedTransaction> & { id: string }): PlannedTransaction => ({
  amount: 50, date: '2026-09-10', type: 'expense', payment_source: ACCT, origin: 'manual', ...over,
});

/** Outflow POSITIVE, matching Stage A's sign convention on `synced_transactions`. */
const bank = (over: Partial<MatchableTransaction> & { id: string }): MatchableTransaction => ({
  account_id: ACCT, amount: 50, date: '2026-09-10', pending: false, ...over,
});

describe('it refuses rather than guessing', () => {
  it('⚠️ never offers to merge a row the BANK supplied — that is a row with itself', () => {
    const row = planned({ id: 'p1', origin: 'synced' });
    expect(proposeReconciliation(row, [bank({ id: 's1' })])).toBeNull();
  });

  it('⚠️ drops BOTH proposals when two planned rows claim the same bank charge', () => {
    // Two $40 fill-ups typed on one day against a single $40 charge. Awarding it to either is a
    // coin flip, and confirming both would merge away a real transaction for ever.
    const a = planned({ id: 'p1', amount: 40 });
    const b = planned({ id: 'p2', amount: 40 });
    const one = bank({ id: 's1', amount: 40 });

    // Individually each looks like a confident match — which is exactly why the single-row
    // function cannot be the only guard.
    expect(proposeReconciliation(a, [one])).not.toBeNull();
    expect(proposeReconciliation(b, [one])).not.toBeNull();

    expect(proposeReconciliations([a, b], [one])).toEqual([]);
  });

  it('refuses when ONE planned row has two equally good bank charges', () => {
    const row = planned({ id: 'p1', amount: 40 });
    const twins = [bank({ id: 's1', amount: 40 }), bank({ id: 's2', amount: 40 })];
    expect(proposeReconciliation(row, twins)).toBeNull();
  });

  it('never reconciles a refund against a purchase', () => {
    const spend = planned({ id: 'p1', type: 'expense', amount: 50 });
    const refund = bank({ id: 's1', amount: -50 });   // inflow
    expect(proposeReconciliation(spend, [refund])).toBeNull();
  });

  it('never matches across accounts', () => {
    const row = planned({ id: 'p1' });
    expect(proposeReconciliation(row, [bank({ id: 's1', account_id: 'acct-other' })])).toBeNull();
  });

  it('ignores a PENDING bank row — a prediction cannot be corrected by a guess', () => {
    expect(proposeReconciliation(planned({ id: 'p1' }), [bank({ id: 's1', pending: true })])).toBeNull();
  });

  it('refuses when the row names no account, rather than matching on amount alone', () => {
    const row = planned({ id: 'p1', payment_source: null });
    expect(proposeReconciliation(row, [bank({ id: 's1' })])).toBeNull();
  });

  it('refuses a charge outside the date window', () => {
    const row = planned({ id: 'p1', date: '2026-09-01' });
    expect(proposeReconciliation(row, [bank({ id: 's1', date: '2026-09-20' })])).toBeNull();
  });

  it('refuses an amount too far off to be the same money', () => {
    const row = planned({ id: 'p1', amount: 50 });
    expect(proposeReconciliation(row, [bank({ id: 's1', amount: 500 })])).toBeNull();
  });
});

describe('what it proposes, and the number it corrects', () => {
  it('⚠️ proposes a TYPED ESTIMATE that the rule matcher would refuse', () => {
    // typed $50, charged $52.30 — a 4.6% gap. The rule matcher's band is max($0.05, 1%), so this
    // pair is invisible to it, and it is the exact case the feature exists for.
    const p = proposeReconciliation(planned({ id: 'p1', amount: 50 }), [bank({ id: 's1', amount: 52.30 })])!;
    expect(p).not.toBeNull();
    // Never reported as certain: an exact pair would have matched on the tight pass.
    expect(p.confidence).toBe('strong');
  });

  it('⚠️ carries BOTH figures and makes the BANK the one that wins', () => {
    // THE WHOLE POINT. He types $50, the charge is $52.30, and without this the ledger keeps $50
    // for ever with nothing telling him.
    const row = planned({ id: 'p1', amount: 50 });
    const p = proposeReconciliation(row, [bank({ id: 's1', amount: 52.30 })])!;

    expect(p.typedAmount).toBe(50);
    expect(p.actualAmount).toBe(52.30);
    expect(p.amountDiffers).toBe(true);
    expect(reconciledPatch(p).amount).toBe(52.30);
  });

  it('corrects the DATE too, and says when only the date moved', () => {
    const row = planned({ id: 'p1', amount: 50, date: '2026-09-10' });
    const p = proposeReconciliation(row, [bank({ id: 's1', amount: 50, date: '2026-09-12' })])!;

    expect(p.amountDiffers).toBe(false);
    expect(p.dateDiffers).toBe(true);
    expect(reconciledPatch(p).date).toBe('2026-09-12');
  });

  it('reports an exact pair as needing no correction at all', () => {
    const p = proposeReconciliation(planned({ id: 'p1' }), [bank({ id: 's1' })])!;
    expect(p.confidence).toBe('exact');
    expect(p.amountDiffers).toBe(false);
    expect(p.dateDiffers).toBe(false);
  });

  it('marks the row as bank-confirmed so the same proposal is not offered twice', () => {
    const p = proposeReconciliation(planned({ id: 'p1' }), [bank({ id: 's1' })])!;
    const patch = reconciledPatch(p);
    expect(patch.origin).toBe('synced');
    expect(patch.id).toBe('p1');
    // And a row carrying that origin is no longer a candidate — the loop closes.
    expect(proposeReconciliation(planned({ id: 'p1', origin: patch.origin }), [bank({ id: 's1' })]))
      .toBeNull();
  });

  it('proposes each unambiguous pair across a whole ledger and leaves the rest alone', () => {
    const rows = [
      planned({ id: 'p1', amount: 50, date: '2026-09-10' }),
      planned({ id: 'p2', amount: 120, date: '2026-09-11' }),
      planned({ id: 'p3', amount: 999, date: '2026-09-12' }),   // nothing matches this
    ];
    const bankRows = [
      bank({ id: 's1', amount: 51, date: '2026-09-10' }),
      bank({ id: 's2', amount: 120, date: '2026-09-13' }),
    ];

    const out = proposeReconciliations(rows, bankRows);
    expect(out.map(p => p.planned.id).sort()).toEqual(['p1', 'p2']);
    // p3 is untouched and stays the person's own row.
    expect(out.find(p => p.planned.id === 'p3')).toBeUndefined();
  });

  it('does not mutate either input', () => {
    const rows = [planned({ id: 'p1' })];
    const bankRows = [bank({ id: 's1' })];
    const rowsBefore = JSON.stringify(rows);
    const bankBefore = JSON.stringify(bankRows);
    proposeReconciliations(rows, bankRows);
    expect(JSON.stringify(rows)).toBe(rowsBefore);
    expect(JSON.stringify(bankRows)).toBe(bankBefore);
  });
});

// ── THE COMPARISON, REUSED BY THE SCREEN THAT ALREADY DID THE MATCHING ──────────────────────────
//
// ⚠️ ADDED 2026-09-06, when this module was found to have ZERO CALLERS — the exact "exported,
// documented, never called" shape this repo's own caller-grep gate exists to catch, in this
// repo's own work.
//
// ⚠️ AND THE MATCHING HALF TURNED OUT TO BE ALREADY BUILT. `bank-activity-queue.ts` has paired
// bank charges with hand-typed ledger rows since long before this file existed — the `ledgerTxn`
// suggestion. What was missing was never the match: accepting one writes a POINTER
// (`status: 'linked_txn'`) and nothing else, so the typed figure survives untouched. Tre types
// $50, the bank charges $52.30, the rows are linked, and the ledger keeps $50 for ever with
// nothing ever telling him. `describeReconciliation` is what lets that screen SAY the difference
// without running a second match, so the two cannot disagree about the same two numbers.

import { describeReconciliation, isBulkAcceptable } from '@/lib/transaction-reconciliation';

const typed = (amount: number, date: string) => ({
  id: 'planned-1', amount, date, type: 'expense',
  payment_source: 'acct-1', origin: 'manual',
});
const charged = (amount: number, date: string) => ({
  id: 'charge-1', account_id: 'acct-1', amount, date, pending: false,
});

describe('describeReconciliation', () => {
  it('⚠️ flags the case the whole feature exists for: typed $50, charged $52.30', () => {
    const p = describeReconciliation(typed(50, '2026-09-01'), charged(52.3, '2026-09-01'), 'strong');
    expect(p.amountDiffers).toBe(true);
    expect(p.typedAmount).toBe(50);
    expect(p.actualAmount).toBe(52.3);
    // The BANK's figure is the one that wins — it is what actually left the account.
    expect(reconciledPatch(p).amount).toBe(52.3);
  });

  it('⚠️ does NOT flag a pair that agrees — no correction, nothing to interrupt anyone with', () => {
    const p = describeReconciliation(typed(50, '2026-09-01'), charged(50, '2026-09-01'), 'exact');
    expect(p.amountDiffers).toBe(false);
    expect(p.dateDiffers).toBe(false);
  });

  it('reports a date difference on its own, with the amount untouched', () => {
    const p = describeReconciliation(typed(50, '2026-09-01'), charged(50, '2026-09-03'), 'strong');
    expect(p.amountDiffers).toBe(false);
    expect(p.dateDiffers).toBe(true);
    expect(reconciledPatch(p).date).toBe('2026-09-03');
  });

  it('⚠️ a sub-cent difference is the SAME money, not a correction to show somebody', () => {
    // Floating point on `numeric` columns must not produce a "correct $50.00 → $50.00" button.
    const p = describeReconciliation(typed(50, '2026-09-01'), charged(50.004, '2026-09-01'), 'exact');
    expect(p.amountDiffers).toBe(false);
  });

  it('compares MAGNITUDES, so a stored sign convention cannot invent a difference', () => {
    const p = describeReconciliation(typed(50, '2026-09-01'), charged(-50, '2026-09-01'), 'exact');
    expect(p.amountDiffers).toBe(false);
  });

  it('handles the string amounts a numeric column actually returns', () => {
    const p = describeReconciliation(
      { ...typed(0, '2026-09-01'), amount: '50.00' },
      { ...charged(0, '2026-09-01'), amount: '52.30' },
      'strong',
    );
    expect(p.typedAmount).toBe(50);
    expect(p.actualAmount).toBe(52.3);
    expect(p.amountDiffers).toBe(true);
  });

  it('marks the corrected row as no longer a prediction, so it is not offered again', () => {
    const p = describeReconciliation(typed(50, '2026-09-01'), charged(52.3, '2026-09-02'), 'strong');
    expect(reconciledPatch(p).origin).toBe('synced');
    expect(reconciledPatch(p).id).toBe('planned-1');
  });
});

describe('isBulkAcceptable — keeping "Accept all" unable to create money', () => {
  const agreeing = describeReconciliation(typed(50, '2026-09-01'), charged(50, '2026-09-01'), 'exact');
  const differing = describeReconciliation(typed(50, '2026-09-01'), charged(52.3, '2026-09-01'), 'strong');
  const laterDate = describeReconciliation(typed(50, '2026-09-01'), charged(50, '2026-09-03'), 'strong');

  it('a plain suggestion is still bulk-acceptable — the pre-existing rule is unchanged', () => {
    expect(isBulkAcceptable(true, undefined)).toBe(true);
    expect(isBulkAcceptable(true, agreeing)).toBe(true);
  });

  it('⚠️ a row whose AMOUNT disagrees is held back for a per-row decision', () => {
    // Accepting it in bulk would either change an amount inside a button that promises it cannot,
    // or link the pair and leave the typed guess standing. Both are wrong; the row waits.
    expect(isBulkAcceptable(true, differing)).toBe(false);
  });

  it('⚠️ a DATE-only disagreement is held back too', () => {
    // A settled date moves money between months in the forecast, so it is not cosmetic.
    expect(isBulkAcceptable(true, laterDate)).toBe(false);
  });

  it('no suggestion is never acceptable', () => {
    expect(isBulkAcceptable(false, undefined)).toBe(false);
    expect(isBulkAcceptable(false, differing)).toBe(false);
  });
});
