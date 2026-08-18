// @vitest-environment jsdom
//
// What these pin is not the animation and not the layout. It is the ONE architectural rule the deck
// exists under: it is a VIEW over the review queue, so every write it performs must be the row the
// Bank Activity list already writes, made through the mutation the list already calls.
//
// The accept assertions therefore compare against `acceptRuleInput(...)` itself rather than an
// object literal. A deck that started building its own `save` payload — the easy, wrong thing —
// fails here even if the payload happens to look right today.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import DecisionDeck, { type BankDeckCard } from '../DecisionDeck';
import { acceptRuleInput, ignoreInput, acceptLedgerTxnInput } from '@/lib/review-write-inputs';

vi.mock('@/hooks/useMerchantMemory', () => ({
  useMerchantMemory: () => ({
    rules: {}, linkRules: {}, pass: { writes: [], byMerchant: [] }, reviewsByCharge: {},
    suppressed: {}, setSuppressed: () => {}, isLoading: false,
  }),
}));

// jsdom has no `matchMedia`, which framer-motion's reduced-motion hook asks for.
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

/** Card 1 carries a suggestion, card 2 does not — the queue's own order, handed straight in. */
const cards = (): BankDeckCard[] => [
  { charge: chargeRow('c1', 'RENT CO', 1800, '2026-08-19'), suggestion: { rule: rentRule } },
  { charge: chargeRow('c2', 'PUBLIX', 42.5, '2026-08-18'), suggestion: null },
];

function setup(overrides: Partial<React.ComponentProps<typeof DecisionDeck>> = {}) {
  const save = { mutateAsync: vi.fn().mockResolvedValue(undefined) };
  const setCategory = { mutateAsync: vi.fn().mockResolvedValue(undefined) };
  const remove = { mutateAsync: vi.fn().mockResolvedValue(undefined) };
  const onClose = vi.fn();
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
      save={save}
      setCategory={setCategory}
      remove={remove}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { save, setCategory, remove, onClose };
}

describe('DecisionDeck — one charge per card, in the queue\'s order', () => {
  it('opens on the queue\'s first card, with its amount, date and account', () => {
    setup();
    expect(screen.getByText('RENT CO')).toBeTruthy();
    // Same `formatCurrency(amount, false)` the list rows use — whole dollars, sign in front.
    expect(screen.getByTestId('decision-deck-amount').textContent).toBe('-$1,800');
    expect(screen.getByText('2026-08-19')).toBeTruthy();
    expect(screen.getByText('Prime Visa')).toBeTruthy();
    // The card that carries a suggestion leads, because the queue put it first.
    expect(screen.getByText('Is this your Rent?')).toBeTruthy();
    expect(screen.queryByText('PUBLIX')).toBeNull();
  });

  it('reads "1 of 2" and moves to "2 of 2" on skip', () => {
    setup();
    expect(screen.getByText('1 of 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Skip/ }));
    expect(screen.getByText('2 of 2')).toBeTruthy();
    expect(screen.getByText('PUBLIX')).toBeTruthy();
  });

  it('asks an OPEN question on a charge the app has no answer for', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Skip/ }));
    expect(screen.getByText('What is this?')).toBeTruthy();
    // No gold primary action, because there is nothing to accept.
    expect(screen.queryByRole('button', { name: /^Yes — / })).toBeNull();
  });
});

