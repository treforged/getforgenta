// @vitest-environment jsdom
//
// What `rules-from-history.test.ts` pins is what the history IMPLIES. What these pin is what the
// deck WRITES — the half no pure test can reach.
//
// The one architectural rule this deck exists under is the same one the charge deck has: it is a
// VIEW, not a second rule editor. Every accept must be `ruleInsertFromProposal` handed to the same
// `useRecurringRules().add` the Budget rule editor calls. The accept assertions therefore compare
// against the builder's own output rather than an object literal, so a deck that started assembling
// its own payload fails here even if the payload happens to look right today.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import RulesFromHistoryDeck from '../RulesFromHistoryDeck';
import { ruleInsertFromProposal } from '@/lib/rule-proposal-write';
import type { RuleProposal } from '@/lib/rules-from-history';

const mocks = vi.hoisted(() => ({
  add: { mutateAsync: vi.fn() },
  remove: { mutateAsync: vi.fn() },
  toast: { success: vi.fn(), message: vi.fn(), error: vi.fn() },
}));

vi.mock('@/hooks/useSupabaseData', () => ({
  useAccounts: () => ({ data: [{ id: 'acct-1', name: 'Prime Visa' }] }),
  useRecurringRules: () => ({ add: mocks.add, remove: mocks.remove }),
}));

vi.mock('sonner', () => ({ toast: mocks.toast }));

