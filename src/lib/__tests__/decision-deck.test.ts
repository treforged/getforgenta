// The Decision Deck's pure half. Nothing here renders, and nothing here decides what a charge IS —
// that is `buildReviewQueue`'s job and this file's tests exist largely to pin that the deck does not
// second-guess it.
import { describe, it, expect } from 'vitest';
import {
  buildDeck, initialDeckState, advanceDeck, recordDeckDecision, isDeckComplete, deckProgress,
  planDeckUndo, orderCategoryChips, taughtCategoryOrder, deckSummary, CHIP_LIMIT,
  chargeDirection, MONEY_IN_CATEGORIES, deckChipRow,
  type DeckDecision,
} from '../decision-deck';
import { buildReviewQueue, type ReviewQueue } from '../bank-activity-queue';
import type { MerchantRule } from '../merchant-memory';
import { CATEGORIES } from '../types';

const charge = (id: string, date: string, amount = 10) => ({ id, account_id: 'a1', amount, date });

/** A rule in the minimum shape `QueueRule` requires — none of it matters to the deck. */
const rule = (id: string, name: string) => ({
  id, name, amount: 100, frequency: 'monthly', rule_type: 'expense', due_day: 1,
});

/** A queue with the shape the deck consumes, built by hand so ordering can be asserted exactly. */
const queueOf = (
  ids: readonly string[],
  suggestions: Record<string, { rule?: ReturnType<typeof rule> }> = {},
): ReviewQueue<ReturnType<typeof charge>, ReturnType<typeof rule>, never, never> => ({
  needsDecision: ids.map((id, i) => charge(id, `2026-08-${String(20 - i).padStart(2, '0')}`)),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  suggestions: suggestions as any,
  suggestedCount: Object.keys(suggestions).length,
});

