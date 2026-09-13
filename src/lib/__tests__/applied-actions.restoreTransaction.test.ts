import { describe, it, expect } from 'vitest';
import { parseUndoSteps } from '../applied-actions';
import { reconciledPatch, reconciliationUndoStep, type ReconciliationProposal } from '../transaction-reconciliation';

/**
 * THE STEP THAT ENDED AN HONEST ABSENCE.
 *
 * "Link and correct" was the one per-row link left without a durable undo, deliberately: the three
 * original step kinds — setCategory, removeReviews, deleteTransaction — could not put a ledger
 * amount back, so recording a link-only reversal would have handed the user a button that removes
 * the link, leaves the corrected figure standing, and reports success. A partial undo presented as
 * a complete one, on a money page.
 *
 * ⚠️ SO THE CENTRAL ASSERTION IS A ROUND TRIP, NOT A FIELD CHECK. `reconciledPatch` and
 * `reconciliationUndoStep` are a pair; the test that matters is that applying the patch and then
 * the step lands back on the values the person actually typed. A per-field test would pass with the
 * pair silently disagreeing about a fourth column nobody remembered.
 */

const PROPOSAL: ReconciliationProposal = {
  planned: {
    id: 'txn-9', amount: 50, date: '2026-09-01', type: 'expense',
    payment_source: 'account:acc-1', origin: 'manual', note: 'Gas',
  },
  synced: { id: 'stx-9', amount: 52.3, date: '2026-09-02' } as ReconciliationProposal['synced'],
  confidence: 'high' as ReconciliationProposal['confidence'],
  typedAmount: 50,
  actualAmount: 52.3,
  typedDate: '2026-09-01',
  actualDate: '2026-09-02',
  amountDiffers: true,
  dateDiffers: true,
};

describe('reconciliationUndoStep — the exact reversal of the patch beside it', () => {
  it('ROUND TRIP: patch then undo lands back on what the person typed', () => {
    const patch = reconciledPatch(PROPOSAL);
    const step = reconciliationUndoStep(PROPOSAL, 'stx-9');

    // The patch really does change all three — otherwise this round trip proves nothing.
    expect(patch.amount).toBe(52.3);
    expect(patch.date).toBe('2026-09-02');
    expect(patch.origin).toBe('synced');

    // And the step puts every one of them back, on the same row.
    expect(step.transactionId).toBe(patch.id);
    expect(step.amount).toBe(50);
    expect(step.date).toBe('2026-09-01');
    expect(step.origin).toBe('manual');
  });

  it('EVERY FIELD THE PATCH WRITES IS RESTORED — no column left behind', () => {
    // The failure this guards is a correction that grows a fourth column while the undo restores
    // three and still reports success. Compare the KEY SETS rather than the values, so adding a
    // field to `reconciledPatch` without adding it here fails immediately.
    const patched = Object.keys(reconciledPatch(PROPOSAL)).filter(k => k !== 'id').sort();
    const restored = Object.keys(reconciliationUndoStep(PROPOSAL, 'stx-9'))
      .filter(k => k !== 'write' && k !== 'chargeId' && k !== 'transactionId')
      .sort();
    expect(restored).toEqual(patched);
  });

  it('reads the previous origin rather than assuming "manual"', () => {
    const odd = { ...PROPOSAL, planned: { ...PROPOSAL.planned, origin: 'imported' } };
    expect(reconciliationUndoStep(odd, 'stx-9').origin).toBe('imported');
  });
});

describe('parseUndoSteps — restoreTransaction is a money write, so it is parsed like one', () => {
  const good = {
    write: 'restoreTransaction', chargeId: 'stx-9', transactionId: 'txn-9',
    amount: 50, date: '2026-09-01', origin: 'manual',
  };

  it('accepts a complete step', () => {
    expect(parseUndoSteps([good])).toEqual([good]);
  });

  it('accepts a legitimate zero amount', () => {
    // 0 is a real amount and must not be rejected by a falsy check — that is the classic way a
    // validator quietly refuses valid data.
    expect(parseUndoSteps([{ ...good, amount: 0 }])).toHaveLength(1);
  });

  it.each(['transactionId', 'amount', 'date', 'origin'])(
    'DROPS the step entirely when %s is missing — all four or nothing',
    field => {
      const broken = { ...good } as Record<string, unknown>;
      delete broken[field];
      // Not "a step with undefined in it". A restore that sets an amount and leaves the date is
      // the partial undo this step exists to prevent, and it would report success.
      expect(parseUndoSteps([broken])).toEqual([]);
    },
  );

  it('DROPS a NaN amount, which survives a typeof check and would reach the ledger', () => {
    expect(parseUndoSteps([{ ...good, amount: Number.NaN }])).toEqual([]);
  });

  it('DROPS a numeric amount sent as a string', () => {
    expect(parseUndoSteps([{ ...good, amount: '50' }])).toEqual([]);
  });

  it('keeps a valid step beside a broken one rather than throwing the batch away', () => {
    const parsed = parseUndoSteps([{ ...good, date: 1 }, { write: 'removeReviews', chargeId: 'stx-9' }]);
    expect(parsed).toEqual([{ write: 'removeReviews', chargeId: 'stx-9' }]);
  });

  it('PRESERVES ORDER, so the link comes off in the order it was recorded', () => {
    const parsed = parseUndoSteps([good, { write: 'removeReviews', chargeId: 'stx-9' }]);
    expect(parsed.map(s => s.write)).toEqual(['restoreTransaction', 'removeReviews']);
  });
});