describe('every write goes through the handler the list already calls', () => {
  it('accepts a suggestion with EXACTLY the row `acceptRuleInput` builds', async () => {
    const { save, setCategory, remove } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Yes — Rent/ }));
    await waitFor(() => expect(save.mutateAsync).toHaveBeenCalledTimes(1));
    expect(save.mutateAsync).toHaveBeenCalledWith(
      acceptRuleInput(chargeRow('c1', 'RENT CO', 1800, '2026-08-19'), rentRule),
    );
    // The deck writes through ONE path per decision and never doubles up.
    expect(setCategory.mutateAsync).not.toHaveBeenCalled();
    expect(remove.mutateAsync).not.toHaveBeenCalled();
  });

  it('sets a category through `setCategory`, never through `save`', async () => {
    const { save, setCategory } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Groceries/ }));
    await waitFor(() => expect(setCategory.mutateAsync).toHaveBeenCalledWith({
      syncedTransactionId: 'c1', category: 'Groceries',
    }));
    expect(save.mutateAsync).not.toHaveBeenCalled();
  });

  it('ignores with EXACTLY the row `ignoreInput` builds', async () => {
    const { save } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Ignore/ }));
    await waitFor(() => expect(save.mutateAsync).toHaveBeenCalledWith(
      ignoreInput(chargeRow('c1', 'RENT CO', 1800, '2026-08-19')),
    ));
  });

  it('writes NOTHING on skip — a non-answer is not a decision', () => {
    const { save, setCategory, remove } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Skip/ }));
    expect(save.mutateAsync).not.toHaveBeenCalled();
    expect(setCategory.mutateAsync).not.toHaveBeenCalled();
    expect(remove.mutateAsync).not.toHaveBeenCalled();
  });
});

