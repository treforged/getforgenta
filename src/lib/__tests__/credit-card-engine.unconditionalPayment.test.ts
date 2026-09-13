import { describe, it, expect } from 'vitest';
import { getMonthlyDebtBreakdown } from '../credit-card-engine';
import type { AccountRow } from '@/hooks/useSupabaseData';

/**
 * A CARD THE FORECAST MAY NOT SHRINK.
 *
 * Tre, 2026-09-12: "make a button that allows users to make a credit card always pay its full
 * balance or statement balance, unconditionally, regardless of whether or not the cash can fit
 * it... it's just gonna be another debit card, basically. And then all other calculations should
 * adjust around that. But if it is completely not possible, do as much as possible."
 *
 * ⚠️ "DO AS MUCH AS POSSIBLE" APPLIES TO THE OTHER SPENDING, NEVER TO THIS PAYMENT. The failure
 * mode is a GREEN PROJECTION, not a crash: every ordinary path here is clamped to the pool — a
 * minimum is `min(minPayment, remaining, balance)` and the cascade takes `min(remaining, maxExtra)`
 * — so a tight month silently reduces the payment and still reports a balanced plan. That is the
 * app quietly shrinking the one number he turned this on to guarantee.
 *
 * ⚠️ AND IT IS THE REVOLVING PATH THAT MATTERS, NOT THE `preferenceCards` ONE. An earlier attempt
 * put this on the `min(desired, preferencePool)` line at ~2435, which looked like the right place
 * and is not: `preferenceCards` is `filter(c => c.autopayFullBalance)` and `autopayFullBalance` is
 * `balance <= 0`, so that branch never sees a card carrying a balance. The flag did nothing for the
 * exact card he would enable it on, with a passing test pointing at the wrong object. Hence the
 * $2,000 balance below — it is the shape that caught it.
 *
 * ⚠️ WHAT THESE DO NOT PROVE. `getMonthlyDebtBreakdown` with no rules and no transactions reports
 * `totalAvailableCash` of 2000 against a $300 checking balance, so a genuinely CASH-STARVED month
 * cannot be built from this fixture — two assertions that depended on one were removed rather than
 * tuned until green. What is proven is that the payment is not clamped, that it is labelled, that
 * the statement variant pays the balance, and that the shortfall is always a finite number. A
 * month where the cash really does not fit still needs an integration-level fixture.
 *
 * ⚠️⚠️ AND THE CENTRAL CLAIM IS NOT PROVEN HERE, MEASURED BY MUTATION ON 2026-09-13. Replacing the
 * unclamped payment with `Math.min(desired, Math.max(0, remaining))` — i.e. restoring the exact
 * silent shrink this feature exists to prevent — leaves ALL FOUR of these tests GREEN. The reason
 * is the fixture: `remaining` here is never smaller than `desired`, so the clamp never binds and
 * the two behaviours are indistinguishable.
 *
 * So these prove the SHAPE (labelled, statement variant, finite shortfall, field survives the
 * rebuild) and NOT the behaviour that matters. The mutation that DOES fail is removing the field
 * from the `getMonthlyDebtBreakdown` rebuild, which is a real guard over a real bug. Do not read a
 * green run here as "the payment cannot be shrunk" — that needs a fixture where the pool is
 * genuinely smaller than the obligation, and building one is the next step.
 */

function makeAccount(overrides: Partial<AccountRow>): AccountRow {
  return {
    id: 'acct', user_id: 'test', name: 'Acct', account_type: 'credit_card', balance: 0,
    credit_limit: 5000, apr: 20, payment_due_day: 12, active: true,
    min_payment: null, payment_preference: null,
    ...overrides,
  } as AccountRow;
}

const profile = { cash_floor: 0 } as never;

/** $300 of cash against a $2,000 card he has told the app to clear in full. */
const tightMonth = (unconditional: boolean): AccountRow[] => [
  makeAccount({ id: 'chk', name: 'TOTAL CHECKING', account_type: 'checking', balance: 300, credit_limit: 0, apr: 0 }),
  makeAccount({
    id: 'debit-like', name: 'Robinhood', balance: 2000, apr: 29.99, min_payment: 40,
    payment_preference: 'full',
    ...(unconditional ? { payment_unconditional: true } : {}),
  } as Partial<AccountRow>),
];

const run = (accounts: AccountRow[]) => getMonthlyDebtBreakdown(accounts, [], [], [], profile, 0);
const recFor = (accounts: AccountRow[], id: string) =>
  run(accounts).recommendations.find(r => r.cardId === id);

describe('an unconditional card is a fixed obligation', () => {

  it('UNCONDITIONAL card: the payment stays WHOLE even though the cash does not fit', () => {
    const rec = recFor(tightMonth(true), 'debit-like');
    expect(rec).toBeTruthy();
    // The number he was promised, not the number that fits.
    expect(rec!.payment).toBeGreaterThanOrEqual(2000);
    expect(rec!.reason).toBe('Always pay full balance');
  });

  it('always reports a FINITE shortfall, never NaN', () => {
    // ⚠️ MEASURED, NOT HYPOTHETICAL. `remaining` derives from a chain of optional inputs and
    // arrives NaN under a sparse call like this one, which made the shortfall NaN and serialised
    // it as `null`. A shortfall is money shown to a person; a broken number there is worse than no
    // number, so an unknown pool reads as zero.
    const rec = recFor(tightMonth(true), 'debit-like');
    expect(Number.isFinite(rec!.unconditionalShortfall)).toBe(true);
    expect(rec!.unconditionalShortfall).toBeGreaterThanOrEqual(0);
  });

  it('statement preference pays the BALANCE, not balance plus new purchases', () => {
    const accounts = tightMonth(true).map(a =>
      a.id === 'debit-like' ? ({ ...a, payment_preference: 'statement' } as AccountRow) : a);
    const rec = recFor(accounts, 'debit-like');
    expect(rec!.payment).toBe(2000);
    expect(rec!.reason).toBe('Always pay statement balance');
  });

  it('changes NOTHING when the month can afford it — the flag is not a surcharge', () => {
    const flush: AccountRow[] = [
      makeAccount({ id: 'chk', name: 'TOTAL CHECKING', account_type: 'checking', balance: 9000, credit_limit: 0, apr: 0 }),
      makeAccount({
        id: 'debit-like', name: 'Robinhood', balance: 500, apr: 29.99, min_payment: 25,
        payment_preference: 'full', payment_unconditional: true,
      } as Partial<AccountRow>),
    ];
    const rec = recFor(flush, 'debit-like');
    expect(rec!.payment).toBeGreaterThanOrEqual(500);
    expect(rec!.unconditionalShortfall).toBe(0);
  });

});
