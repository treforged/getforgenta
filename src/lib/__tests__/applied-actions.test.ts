import { describe, it, expect } from 'vitest';
import {
  parseUndoSteps, isReversible, offerableUndos, describeApplied,
  UNDO_OFFER_WINDOW_HOURS, type AppliedActionRow,
} from '../applied-actions';

/**
 * The durable-undo boundary. `steps` is `jsonb` written by a client and read back as `unknown`,
 * so most of what matters here is what happens to input that is NOT the happy shape.
 *
 * The rule these pin: a malformed row produces FEWER steps. Never a throw, and never a step with a
 * missing field that becomes `undefined` inside a mutation — which is how "restore the previous
 * category" quietly turns into "clear the category".
 */

const row = (over: Partial<AppliedActionRow> = {}): AppliedActionRow => ({
  id: 'a1', kind: 'merchant_retro_pass', label: 'Categorized 28 charges',
  steps: [{ write: 'setCategory', chargeId: 'c1', category: 'Groceries' }],
  created_at: new Date().toISOString(), undone_at: null, ...over,
});

describe('parseUndoSteps', () => {
  it('reads the three step shapes', () => {
    expect(parseUndoSteps([
      { write: 'setCategory', chargeId: 'c1', category: 'Gas' },
      { write: 'setCategory', chargeId: 'c2', category: null },
      { write: 'removeReviews', chargeId: 'c3' },
      { write: 'deleteTransaction', chargeId: 'c4', transactionId: 't4' },
    ])).toHaveLength(4);
  });

  it('KEEPS a null category — it means CLEAR, and dropping it would strand a label', () => {
    const [step] = parseUndoSteps([{ write: 'setCategory', chargeId: 'c1', category: null }]);
    expect(step).toEqual({ write: 'setCategory', chargeId: 'c1', category: null });
  });

  it('DROPS a setCategory with no category field at all', () => {
    // `undefined` is not `null`. A missing field must not become "clear this category" — that is a
    // silent data change dressed as a restore.
    expect(parseUndoSteps([{ write: 'setCategory', chargeId: 'c1' }])).toEqual([]);
  });

  it('drops a deleteTransaction with no transaction to delete', () => {
    expect(parseUndoSteps([{ write: 'deleteTransaction', chargeId: 'c1' }])).toEqual([]);
  });

  it('drops steps with no charge id, an unknown write, or the wrong types', () => {
    expect(parseUndoSteps([
      { write: 'removeReviews' },
      { write: 'removeReviews', chargeId: '' },
      { write: 'removeReviews', chargeId: 42 },
      { write: 'dropDatabase', chargeId: 'c1' },
      null, 'nonsense', 7,
    ])).toEqual([]);
  });

  it('never throws on input that is not an array', () => {
    for (const bad of [null, undefined, 42, 'steps', {}, true]) {
      expect(() => parseUndoSteps(bad)).not.toThrow();
      expect(parseUndoSteps(bad)).toEqual([]);
    }
  });

  it('PRESERVES ORDER — the ledger delete must stay ahead of the review removal', () => {
    // planDeckUndo orders these deliberately: reversed, a half-failure leaves spending counted
    // twice AND the charge importable again. Sorting here would silently undo that decision.
    //
    // ⚠️ THE FIXTURE ORDER IS DELIBERATELY NOT ALPHABETICAL. The first version of this test used
    // deleteTransaction/removeReviews/setCategory, which IS alphabetical — so a mutation that
    // sorted the steps produced the identical array and the test stayed GREEN. It could not fail,
    // and it was caught only by mutating the code on purpose. A round trip through a sort must
    // visibly change this.
    const steps = parseUndoSteps([
      { write: 'setCategory', chargeId: 'c1', category: 'Gas' },
      { write: 'deleteTransaction', chargeId: 'c1', transactionId: 't1' },
      { write: 'removeReviews', chargeId: 'c1' },
    ]);
    expect(steps.map(s => s.write)).toEqual(['setCategory', 'deleteTransaction', 'removeReviews']);
  });
});

describe('isReversible', () => {
  it('is true for a fresh action with real steps', () => {
    expect(isReversible(row())).toBe(true);
  });

  it('is false once it has been undone', () => {
    expect(isReversible(row({ undone_at: new Date().toISOString() }))).toBe(false);
  });

  it('is false when nothing in the row survives parsing — never offer an undo that does nothing', () => {
    expect(isReversible(row({ steps: [{ write: 'nonsense' }] }))).toBe(false);
    expect(isReversible(row({ steps: null }))).toBe(false);
  });
});

describe('offerableUndos', () => {
  const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600_000).toISOString();

  it('offers recent, reversible actions newest first', () => {
    const list = offerableUndos([
      row({ id: 'old', created_at: at(3) }),
      row({ id: 'new', created_at: at(1) }),
    ]);
    expect(list.map(r => r.id)).toEqual(['new', 'old']);
  });

  it('stops offering past the window, without deleting anything', () => {
    const stale = row({ id: 'stale', created_at: at(UNDO_OFFER_WINDOW_HOURS + 1) });
    expect(offerableUndos([stale])).toEqual([]);
    // The row itself is untouched — expiry governs the OFFER, not the record.
    expect(isReversible(stale)).toBe(true);
  });

  it('still offers a row whose timestamp will not parse', () => {
    // Withdrawing a promised undo because a date failed to parse is the app breaking its word for
    // a reason that has nothing to do with the user.
    expect(offerableUndos([row({ created_at: 'not a date' })])).toHaveLength(1);
  });

  it('never offers one already undone', () => {
    expect(offerableUndos([row({ undone_at: at(0) })])).toEqual([]);
  });
});

describe('describeApplied', () => {
  it('uses the stored label', () => {
    expect(describeApplied(row())).toBe('Categorized 28 charges');
  });

  it('falls back to an honest count rather than inventing a description', () => {
    expect(describeApplied(row({ label: '   ' }))).toBe('1 change');
    expect(describeApplied(row({
      label: '',
      steps: [
        { write: 'removeReviews', chargeId: 'c1' },
        { write: 'removeReviews', chargeId: 'c2' },
      ],
    }))).toBe('2 changes');
  });
});
