// @vitest-environment jsdom
//
// THE PAYCHECK CARD. Tre, 2026-08-18: "the Decision Deck does not auto-connect a paycheck to income."
//
// Card 1 of his own run was `LOCKHEED MARTIN PAYROLL PPD ID: 4521893632`, +$815.75, MONEY IN. Two
// separate things were wrong with it, and this file pins both:
//
//   1. it offered nine EXPENSE chips and no `Income` — not buried, unreachable, because `CATEGORIES`
//      lists `Income` 25th of 26 against a nine-chip cap;
//   2. the same merchant already carried 22 `linked_rule` decisions to one income rule, and the deck
//      asked a 23rd time as though it had never been told.
//
// As everywhere else on this surface, the accept assertion compares against `acceptRuleInput` itself
// rather than a literal: a deck that built its own payload for the remembered path — a second write
// path for the same decision — fails here even if today's object happens to look right.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import DecisionDeck, { type BankDeckCard } from '../DecisionDeck';
import { acceptRuleInput } from '@/lib/review-write-inputs';
import { deriveMerchantLinks, type MerchantLinkReview } from '@/lib/merchant-link-memory';

const PAYROLL = 'LOCKHEED MARTIN PAYROLL PPD ID: 4521893632';
const PAYCHECK_ID = '3a30b089-a93c-4e44-b200-f45be007b6d0';

/** Tre's real income rule, in the shape `ruleOccurrence` reads. */
const paycheckRule = {
  id: PAYCHECK_ID, user_id: 'u1', name: 'Weekly Paycheck', amount: 848.89, frequency: 'weekly',
  rule_type: 'income', due_day: 5, due_month: null, start_date: '2026-03-18', active: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

/** The 22 links, derived through the real deriver rather than hand-built. */
function payrollLinkMemory(count = 22, ruleId = PAYCHECK_ID) {
  const charges = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: PAYROLL, merchant_name: null }));
  const reviews: Record<string, MerchantLinkReview[]> = {};
  for (const [i, c] of charges.entries()) {
    reviews[c.id] = [{ status: 'linked_rule', rule_id: ruleId, updated_at: `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00Z` }];
  }
  return deriveMerchantLinks(charges, reviews);
}

const linkRules = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

/**
 * The categories THIS USER has taught, and there have to be nine of them.
 *
 * ⚠️ AN EMPTY `rules: {}` IS WHY THIS FILE PASSED WHILE THE APP STILL HID THE CHIP. The taught
 * order leads the row and a user who has taught `CHIP_LIMIT` categories fills it on their own —
 * Tre had taught exactly nine, so the paycheck card he opened on 2026-08-18 showed `Other, Gas,
 * Groceries, …` and no `Income`, with this test green. A fixture of nobody's data proves nothing
 * about the person using the app.
 */
const taughtRules = vi.hoisted(() => {
  const of = (key: string, category: string, decidedCount: number) =>
    ({ key, label: key, category, decidedAt: null, decidedCount, conflictingCount: 0 });
  return {
    current: {
      m1: of('m1', 'Other', 90), m2: of('m2', 'Gas', 80), m3: of('m3', 'Groceries', 70),
      m4: of('m4', 'Travel', 60), m5: of('m5', 'Bills', 50), m6: of('m6', 'Business', 40),
      m7: of('m7', 'Car', 30), m8: of('m8', 'Dining', 20), m9: of('m9', 'Entertainment', 10),
    } as Record<string, unknown>,
  };
});

vi.mock('@/hooks/useMerchantMemory', () => ({
  useMerchantMemory: () => ({
    rules: taughtRules.current, linkRules: linkRules.current, pass: { writes: [], byMerchant: [] },
    reviewsByCharge: {}, suppressed: {}, setSuppressed: () => {}, isLoading: false,
  }),
}));

beforeEach(() => {
  linkRules.current = payrollLinkMemory();
  window.matchMedia = window.matchMedia || ((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

/** The 23rd paycheck: a DIFFERENT amount, no review, and no suggestion — the matcher stayed silent. */
const paycheckCard = (): BankDeckCard[] => [{
  charge: {
    id: 'new-paycheck', user_id: 'u1', account_id: 'acct-1', amount: -815.75, date: '2026-08-14',
    pending: false, name: PAYROLL, merchant_name: null, category: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any,
  suggestion: null,
}];

function setup(cards = paycheckCard()) {
  const save = { mutateAsync: vi.fn().mockResolvedValue(undefined) };
  const setCategory = { mutateAsync: vi.fn().mockResolvedValue(undefined) };
  const remove = { mutateAsync: vi.fn().mockResolvedValue(undefined) };
  render(
    <DecisionDeck
      cards={cards}
      accountName={{ 'acct-1': 'Checking' }}
      reviewsByCharge={{}}
      rules={[paycheckRule]}
      save={save}
      setCategory={setCategory}
      remove={remove}
      onClose={vi.fn()}
    />,
  );
  return { save, setCategory };
}

describe('the deck and a paycheck', () => {
  it('offers Income on a money-in card, as the FIRST chip', async () => {
    setup();
    // The chips carry their keyboard digit in the accessible name, so match the visible label.
    const income = await screen.findByRole('button', { name: /Income/ });
    expect(income).toBeTruthy();
    // First, so it is chip `1` — on a deposit, "income" is the answer, not the ninth guess.
    expect(income.textContent).toContain('1');
  });

  it('offers the rule this merchant has been linked to, and says where that came from', async () => {
    setup();
    // The question is the yes/no, not the open "What is this?".
    expect(await screen.findByText(/Is this your Weekly Paycheck\?/)).toBeTruthy();
    // Provenance stated: this is memory about the merchant, NOT a match on this charge.
    expect(screen.getByText(/linked .* 22 times before/i)).toBeTruthy();
  });

  it('writes the list\'s own row when the remembered offer is accepted', async () => {
    const { save } = setup();
    fireEvent.click(await screen.findByRole('button', { name: /Yes — Weekly Paycheck/ }));
    await waitFor(() => expect(save.mutateAsync).toHaveBeenCalledTimes(1));
    // Byte-for-byte the row the Bank Activity rule picker writes.
    expect(save.mutateAsync).toHaveBeenCalledWith(
      acceptRuleInput({ id: 'new-paycheck', date: '2026-08-14' }, paycheckRule),
    );
  });

  it('asks the open question again when the merchant has no remembered link', async () => {
    // The bite: with memory empty, the card falls back to exactly the behaviour Tre reported.
    linkRules.current = {};
    setup();
    expect(await screen.findByText('What is this?')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Yes — / })).toBeNull();
  });

  it('stays silent when the remembered rule was retired', async () => {
    render(
      <DecisionDeck
        cards={paycheckCard()}
        accountName={{}}
        reviewsByCharge={{}}
        rules={[{ ...paycheckRule, active: false }]}
        save={{ mutateAsync: vi.fn() }}
        setCategory={{ mutateAsync: vi.fn() }}
        remove={{ mutateAsync: vi.fn() }}
        onClose={vi.fn()}
      />,
    );
    // Never resurrects a projection the user deliberately ended.
    expect(await screen.findByText('What is this?')).toBeTruthy();
  });

  it('never lets memory overrule a match on THIS charge', async () => {
    const matched = paycheckCard();
    matched[0].suggestion = { rule: { ...paycheckRule, id: 'other', name: 'Rent' } };
    setup(matched);
    expect(await screen.findByText(/Is this your Rent\?/)).toBeTruthy();
    // And no provenance line, because nothing was remembered — it was matched.
    expect(screen.queryByText(/times before/i)).toBeNull();
  });
});
