// @vitest-environment jsdom
//
// WHEN the deck records its durable undo, which turns out to matter more than whether it does.
//
// The record used to be written in an effect gated on `complete`, so it existed only for a run
// somebody finished. Close the deck on card three and the writes that had already landed became
// irreversible the moment the component unmounted — the in-session "Undo all" lives on the end
// screen and goes with it. A green suite covered the recording the whole time, because every test
// that exercised it drove the deck to the end first.
//
// ⚠️ THAT GAP IS ALSO THE BLOCKER ON AUTO-APPLY. An auto-applied decision is a write the user is
// not watching; under the old gate, closing the deck made it permanent. Removing a prompt while
// removing the reversibility its own copy promises is the trade this ordering refuses.
//
// ⚠️ SO EVERY TEST HERE ASSERTS THE RECORD EXISTS BEFORE THE RUN IS FINISHED. Asserting it after
// completion — the obvious shape — passes against the defect, which is exactly how it survived.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import DecisionDeck, { type BankDeckCard } from '../DecisionDeck';

vi.mock('@/hooks/useMerchantMemory', () => ({
  useMerchantMemory: () => ({
    rules: {}, linkRules: {}, pass: { writes: [], byMerchant: [] }, reviewsByCharge: {},
    suppressed: {}, setSuppressed: () => {}, isLoading: false,
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

beforeEach(() => {
  window.matchMedia = window.matchMedia || ((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const rentRule = {
  id: 'rule-1', user_id: 'u1', name: 'Rent', amount: 1800, frequency: 'monthly',
  rule_type: 'expense', due_day: 20, due_month: null, start_date: null, active: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const chargeRow = (id: string, merchant: string, amount: number, date: string) => ({
  id, user_id: 'u1', account_id: 'acct-1', amount, date, pending: false,
  name: merchant, merchant_name: merchant, category: null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

/** THREE cards, so a decision can be made with the run demonstrably unfinished. */
const cards = (): BankDeckCard[] => [
  { charge: chargeRow('c1', 'RENT CO', 1800, '2026-08-19'), suggestion: { rule: rentRule } },
  { charge: chargeRow('c2', 'PUBLIX', 42.5, '2026-08-18'), suggestion: null },
  { charge: chargeRow('c3', 'SHELL', 52.3, '2026-08-17'), suggestion: null },
];

function setup(over: Partial<React.ComponentProps<typeof DecisionDeck>> = {}) {
  let n = 0;
  const recordApplied = vi.fn().mockImplementation(() => Promise.resolve({ id: `act-${++n}` }));
  const markUndone = vi.fn().mockResolvedValue(undefined);
  render(
    <DecisionDeck
      cards={cards()}
      accountName={{ 'acct-1': 'Prime Visa' }}
      reviewsByCharge={{}}
      rules={[rentRule]}
      paymentPlans={[]}
      carFunds={[]}
      ledger={[]}
      buildItems={[]}
      importToLedger={{ mutateAsync: vi.fn().mockResolvedValue({ id: 'ledger-1' }) }}
      undoImport={{ mutateAsync: vi.fn().mockResolvedValue(undefined) }}
      transferLegIds={new Set()}
      save={{ mutateAsync: vi.fn().mockResolvedValue(undefined) }}
      setCategory={{ mutateAsync: vi.fn().mockResolvedValue(undefined) }}
      remove={{ mutateAsync: vi.fn().mockResolvedValue(undefined) }}
      recordApplied={recordApplied}
      markUndone={markUndone}
      onClose={vi.fn()}
      {...over}
    />,
  );
  return { recordApplied, markUndone };
}

describe('DecisionDeck — the durable record is written at the decision, not at the end', () => {
  it('records the FIRST decision while two cards are still unanswered', async () => {
    const { recordApplied } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Yes — Rent/ }));

    await waitFor(() => expect(recordApplied).toHaveBeenCalledTimes(1));
    // The run is demonstrably unfinished — this is the state in which the old code recorded
    // nothing at all, so closing the deck here lost the write for good.
    expect(screen.getByText('2 of 3')).toBeTruthy();

    const input = recordApplied.mock.calls[0][0];
    expect(input.kind).toBe('deck_decision');
    expect(input.steps).toEqual([{ chargeId: 'c1', write: 'removeReviews' }]);
  });

  it('names the charge, so the banner says which decision it is offering back', async () => {
    const { recordApplied } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Yes — Rent/ }));
    await waitFor(() => expect(recordApplied).toHaveBeenCalledTimes(1));
    // "1 charge decided" on a run of one is true and useless — it does not say WHICH.
    expect(recordApplied.mock.calls[0][0].label).toContain('RENT CO');
  });

  it('records one row PER decision, each carrying only its own charge', async () => {
    const { recordApplied } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Yes — Rent/ }));
    await waitFor(() => expect(recordApplied).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /Ignore/ }));
    await waitFor(() => expect(recordApplied).toHaveBeenCalledTimes(2));

    expect(recordApplied.mock.calls[0][0].steps).toEqual([{ chargeId: 'c1', write: 'removeReviews' }]);
    expect(recordApplied.mock.calls[1][0].steps).toEqual([{ chargeId: 'c2', write: 'removeReviews' }]);
  });

  it('does NOT record the same decision twice across re-renders', async () => {
    // Two rows for one write would let the second undo reverse work the first already reversed.
    const { recordApplied } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Yes — Rent/ }));
    await waitFor(() => expect(recordApplied).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /Skip/ }));
    fireEvent.click(screen.getByRole('button', { name: /Skip/ }));
    await waitFor(() => expect(screen.getByText(/decided/i)).toBeTruthy());
    expect(recordApplied).toHaveBeenCalledTimes(1);
  });

  it('works with no markUndone supplied — the prop is optional, like recordApplied', async () => {
    const { recordApplied } = setup({ markUndone: undefined });
    fireEvent.click(screen.getByRole('button', { name: /Yes — Rent/ }));
    await waitFor(() => expect(recordApplied).toHaveBeenCalledTimes(1));
  });
});

describe('DecisionDeck — an in-session undo retires the row that described it', () => {
  it('marks the row undone when the last decision is taken back', async () => {
    // Otherwise the stored row survives the reversal and goes on offering to undo writes that are
    // already undone, and the user cannot tell until they press it.
    const { recordApplied, markUndone } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Yes — Rent/ }));
    await waitFor(() => expect(recordApplied).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /Undo/i }));
    await waitFor(() => expect(markUndone).toHaveBeenCalledWith('act-1'));
  });

  it('records the charge AGAIN if it is decided a second time after an undo', async () => {
    // The claim is keyed by charge id; failing to release it would leave the re-decision with no
    // durable undo at all — a silent downgrade in exactly the flow a user is already unsure about.
    const { recordApplied, markUndone } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Yes — Rent/ }));
    await waitFor(() => expect(recordApplied).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /Undo/i }));
    await waitFor(() => expect(markUndone).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Yes — Rent/ }));
    await waitFor(() => expect(recordApplied).toHaveBeenCalledTimes(2));
    expect(recordApplied.mock.calls[1][0].steps).toEqual([{ chargeId: 'c1', write: 'removeReviews' }]);
  });
});