describe('keyboard', () => {
  it('→ accepts the suggestion', async () => {
    const { save } = setup();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => expect(save.mutateAsync).toHaveBeenCalledWith(
      acceptRuleInput(chargeRow('c1', 'RENT CO', 1800, '2026-08-19'), rentRule),
    ));
  });

  it('← skips without writing', () => {
    const { save } = setup();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText('2 of 2')).toBeTruthy();
    expect(save.mutateAsync).not.toHaveBeenCalled();
  });

  it('1-9 pick the chip at that position', async () => {
    const { setCategory } = setup();
    const chips = screen.getAllByRole('button').map(b => b.textContent ?? '');
    // The digit shown on the chip is the digit that picks it.
    expect(chips.some(t => t.startsWith('1Bills'))).toBe(true);
    fireEvent.keyDown(window, { key: '1' });
    await waitFor(() => expect(setCategory.mutateAsync).toHaveBeenCalledWith({
      syncedTransactionId: 'c1', category: 'Bills',
    }));
  });

  it('→ does NOTHING when there is no suggestion, rather than falling back to another decision', () => {
    const { save, setCategory } = setup();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText('PUBLIX')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(save.mutateAsync).not.toHaveBeenCalled();
    expect(setCategory.mutateAsync).not.toHaveBeenCalled();
  });

  it('Esc hands the user back to the list', () => {
    const { onClose } = setup();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('a failed write is never silent', () => {
  it('keeps the card, says nothing was recorded, and does not advance', async () => {
    const save = { mutateAsync: vi.fn().mockRejectedValue(new Error('Network is down.')) };
    setup({ save });
    fireEvent.click(screen.getByRole('button', { name: /Yes — Rent/ }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Not recorded');
    expect(screen.getByRole('alert').textContent).toContain('Network is down.');
    // Still on the same charge, still reading "1 of 2".
    expect(screen.getByText('RENT CO')).toBeTruthy();
    expect(screen.getByText('1 of 2')).toBeTruthy();
  });
});

describe('the end screen', () => {
  it('summarises the run and undoes every write it made, newest first', async () => {
    const { save, setCategory, remove } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Yes — Rent/ }));
    await waitFor(() => expect(save.mutateAsync).toHaveBeenCalled());
    // The second card must actually be on screen before its Ignore is pressed.
    expect(await screen.findByText('PUBLIX')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Ignore/ }));

    expect(await screen.findByText('2 charges decided')).toBeTruthy();
    expect(screen.getByText('1 linked to what the app already matched')).toBeTruthy();
    expect(screen.getByText('1 ignored')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Undo all/ }));
    await waitFor(() => expect(remove.mutateAsync).toHaveBeenCalledTimes(2));
    // Newest first: the ignore on c2 is reversed before the accept on c1.
    expect(remove.mutateAsync.mock.calls.map(c => c[0])).toEqual(['c2', 'c1']);
    // Neither charge carried a category beforehand, so nothing is put back.
    expect(setCategory.mutateAsync).not.toHaveBeenCalled();
  });

  it('restores a category the undo\'s delete would otherwise have destroyed', async () => {
    const { remove, setCategory } = setup({
      reviewsByCharge: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        c1: [{ id: 'rev-1', status: 'categorized', category_override: 'Rent' } as any],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /Yes — Rent/ }));
    // Waits for the accept to land before skipping — otherwise the skip races the write and lands
    // on the card that is still on screen.
    expect(await screen.findByText('PUBLIX')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Skip/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Undo all/ }));

    await waitFor(() => expect(setCategory.mutateAsync).toHaveBeenCalledWith({
      syncedTransactionId: 'c1', category: 'Rent',
    }));
    expect(remove.mutateAsync).toHaveBeenCalledWith('c1');
  });

  it('says a run that decided nothing decided nothing, and offers no undo', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Skip/ }));
    fireEvent.click(screen.getByRole('button', { name: /Skip/ }));
    expect(screen.getByText('Nothing was decided this time')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Undo all/ })).toBeNull();
  });

  it('draws NO progress bar for an empty deck — never a confident zero', () => {
    setup({ cards: [] });
    expect(screen.queryByTestId('decision-deck-progress')).toBeNull();
    expect(screen.getByText('Nothing was decided this time')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE MANUAL PICKERS — Tre, 2026-08-18: "why cant i choose to connect to an existing transaction?"
//
// Before this the deck could only CONFIRM a link the app had already worked out, so a charge with
// no suggestion had nowhere to go but a category. These pin the same rule as the accept tests: the
// row a picker writes must be the row `review-write-inputs.ts` builds, not one assembled here.
describe('DecisionDeck — linking by hand', () => {
  const entry = { id: 'txn-9', date: '2026-08-18', category: 'Groceries', amount: 42.5 };

  it('links to an entry the user already made, through the shared write builder', async () => {
    const { save } = setup({ ledger: [entry] });
    // Card 1 carries a suggestion; the picker matters on the card that does not, so skip to it.
    fireEvent.click(screen.getByRole('button', { name: /Skip/ }));
    const picker = await screen.findByLabelText('Link this charge to an entry you already made');
    fireEvent.change(picker, { target: { value: 'txn-9' } });
    await waitFor(() => expect(save.mutateAsync).toHaveBeenCalledTimes(1));
    expect(save.mutateAsync).toHaveBeenCalledWith(
      acceptLedgerTxnInput({ id: 'c2', date: '2026-08-18' }, 'txn-9', null),
    );
  });

  it('links to a bill through the same builder the list uses', async () => {
    const { save } = setup({ ledger: [entry] });
    fireEvent.click(screen.getByRole('button', { name: /Skip/ }));
    const picker = await screen.findByLabelText('Link this charge to a bill');
    fireEvent.change(picker, { target: { value: 'rule-1' } });
    await waitFor(() => expect(save.mutateAsync).toHaveBeenCalledTimes(1));
    expect(save.mutateAsync).toHaveBeenCalledWith(
      acceptRuleInput({ id: 'c2', date: '2026-08-18' }, rentRule),
    );
  });

  // An empty picker asserts a destination the user does not have. The list already follows this
  // rule for plans and vehicle charges; the deck must not invent a looser one.
  it('renders no picker for a kind with nothing to pick', () => {
    setup({ ledger: [] });
    fireEvent.click(screen.getByRole('button', { name: /Skip/ }));
    expect(screen.queryByLabelText('Link this charge to an entry you already made')).toBeNull();
    expect(screen.queryByLabelText('Link this charge to a payment plan')).toBeNull();
    expect(screen.queryByLabelText('Link this charge to a vehicle charge')).toBeNull();
  });

  // The one control that CREATES money is gated by `planLedgerImport` and belongs to the list. The
  // deck's premise is that every action on a card moves no projected number.
  it('never offers "Add to my ledger"', () => {
    setup({ ledger: [entry] });
    expect(screen.queryByText(/Add to my ledger/i)).toBeNull();
  });

  // A failed link must not slide the card forward — the same contract the accept path has.
  it('stays on the card and says so when the link fails to save', async () => {
    const save = { mutateAsync: vi.fn().mockRejectedValue(new Error('offline')) };
    setup({ ledger: [entry], save });
    fireEvent.click(screen.getByRole('button', { name: /Skip/ }));
    const picker = await screen.findByLabelText('Link this charge to an entry you already made');
    fireEvent.change(picker, { target: { value: 'txn-9' } });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Not recorded');
    expect(alert.textContent).toContain('still waiting on you');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE ONE ACTION ON A CARD THAT CREATES MONEY — Tre authorised it on 2026-08-18 ("yes for build
// part recording"). Everything else the deck does is an annotation; this inserts a ledger row that
// twelve surfaces then count, so what these pin is not that it works but that it cannot go wrong
// quietly: the gate is the shared one, the end screen counts it apart, and the undo takes the money
// back BEFORE it makes the charge importable again.
describe('DecisionDeck — recording a build part', () => {
  const part = { value: 'item-1', label: 'Steering Wheel · $220' };

  it('inserts the row `planLedgerImport` built, filed under Car and carrying the build item', async () => {
    const importToLedger = { mutateAsync: vi.fn().mockResolvedValue({ id: 'ledger-1' }) };
    setup({ buildItems: [part], importToLedger });
    // Card 1 carries a suggestion, so the app already describes it and the picker is withheld
    // there. Skip to the card the app has no answer for — exactly Tre's steering-wheel case.
    expect(screen.queryByLabelText('Record this charge as a car build part')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Skip/ }));
    const picker = await screen.findByLabelText('Record this charge as a car build part');
    fireEvent.change(picker, { target: { value: 'item-1' } });
    await waitFor(() => expect(importToLedger.mutateAsync).toHaveBeenCalledTimes(1));
    const arg = importToLedger.mutateAsync.mock.calls[0][0];
    expect(arg.syncedTransactionId).toBe('c2');
    expect(arg.draft.car_build_item_id).toBe('item-1');
    expect(arg.draft.category).toBe('Car');
    expect(arg.draft.origin).toBe('synced');
    expect(Math.abs(arg.draft.amount)).toBe(42.5);
  });

  // A charge the app already describes must not become a second copy of the same spending. The
  // refusal lives in `planLedgerImport`, and this proves the deck actually asks it.
  it('withholds the picker on a charge the app already has an answer for', () => {
    setup({ buildItems: [part] });
    expect(screen.queryByLabelText('Record this charge as a car build part')).toBeNull();
  });

  // Importing a leg books a movement between the user's own accounts as spending or as income, and
  // there is no third answer that would be right.
  it('withholds the picker on a transfer leg', () => {
    setup({ buildItems: [part], transferLegIds: new Set(['c1', 'c2']) });
    fireEvent.click(screen.getByRole('button', { name: /Skip/ }));
    expect(screen.queryByLabelText('Record this charge as a car build part')).toBeNull();
  });

  it('says on the end screen that money was involved, apart from the annotations', async () => {
    setup({ buildItems: [part] });
    fireEvent.click(screen.getByRole('button', { name: /Skip/ }));
    fireEvent.change(await screen.findByLabelText('Record this charge as a car build part'), {
      target: { value: 'item-1' },
    });
    expect(await screen.findByText(/1 added to your ledger as a build part/)).toBeTruthy();
  });

  // THE LOAD-BEARING ONE. Undone the other way round, the charge is unreviewed — importable again
  // — while its ledger entry survives: the same spending counted twice.
  it('undo deletes the ledger row BEFORE it makes the charge importable again', async () => {
    const order: string[] = [];
    const importToLedger = { mutateAsync: vi.fn().mockResolvedValue({ id: 'ledger-1' }) };
    const undoImport = { mutateAsync: vi.fn(async () => { order.push('deleteTransaction'); }) };
    const remove = { mutateAsync: vi.fn(async () => { order.push('removeReviews'); }) };
    setup({ buildItems: [part], importToLedger, undoImport, remove });
    fireEvent.click(screen.getByRole('button', { name: /Skip/ }));
    fireEvent.change(await screen.findByLabelText('Record this charge as a car build part'), {
      target: { value: 'item-1' },
    });
    const undo = await screen.findByRole('button', { name: /Undo/i });
    fireEvent.click(undo);
    await waitFor(() => expect(undoImport.mutateAsync).toHaveBeenCalledWith('ledger-1'));
    expect(order).toEqual(['deleteTransaction', 'removeReviews']);
  });
});