// jsdom has no `matchMedia`, which framer-motion's reduced-motion hook asks for.
beforeEach(() => {
  window.matchMedia = window.matchMedia || ((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);

  let landed = 0;
  mocks.add.mutateAsync.mockReset();
  // Ids as the database would hand them back: one per insert, in the order they land.
  mocks.add.mutateAsync.mockImplementation(async () => `rule-${++landed}`);
  mocks.remove.mutateAsync.mockReset();
  mocks.remove.mutateAsync.mockResolvedValue(undefined);
  mocks.toast.success.mockReset();
  mocks.toast.message.mockReset();
});

afterEach(() => { cleanup(); });

const proposal = (over: Partial<RuleProposal> & Pick<RuleProposal, 'id' | 'name'>): RuleProposal => ({
  merchantLabel: over.name.toUpperCase(),
  merchantKey: over.id,
  amount: 120,
  direction: 'expense',
  frequency: 'monthly',
  dueDay: 12,
  anchorDate: '2026-05-12',
  accountId: 'acct-1',
  months: ['2026-05', '2026-06', '2026-07'],
  occurrences: 3,
  category: 'Bills',
  ...over,
});

/** Three, because the interesting behaviour — add-all, one undo for the run — needs a run. */
const proposals = (): RuleProposal[] => [
  proposal({ id: 'p1', name: 'Duke Energy', amount: 184.5, dueDay: 12 }),
  proposal({ id: 'p2', name: 'Spectrum', amount: 89.99, dueDay: 19 }),
  proposal({ id: 'p3', name: 'Paycheck', amount: 2100, direction: 'income', frequency: 'biweekly', dueDay: 5 }),
];

function setup(deck: RuleProposal[] = proposals()) {
  const onClose = vi.fn();
  const view = render(<RulesFromHistoryDeck proposals={deck} onClose={onClose} />);
  return { onClose, deck, ...view };
}

const addAll = () => screen.getByRole('button', { name: /Add all/ });
const acceptCard = () => screen.getByRole('button', { name: /Add this rule/ });
const skipCard = () => screen.getByRole('button', { name: /Not a rule/ });

describe('every accepted proposal is written by `ruleInsertFromProposal`, never by this file', () => {
  it('accepts one with EXACTLY the row the builder produces for that proposal', async () => {
    const { deck } = setup();
    fireEvent.click(acceptCard());
    await waitFor(() => expect(mocks.add.mutateAsync).toHaveBeenCalledTimes(1));
    expect(mocks.add.mutateAsync).toHaveBeenCalledWith({
      // `quiet` suppresses the per-rule toast only; the run's own summary is the receipt.
      ...ruleInsertFromProposal(deck[0]), quiet: true,
    });
    expect(mocks.remove.mutateAsync).not.toHaveBeenCalled();
  });

  it('accepts ALL of them with exactly the builder\'s rows, in the deck\'s order', async () => {
    const { deck } = setup();
    fireEvent.click(addAll());
    await waitFor(() => expect(mocks.add.mutateAsync).toHaveBeenCalledTimes(3));
    expect(mocks.add.mutateAsync.mock.calls.map(call => call[0])).toEqual(
      deck.map(target => ({ ...ruleInsertFromProposal(target), quiet: true })),
    );
    // Income lands in `deposit_account` and expense in `payment_source` — the deck does not decide
    // that, the builder does, and this deep-equality is what keeps it that way.
    expect(mocks.add.mutateAsync.mock.calls[2][0].deposit_account).toBe('acct-1');
    expect(mocks.add.mutateAsync.mock.calls[2][0].payment_source).toBeNull();
  });
});

describe('a batch that half-fails says so', () => {
  it('records only what landed, and the end screen states the failure rather than claiming a clean run', async () => {
    mocks.add.mutateAsync
      .mockResolvedValueOnce('rule-1')
      .mockRejectedValueOnce(new Error('Network is down.'));

    setup();
    fireEvent.click(addAll());

    // The run is over, so the honest place for the failure is the end screen — the card that would
    // have carried it is gone.
    expect(await screen.findByTestId('rules-from-history-end')).toBeTruthy();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Added 1 of 3');
    expect(alert.textContent).toContain('Network is down.');
    expect(alert.textContent).toContain('The rest were not added.');

    // Stop-at-first-failure: the third was never attempted, and the headline counts only the one.
    expect(mocks.add.mutateAsync).toHaveBeenCalledTimes(2);
    expect(screen.getByText('1 rule added to your budget')).toBeTruthy();
    expect(screen.getByText('Duke Energy')).toBeTruthy();
    expect(screen.queryByText('Spectrum')).toBeNull();
  });
});

describe('one undo for the whole run', () => {
  it('deletes exactly the rules this run created, newest first, and never one that failed to insert', async () => {
    mocks.add.mutateAsync
      .mockResolvedValueOnce('rule-1')                          // Duke Energy — lands
      .mockRejectedValueOnce(new Error('Network is down.'))     // Spectrum — never exists
      .mockResolvedValueOnce('rule-3');                         // Paycheck — lands

    setup();
    fireEvent.click(acceptCard());
    expect(await screen.findByText('Spectrum')).toBeTruthy();

    // The failed card stays put and says so, so the user skips it themselves.
    fireEvent.click(acceptCard());
    expect((await screen.findByRole('alert')).textContent).toContain('Network is down.');
    expect(screen.getByText('Spectrum')).toBeTruthy();
    fireEvent.click(skipCard());

    expect(await screen.findByText('Paycheck')).toBeTruthy();
    fireEvent.click(acceptCard());

    expect(await screen.findByText('2 rules added to your budget')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Undo — remove them again/ }));

    await waitFor(() => expect(mocks.remove.mutateAsync).toHaveBeenCalledTimes(2));
    // Newest first, by the ids as they landed — never re-derived by name afterwards.
    expect(mocks.remove.mutateAsync.mock.calls.map(call => call[0])).toEqual(['rule-3', 'rule-1']);
    expect(await screen.findByText('Removed. Your budget is exactly as it was.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Undo — remove them again/ })).toBeNull();
  });
});

describe('the cards are snapshotted on open', () => {
  it('keeps the run it opened with when the live proposals shrink underneath it', async () => {
    const { rerender } = setup();
    expect(screen.getByText('1 of 3')).toBeTruthy();

    fireEvent.click(acceptCard());
    await waitFor(() => expect(mocks.add.mutateAsync).toHaveBeenCalledTimes(1));

    // Accepting made Duke Energy "covered", so the live list recomputes one shorter. A deck reading
    // it live would renumber to "2 of 2" and slide Paycheck past the user unseen.
    rerender(<RulesFromHistoryDeck proposals={[proposals()[1], proposals()[2]]} onClose={vi.fn()} />);

    expect(screen.getByText('2 of 3')).toBeTruthy();
    expect(screen.getByText('Spectrum')).toBeTruthy();
    fireEvent.click(skipCard());
    expect(screen.getByText('3 of 3')).toBeTruthy();
    expect(screen.getByText('Paycheck')).toBeTruthy();
  });
});

describe('nothing is written until the user says so', () => {
  it('writes NOTHING on skip — a proposal not taken is simply not taken', () => {
    setup();
    fireEvent.click(skipCard());
    expect(screen.getByText('Spectrum')).toBeTruthy();
    expect(mocks.add.mutateAsync).not.toHaveBeenCalled();
    expect(mocks.remove.mutateAsync).not.toHaveBeenCalled();
  });

  it('writes NOTHING when the whole screen is skipped, and hands the user back', () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Skip for now/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.add.mutateAsync).not.toHaveBeenCalled();
    expect(mocks.remove.mutateAsync).not.toHaveBeenCalled();
  });

  it('says a run that added nothing added nothing, and offers no undo', () => {
    setup();
    fireEvent.click(skipCard());
    fireEvent.click(skipCard());
    fireEvent.click(skipCard());
    expect(screen.getByText('No rules were added')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Undo/ })).toBeNull();
    expect(mocks.add.mutateAsync).not.toHaveBeenCalled();
  });
});
