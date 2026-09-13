// @vitest-environment jsdom
//
// THE PROMPT THAT SHOULD NOT HAVE BEEN ASKED.
//
// Tre, on a payroll charge answered the same way 22 times and asked a 23rd, and on a utility bill
// that prompts every single month: the app asking about something it has been told repeatedly is
// the prompt he wants gone. `autoApplyDecision` is the five-gate answer; this file is the wiring.
//
// ⚠️ THE LOAD-BEARING TESTS ARE THE ONES THAT ASSERT IT DOES **NOT** FIRE. A suite of "settled
// merchants auto-apply" assertions is satisfied by code that applies everything, which is the
// failure that actually costs money — a wrong link the user never saw. Every gate therefore gets a
// case where it holds the write back, against the same merchant that auto-applies when it agrees.
//
// ⚠️ AND THE WRITE MUST STILL BE THE LIST'S OWN ROW. Auto-apply changes WHO decides, never WHAT is
// written — so the accept path asserted here is `acceptRuleInput`, the same row a human tap makes.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import DecisionDeck, { type BankDeckCard } from '../DecisionDeck';
import { deriveMerchantLinks, type MerchantLinkReview } from '@/lib/merchant-link-memory';
import { acceptRuleInput } from '@/lib/review-write-inputs';

const PAYROLL = 'PAYROLL CO';
const PAYCHECK_ID = 'rule-pay';

