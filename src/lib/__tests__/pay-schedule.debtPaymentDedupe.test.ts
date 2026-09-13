/**
 * A CARD PAYMENT COUNTED TWICE IN ONE MONTH.
 *
 * Tre: debt payments "do not link across accounts — the checking debit and the credit-card credit
 * are one event seen twice". The bank-row half of that is already handled (`transfer-pair-detection`
 * pairs both legs and the queue collapses them — verified against his real rows on 2026-09-13, all
 * three card payments paired, including the two Plaid labels `INCOME` on the card side). This file
 * is the half that actually moves a number: the LEDGER.
 *
 * ⚠️ THE OLD DEDUPE KEY WAS A FREE-TEXT NOTE, AND THE APP'S OWN BUTTON GUARANTEED IT WOULD MISS.
 * A generated debt payment is written with the note `"<Card Name> Payment"`. A row that came from
 * the bank carries the PROVIDER'S DESCRIPTOR — his real one reads
 * `DISCOVER E-PAYMENT 0237 WEB ID: 2510020270` — and "Add to my ledger" is what puts it there. The
 * two strings cannot be equal, so the projection survived beside the real payment and the month
 * counted it twice.
 *
 * The fixtures below use his real note strings rather than invented ones, because the whole defect
 * lives in what those strings actually look like.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mergeDebtPaymentsIntoStream, type EnrichedTransaction } from '../pay-schedule';

/** The month the merge scopes itself to is "now", so the clock is pinned. */
const NOW = new Date(2026, 8, 15, 12, 0, 0); // 2026-09-15
const THIS_MONTH = '2026-09';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

const generated = (cardName: string, amount: number, day = '10'): EnrichedTransaction => ({
  id: `debtpay:card-1:${THIS_MONTH}-${day}`,
  date: `${THIS_MONTH}-${day}`,
  type: 'expense',
  amount,
  category: 'Debt Payments',
  note: `${cardName} Payment`,
  payment_source: 'account:chk',
  isGenerated: true,
  isDebtPayment: true,
});

const real = (note: string, amount: number, day = '08'): EnrichedTransaction => ({
  id: `real-${note}-${amount}`,
  date: `${THIS_MONTH}-${day}`,
  type: 'expense',
  amount,
  category: 'Debt Payments',
  note,
  payment_source: 'account:chk',
  isGenerated: false,
});

const ids = (rows: EnrichedTransaction[]) => rows.map(r => r.id);

describe('a real payment retires the projection that predicted it', () => {
  it("⚠️ EVEN WHEN THE NOTE IS THE BANK'S DESCRIPTOR — the case that double-counted", () => {
    // His actual imported note. Nothing about it resembles "Discover Payment".
    const imported = real('DISCOVER E-PAYMENT 0237 WEB ID: 2510020270', 150.4);
    const merged = mergeDebtPaymentsIntoStream([imported], [generated('Discover', 150.4)]);
    expect(ids(merged)).toEqual([imported.id]);
  });

  it('still retires it on the note, which is how a hand-typed row matches', () => {
    const typed = real('Discover Payment', 150.4);
    const merged = mergeDebtPaymentsIntoStream([typed], [generated('Discover', 150.4)]);
    expect(ids(merged)).toEqual([typed.id]);
  });

  it('matches to the cent, not to the dollar', () => {
    const imported = real('CHASE CREDIT CRD AUTOPAY PPD ID: 4760039224', 743.75);
    const merged = mergeDebtPaymentsIntoStream([imported], [generated('Prime Visa', 743.75)]);
    expect(ids(merged)).toEqual([imported.id]);
  });
});

describe('what it must NOT cancel', () => {
  it('⚠️ ONE REAL PAYMENT RETIRES ONE PROJECTION, NOT BOTH CARDS', () => {
    // Two cards owing $200 each. A single $200 payment must leave one card still expected, or the
    // plan silently forgets a debt he still owes — the mirror failure of the one being fixed.
    const imported = real('DISCOVER E-PAYMENT 0237 WEB ID: 2510020270', 200);
    const merged = mergeDebtPaymentsIntoStream(
      [imported],
      [generated('Discover', 200, '10'), generated('Prime Visa', 200, '12')],
    );
    expect(merged.filter(r => r.isDebtPayment)).toHaveLength(1);
  });

  it('leaves a projection alone when the amounts differ', () => {
    const imported = real('DISCOVER E-PAYMENT 0237 WEB ID: 2510020270', 150.4);
    const merged = mergeDebtPaymentsIntoStream([imported], [generated('Discover', 725)]);
    expect(merged.filter(r => r.isDebtPayment)).toHaveLength(1);
  });

  it('⚠️ IGNORES A REAL PAYMENT FROM ANOTHER MONTH — his only such row is dated July', () => {
    const lastMonth = { ...real('DISCOVER E-PAYMENT 0237 WEB ID: 2510020270', 150.4), date: '2026-07-29' };
    const merged = mergeDebtPaymentsIntoStream([lastMonth], [generated('Discover', 150.4)]);
    expect(merged.filter(r => r.isDebtPayment)).toHaveLength(1);
  });

  it('ignores a row that is not a Debt Payment, however well the amount lines up', () => {
    const groceries = { ...real('Groceries', 150.4), category: 'Groceries' };
    const merged = mergeDebtPaymentsIntoStream([groceries], [generated('Discover', 150.4)]);
    expect(merged.filter(r => r.isDebtPayment)).toHaveLength(1);
  });

  it('⚠️ NEVER REMOVES A REAL ROW — it can only ever drop a projection', () => {
    // The direction matters: under-stating a plan is recoverable, deleting somebody's record is not.
    const a = real('DISCOVER E-PAYMENT 0237 WEB ID: 2510020270', 150.4, '02');
    const b = real('Payment to Chase card ending in 5630', 150.4, '09');
    const merged = mergeDebtPaymentsIntoStream([a, b], [generated('Discover', 150.4)]);
    expect(ids(merged).filter(id => id.startsWith('real-'))).toEqual([a.id, b.id]);
  });

  it('drops previously injected rows before merging, so repeats do not accumulate', () => {
    const stale = generated('Discover', 999, '01');
    const merged = mergeDebtPaymentsIntoStream([stale], [generated('Discover', 725)]);
    expect(merged.filter(r => r.isDebtPayment)).toHaveLength(1);
    expect(merged.filter(r => r.isDebtPayment)[0].amount).toBe(725);
  });
});