describe('buildDeck — a VIEW over the queue, never a second sort', () => {
  it('keeps the queue order exactly, card for card', () => {
    const queue = queueOf(['c1', 'c2', 'c3', 'c4']);
    expect(buildDeck(queue).map(card => card.charge.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
  });

  it('does not filter — every charge the queue says needs a decision gets a card', () => {
    const queue = queueOf(['c1', 'c2', 'c3'], { c2: { rule: rule('r1', 'Rent') } });
    expect(buildDeck(queue)).toHaveLength(3);
  });

  it('attaches the queue\'s own suggestion, and null where there is none', () => {
    const queue = queueOf(['c1', 'c2'], { c2: { rule: rule('r1', 'Rent') } });
    const deck = buildDeck(queue);
    expect(deck[0].suggestion).toBeNull();
    expect(deck[1].suggestion?.rule?.name).toBe('Rent');
  });

  it('leads with the suggestion-carrying charges because THE QUEUE does, not because the deck re-sorts', () => {
    // Fed through the real `buildReviewQueue`, so this fails if the deck ever starts ordering itself:
    // the suggested charge here is the OLDEST, which any date-only sort would put last.
    const charges = [
      { id: 'new', account_id: 'a1', amount: 42, date: '2026-08-19' },
      { id: 'mid', account_id: 'a1', amount: 43, date: '2026-08-18' },
      { id: 'old', account_id: 'a1', amount: 99, date: '2026-08-01' },
    ];
    const queue = buildReviewQueue({
      charges,
      reviewsByCharge: {},
      rules: [],
      ledger: [{ id: 'l1', date: '2026-08-01', type: 'expense', amount: 99, payment_source: 'account:a1' }],
    });
    expect(queue.needsDecision.map(c => c.id)).toEqual(['old', 'new', 'mid']);
    expect(buildDeck(queue).map(card => card.charge.id)).toEqual(queue.needsDecision.map(c => c.id));
  });

  it('is empty for an empty queue — no card, and therefore no deck to render', () => {
    expect(buildDeck(queueOf([]))).toEqual([]);
  });
});

describe('deck sequencing', () => {
  const deck = buildDeck(queueOf(['c1', 'c2', 'c3']));

  it('starts on the first card with nothing decided', () => {
    const state = initialDeckState(deck);
    expect(state.index).toBe(0);
    expect(state.total).toBe(3);
    expect(state.decisions).toEqual([]);
    expect(isDeckComplete(state)).toBe(false);
  });

  it('skips forward without recording anything', () => {
    const state = advanceDeck(initialDeckState(deck));
    expect(state.index).toBe(1);
    expect(state.decisions).toEqual([]);
  });

  it('records a decision AND advances, in one new object', () => {
    const before = initialDeckState(deck);
    const decision: DeckDecision = {
      chargeId: 'c1', kind: 'accepted', merchantLabel: 'Publix', detail: 'Rent', previousCategory: null,
    };
    const after = recordDeckDecision(before, decision);
    expect(after.index).toBe(1);
    expect(after.decisions).toEqual([decision]);
    // Immutability — the caller's state is untouched.
    expect(before.index).toBe(0);
    expect(before.decisions).toEqual([]);
  });

  it('completes once past the last card and never runs off the end', () => {
    let state = initialDeckState(deck);
    for (let i = 0; i < 5; i++) state = advanceDeck(state);
    expect(state.index).toBe(3);
    expect(isDeckComplete(state)).toBe(true);
  });
});

describe('deckProgress — "N of M" and the bar', () => {
  const deck = buildDeck(queueOf(['c1', 'c2', 'c3', 'c4']));

  it('reads 1 of 4 at the start, with an empty bar', () => {
    expect(deckProgress(initialDeckState(deck))).toEqual({ position: 1, total: 4, percent: 0 });
  });

  it('reads 3 of 4 after two cards', () => {
    const state = advanceDeck(advanceDeck(initialDeckState(deck)));
    expect(deckProgress(state)).toEqual({ position: 3, total: 4, percent: 50 });
  });

  it('pins the position to the last card at the end rather than reading "5 of 4"', () => {
    let state = initialDeckState(deck);
    for (let i = 0; i < 4; i++) state = advanceDeck(state);
    expect(deckProgress(state)).toEqual({ position: 4, total: 4, percent: 100 });
  });

  it('returns NULL for an empty deck — never a confident zero', () => {
    expect(deckProgress(initialDeckState([]))).toBeNull();
  });
});

describe('planDeckUndo — reverses exactly what the run wrote, newest first', () => {
  const decisions: DeckDecision[] = [
    { chargeId: 'c1', kind: 'accepted', merchantLabel: 'Rent Co', detail: 'Rent', previousCategory: null },
    { chargeId: 'c2', kind: 'categorized', merchantLabel: 'Publix', detail: 'Groceries', previousCategory: null },
    { chargeId: 'c3', kind: 'ignored', merchantLabel: 'CFX', detail: 'ignored', previousCategory: 'Gas' },
  ];

  it('unwinds newest first, like the merchant-memory pass', () => {
    const steps = planDeckUndo(decisions);
    expect(steps.map(s => s.chargeId)).toEqual(['c3', 'c3', 'c2', 'c1']);
  });

  it('deletes the review a link or an ignore wrote, then restores the category it removed', () => {
    const steps = planDeckUndo(decisions);
    expect(steps[0]).toEqual({ chargeId: 'c3', write: 'removeReviews' });
    // `removeReviews` clears the whole charge, so a category that was there BEFORE the run has to go
    // back — otherwise "undo" would quietly destroy a label the deck never touched.
    expect(steps[1]).toEqual({ chargeId: 'c3', write: 'setCategory', category: 'Gas' });
  });

  it('restores a chip pick by writing the previous category back, clearing it when there was none', () => {
    expect(planDeckUndo(decisions)[2]).toEqual({ chargeId: 'c2', write: 'setCategory', category: null });
  });

  it('emits no second step when there was no category to put back', () => {
    expect(planDeckUndo(decisions)[3]).toEqual({ chargeId: 'c1', write: 'removeReviews' });
    expect(planDeckUndo(decisions)).toHaveLength(4);
  });

  it('has nothing to do for a run that decided nothing', () => {
    expect(planDeckUndo([])).toEqual([]);
  });
});

describe('deckSummary — what the run actually did', () => {
  it('counts each kind, and says nothing about the kinds that did not happen', () => {
    const summary = deckSummary([
      { chargeId: 'c1', kind: 'accepted', merchantLabel: 'A', detail: 'Rent', previousCategory: null },
      { chargeId: 'c2', kind: 'accepted', merchantLabel: 'B', detail: 'Fuel', previousCategory: null },
      { chargeId: 'c3', kind: 'ignored', merchantLabel: 'C', detail: 'ignored', previousCategory: null },
    ]);
    expect(summary).toEqual({ accepted: 2, categorized: 0, ignored: 1, total: 3 });
  });
});

describe('category chips — the user\'s own answers first', () => {
  const rule = (key: string, category: string, decidedCount: number): MerchantRule => ({
    key, label: key, category: category as MerchantRule['category'], decidedAt: null, decidedCount, conflictingCount: 0,
  });

  it('puts this merchant\'s own remembered category first', () => {
    const order = taughtCategoryOrder(
      { PUBLIX: rule('PUBLIX', 'Groceries', 1), AMAZON: rule('AMAZON', 'Shopping', 40) },
      rule('PUBLIX', 'Groceries', 1),
    );
    expect(order[0]).toBe('Groceries');
    expect(order).toContain('Shopping');
  });

  it('orders the rest by how often the user has used them', () => {
    const order = taughtCategoryOrder({
      A: rule('A', 'Shopping', 40),
      B: rule('B', 'Dining', 5),
      C: rule('C', 'Gas', 12),
    }, null);
    expect(order).toEqual(['Shopping', 'Gas', 'Dining']);
  });

  it('drops a category the user never taught rather than inventing one', () => {
    expect(taughtCategoryOrder({}, null)).toEqual([]);
  });

  it('leads with the taught categories, then fills from the common list, no duplicates', () => {
    const chips = orderCategoryChips(['Gas', 'Groceries'], ['Bills', 'Groceries', 'Rent'], 4);
    expect(chips).toEqual(['Gas', 'Groceries', 'Bills', 'Rent']);
  });

  it('caps at the limit, because the chips are numbered 1-9 for the keyboard', () => {
    const chips = orderCategoryChips([], ['Bills', 'Rent', 'Utilities'], 2);
    expect(chips).toEqual(['Bills', 'Rent']);
    expect(CHIP_LIMIT).toBeLessThanOrEqual(9);
  });

  it('refuses a category that is not one of the app\'s own', () => {
    expect(orderCategoryChips(['Not A Category'], ['Bills'], 5)).toEqual(['Bills']);
  });
});

// The bug: a MONEY IN card offered nine expense chips and no way to say "income".
//
// Tre hit it on card 1 of his own run on 2026-08-18 — an $815.75 payroll deposit. It was not that
// `Income` was buried; with `CATEGORIES` listing it 25th of 26 against a nine-chip cap, it could not
// appear at all. These tests run against the REAL `CATEGORIES` for that reason: a fixture list would
// pass while the shipped one still hid the chip.
describe('chargeDirection', () => {
  it('reads a deposit as money IN — outflow is positive on these rows', () => {
    expect(chargeDirection(-815.75)).toBe('in');
    expect(chargeDirection('-815.75')).toBe('in');
  });

  it('reads a purchase as money OUT', () => {
    expect(chargeDirection(42.5)).toBe('out');
    expect(chargeDirection('42.50')).toBe('out');
  });

  it('reports no direction rather than guessing one', () => {
    // A zero or unreadable amount is ABSENT, not an expense. Same rule as everywhere else here:
    // never draw a confident answer over a missing reading.
    expect(chargeDirection(0)).toBeNull();
    expect(chargeDirection(null)).toBeNull();
    expect(chargeDirection(undefined)).toBeNull();
    expect(chargeDirection('not a number')).toBeNull();
  });
});

describe('orderCategoryChips — direction', () => {
  it('puts Income on the paycheck card, where it could not previously appear at all', () => {
    expect(orderCategoryChips([], CATEGORIES, CHIP_LIMIT, 'in')[0]).toBe('Income');
    // The bite: the OLD call — no direction — cannot reach it, which is the whole defect.
    expect(orderCategoryChips([], CATEGORIES, CHIP_LIMIT)).not.toContain('Income');
  });

  it('leaves an expense card exactly as it was', () => {
    expect(orderCategoryChips(['Gas'], CATEGORIES, CHIP_LIMIT, 'out'))
      .toEqual(orderCategoryChips(['Gas'], CATEGORIES, CHIP_LIMIT));
  });

  it('reorders and never filters — every category is still offerable on a deposit', () => {
    // A deposit really can be a refund the user files under Shopping.
    const chips = orderCategoryChips([], CATEGORIES, CATEGORIES.length, 'in');
    expect([...chips].sort()).toEqual([...CATEGORIES].sort());
  });

  it('keeps what the user TAUGHT ahead of the direction', () => {
    // Their own previous answer about this merchant is the better evidence; demoting it would make
    // a correction look like it did not take.
    expect(orderCategoryChips(['Business'], CATEGORIES, CHIP_LIMIT, 'in')[0]).toBe('Business');
  });

  it('still caps at the limit with the inflow categories in front', () => {
    expect(orderCategoryChips([], CATEGORIES, 3, 'in')).toEqual(MONEY_IN_CATEGORIES.slice(0, 3));
  });
});

// The direction lead shipped and STILL did not reach the user it was written for.
//
// Observed live on 2026-08-18, signed in, with `fa766cfb` in the build: card 1 of Tre's own run —
// the $815.75 payroll deposit — offered `Other, Gas, Groceries, Travel, Bills, Business, Car,
// Dining, Entertainment` and no `Income`. The lead was correct and unreachable: it sits BEHIND the
// whole taught order, `taughtCategoryOrder` returns every category the user has ever taught sorted
// by frequency, and Tre had taught nine — exactly the nine-chip cap. Every test above passed
// because every one of them used a taught list of length 0 or 1.
//
// These tests therefore run against a NINE-category taught list and the REAL `CATEGORIES`: a
// smaller fixture passes while the shipped row still hides the chip.
describe('deckChipRow — the row a real user actually sees', () => {
  const merchant = (key: string, category: string, decidedCount: number): MerchantRule => ({
    key, label: key, category: category as MerchantRule['category'], decidedAt: null, decidedCount,
    conflictingCount: 0,
  });

  /** Tre's own taught set on 2026-08-18, in his own frequency order. */
  const TAUGHT: Readonly<Record<string, MerchantRule>> = {
    m1: merchant('m1', 'Other', 90), m2: merchant('m2', 'Gas', 80),
    m3: merchant('m3', 'Groceries', 70), m4: merchant('m4', 'Travel', 60),
    m5: merchant('m5', 'Bills', 50), m6: merchant('m6', 'Business', 40),
    m7: merchant('m7', 'Car', 30), m8: merchant('m8', 'Dining', 20),
    m9: merchant('m9', 'Entertainment', 10),
  };

  it('offers Income on a paycheck card even when the taught list already fills the cap', () => {
    const chips = deckChipRow(TAUGHT, null, -815.75);
    expect(chips).toContain('Income');
    expect(chips[0]).toBe('Income');
    // The bite: the row as it shipped — the lead behind the whole taught order — cannot reach it.
    expect(orderCategoryChips(taughtCategoryOrder(TAUGHT, null), CATEGORIES, CHIP_LIMIT, 'in'))
      .not.toContain('Income');
  });

  it('still pins what the user taught about THIS merchant, ahead of the direction', () => {
    // A correction has to look like it took. `Shopping` is a refund the user already filed here.
    const chips = deckChipRow(TAUGHT, merchant('REI', 'Shopping', 3), -42);
    expect(chips[0]).toBe('Shopping');
    expect(chips[1]).toBe('Income');
  });

  it('leaves an expense card exactly as it was', () => {
    expect(deckChipRow(TAUGHT, null, 42))
      .toEqual(orderCategoryChips(taughtCategoryOrder(TAUGHT, null), CATEGORIES, CHIP_LIMIT));
  });

  it('reorders and never filters — the taught order still follows the direction', () => {
    const chips = deckChipRow(TAUGHT, null, -815.75);
    expect(chips).toHaveLength(CHIP_LIMIT);
    // Income, Business, Savings, Investing, then the frequency order minus what was already used.
    expect(chips.slice(0, 4)).toEqual([...MONEY_IN_CATEGORIES]);
    expect(chips.slice(4)).toEqual(['Other', 'Gas', 'Groceries', 'Travel', 'Bills']);
  });

  it('reads an absent amount as no direction rather than as an expense', () => {
    expect(deckChipRow(TAUGHT, null, null))
      .toEqual(orderCategoryChips(taughtCategoryOrder(TAUGHT, null), CATEGORIES, CHIP_LIMIT));
  });
});