/** `count` prior links to the same rule, each at `amount` — real derived memory, not a hand fixture. */
function payrollMemory(count: number, amount: number | null, ruleId = PAYCHECK_ID) {
  const charges = Array.from({ length: count }, (_, i) => ({
    id: `p${i}`, name: PAYROLL, merchant_name: null, amount,
  }));
  const reviews: Record<string, MerchantLinkReview[]> = {};
  for (const [i, c] of charges.entries()) {
    reviews[c.id] = [{
      status: 'linked_rule', rule_id: ruleId,
      updated_at: `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
    }];
  }
  return deriveMerchantLinks(charges, reviews);
}

const linkRules = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('@/hooks/useMerchantMemory', () => ({
  useMerchantMemory: () => ({
    rules: {}, linkRules: linkRules.current, pass: { writes: [], byMerchant: [] },
    reviewsByCharge: {}, suppressed: {}, setSuppressed: () => {}, isLoading: false,
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

const payRule = {
  id: PAYCHECK_ID, user_id: 'u1', name: 'Weekly Paycheck', amount: 2000, frequency: 'weekly',
  rule_type: 'income', due_day: 5, due_month: null, start_date: null, active: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const charge = (id: string, amount: number, date: string) => ({
  id, user_id: 'u1', account_id: 'acct-1', amount, date, pending: false,
  name: PAYROLL, merchant_name: null, category: null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}) as any;

beforeEach(() => {
  linkRules.current = payrollMemory(22, 2000);
  window.matchMedia = window.matchMedia || ((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function setup(cards: BankDeckCard[]) {
  const save = { mutateAsync: vi.fn().mockResolvedValue(undefined) };
  const recordApplied = vi.fn().mockResolvedValue({ id: 'act-1' });
  render(
    <DecisionDeck
      cards={cards}
      accountName={{ 'acct-1': 'Checking' }}
      reviewsByCharge={{}}
      rules={[payRule]}
      paymentPlans={[]}
      carFunds={[]}
      ledger={[]}
      buildItems={[]}
      importToLedger={{ mutateAsync: vi.fn() }}
      undoImport={{ mutateAsync: vi.fn() }}
      transferLegIds={new Set()}
      save={save}
      setCategory={{ mutateAsync: vi.fn().mockResolvedValue(undefined) }}
      remove={{ mutateAsync: vi.fn().mockResolvedValue(undefined) }}
      recordApplied={recordApplied}
      markUndone={vi.fn().mockResolvedValue(undefined)}
      onClose={vi.fn()}
    />,
  );
  return { save, recordApplied };
}

/** One settled charge: 22 prior links, all $2,000, and this one is $2,000 too. */
const settled = (): BankDeckCard[] => [{ charge: charge('c1', 2000, '2026-08-05'), suggestion: null }];

describe('DecisionDeck — a merchant answered the same way 22 times is not asked again', () => {
  it('applies the remembered link without the user touching anything', async () => {
    const { save } = setup(settled());
    await waitFor(() => expect(save.mutateAsync).toHaveBeenCalledTimes(1));
    // ⚠️ COMPARED AGAINST `acceptRuleInput` ITSELF, not an object literal — this suite's standing
    // rule. Auto-apply changes WHO decides, never WHAT is written, and a deck that started
    // building its own row would pass a literal that happened to look right today.
    expect(save.mutateAsync.mock.calls[0][0])
      .toEqual(acceptRuleInput(charge('c1', 2000, '2026-08-05'), payRule));
  });

  it('SAYS SO on the end screen instead of crediting the user for it', async () => {
    setup(settled());
    // "1 charge decided" alone would be the app overstating what the person reviewed.
    expect(await screen.findByText(/applied without asking/i)).toBeTruthy();
  });

  it('records a durable undo for the unwatched write, at the moment it happens', async () => {
    // The ordering rule: a write the user is not watching must be reversible before it is made.
    const { recordApplied } = setup(settled());
    await waitFor(() => expect(recordApplied).toHaveBeenCalledTimes(1));
    expect(recordApplied.mock.calls[0][0].steps).toEqual([{ chargeId: 'c1', write: 'removeReviews' }]);
  });

  it('writes ONCE, not once per render', async () => {
    const { save } = setup(settled());
    await waitFor(() => expect(save.mutateAsync).toHaveBeenCalledTimes(1));
    await new Promise(r => setTimeout(r, 50));
    expect(save.mutateAsync).toHaveBeenCalledTimes(1);
  });
});

describe('DecisionDeck — every gate can still hold the write back', () => {
  /** The card must still be on screen, unanswered, with its question showing. */
  async function expectAsked(save: { mutateAsync: ReturnType<typeof vi.fn> }) {
    await waitFor(() => expect(screen.getByText(PAYROLL)).toBeTruthy());
    await new Promise(r => setTimeout(r, 50));
    expect(save.mutateAsync).not.toHaveBeenCalled();
  }

  it('ASKS when the merchant has too few links to be a habit', async () => {
    linkRules.current = payrollMemory(2, 2000);
    await expectAsked(setup(settled()).save);
  });

  it('ASKS when the linked amounts carry no readable figures', async () => {
    // The abstaining-gate case. Acting here would claim the amount was checked when it was not.
    linkRules.current = payrollMemory(22, null);
    await expectAsked(setup(settled()).save);
  });

  it('ASKS when THIS charge is wildly unusual for the merchant', async () => {
    // His own words: "the difference is just so large that it makes sense to confirm."
    const { save } = setup([{ charge: charge('c1', 850, '2026-08-05'), suggestion: null }]);
    await expectAsked(save);
  });

  it('ASKS when the merchant was charged twice in the same period', async () => {
    // His other named anomaly: "I was charged twice or something like that in the same month."
    const { save } = setup([
      { charge: charge('c1', 2000, '2026-08-05'), suggestion: null },
      { charge: charge('c2', 2000, '2026-08-19'), suggestion: null },
    ]);
    await expectAsked(save);
  });

  it('ASKS when the merchant has been linked two different ways', async () => {
    const mixed = payrollMemory(22, 2000);
    const key = Object.keys(mixed)[0];
    mixed[key] = { ...mixed[key], conflictingCount: 3 };
    linkRules.current = mixed;
    await expectAsked(setup(settled()).save);
  });

  it('ASKS — never auto-applies — when the pairing is implausible', async () => {
    // A $15 charge against a $2,000 rule is the case that started all of this. It must not be
    // acted on silently, and `linkSuggestionFor` should not even be offering it.
    const { save } = setup([{ charge: charge('c1', 15, '2026-08-05'), suggestion: null }]);
    await expectAsked(save);
  });
});
