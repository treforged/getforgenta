// §1B — the transfer-pair detector.
//
// ⚠️ THE FALSE-POSITIVE TESTS ARE THE POINT OF THIS FILE, not the happy paths. A missed pair leaves
// two rows in a queue; a WRONG pair collapses a real purchase into a transfer and takes it out of the
// queue entirely, and then withholds the one button that would have recorded it. Three shapes from
// Tre's own live rows are pinned below for exactly that reason, and each is a shape that passes the
// naive "opposite signs, equal amount, close dates, different accounts" rule.
//
// Amounts follow Stage A's convention throughout: OUTFLOW POSITIVE, inflow negative.

import { describe, it, expect } from 'vitest';
import {
  detectTransferPairs, indexPairsByLeg, describeTransfer,
  TRANSFER_DATE_WINDOW_DAYS,
  type PairableTransfer, type PairableAccount,
} from '../transfer-pair-detection';

const CHECKING: PairableAccount = { id: 'acct-checking', name: 'TOTAL CHECKING', account_type: 'checking' };
const SAVINGS: PairableAccount = { id: 'acct-savings', name: 'Savings Account', account_type: 'savings' };
const CARD: PairableAccount = { id: 'acct-card', name: 'Prime Visa', account_type: 'credit_card' };
const CARD2: PairableAccount = { id: 'acct-card2', name: 'Discover it Card', account_type: 'credit_card' };
const ACCOUNTS = [CHECKING, SAVINGS, CARD, CARD2];

const txn = (over: Partial<PairableTransfer> & Pick<PairableTransfer, 'id' | 'account_id' | 'amount' | 'date'>): PairableTransfer => ({
  name: 'row', merchant_name: null, category: 'TRANSFER_OUT', ...over,
});

describe('detectTransferPairs — the movements it must find', () => {
  it('pairs the $941.01 Chase autopay, whose two legs Plaid labels differently', () => {
    // The flagship live case, and the reason a category-only gate is not enough: the SAME event is
    // `LOAN_PAYMENTS` leaving checking and `INCOME` arriving at the card.
    const pairs = detectTransferPairs([
      txn({ id: 'out', account_id: CHECKING.id, amount: 941.01, date: '2026-08-10', category: 'LOAN_PAYMENTS' }),
      txn({ id: 'in', account_id: CARD.id, amount: -941.01, date: '2026-08-07', category: 'INCOME' }),
    ], ACCOUNTS);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].out.id).toBe('out');
    expect(pairs[0].in.id).toBe('in');
    expect(pairs[0].amount).toBeCloseTo(941.01, 2);
    expect(pairs[0].fromAccount.name).toBe('TOTAL CHECKING');
    expect(pairs[0].toAccount.name).toBe('Prime Visa');
  });

  it('names the card a movement PAID, and only when the money arrived on one', () => {
    // What lets the UI offer the card's payment obligation instead of a spending category.
    const [cardPair] = detectTransferPairs([
      txn({ id: 'o', account_id: CHECKING.id, amount: 500, date: '2026-06-06', category: 'LOAN_PAYMENTS' }),
      txn({ id: 'i', account_id: CARD.id, amount: -500, date: '2026-06-06', category: 'INCOME' }),
    ], ACCOUNTS);
    expect(cardPair.paidCard?.name).toBe('Prime Visa');

    const [savingsPair] = detectTransferPairs([
      txn({ id: 'o', account_id: CHECKING.id, amount: 200, date: '2026-06-08' }),
      txn({ id: 'i', account_id: SAVINGS.id, amount: -200, date: '2026-06-09', category: 'TRANSFER_IN' }),
    ], ACCOUNTS);
    expect(savingsPair.paidCard).toBeNull();
  });

  it('pairs a balance transfer between two cards', () => {
    // Tre's real 2026-06-21 $5,037.73: the debt moved from Prime Visa to Discover, so the MONEY moved
    // out of Discover and into Prime Visa. Both legs land on credit cards, two days apart.
    const pairs = detectTransferPairs([
      txn({ id: 'out', account_id: CARD2.id, amount: 5037.73, date: '2026-06-21', category: 'LOAN_DISBURSEMENTS' }),
      txn({ id: 'in', account_id: CARD.id, amount: -5037.73, date: '2026-06-23', category: 'LOAN_PAYMENTS' }),
    ], ACCOUNTS);

    expect(pairs).toHaveLength(1);
    expect(describeTransfer(pairs[0])).toBe('Discover it Card → Prime Visa');
    expect(pairs[0].paidCard?.name).toBe('Prime Visa');
  });

  it('uses `matchCharge`\'s exact tier: sub-cent drift passes, more does not', () => {
    // ⚠️ The comparator is `AMOUNT_EXACT_TOLERANCE` and the `>` test from `transaction-matching`,
    // deliberately reused rather than reimplemented — so it inherits that file's binary-float
    // boundary, where a difference of exactly 0.01 can land a hair above 0.01 and be refused. That
    // is fine here and the test says so rather than hiding it: the two legs of a real transfer carry
    // the SAME number, so the tolerance is a defensive band, not a working assumption. Widening it
    // would be a second comparator, which is the one thing this file must not grow.
    const near = detectTransferPairs([
      txn({ id: 'o', account_id: CHECKING.id, amount: 82.78, date: '2026-07-02' }),
      txn({ id: 'i', account_id: SAVINGS.id, amount: -82.785, date: '2026-07-01', category: 'TRANSFER_IN' }),
    ], ACCOUNTS);
    expect(near).toHaveLength(1);

    const far = detectTransferPairs([
      txn({ id: 'o', account_id: CHECKING.id, amount: 82.78, date: '2026-07-02' }),
      txn({ id: 'i', account_id: SAVINGS.id, amount: -82.9, date: '2026-07-01', category: 'TRANSFER_IN' }),
    ], ACCOUNTS);
    expect(far).toHaveLength(0);
  });

  it('accepts a leg at the edge of the window and rejects the day beyond it', () => {
    const at = detectTransferPairs([
      txn({ id: 'o', account_id: CHECKING.id, amount: 350, date: '2026-06-22' }),
      txn({ id: 'i', account_id: SAVINGS.id, amount: -350, date: `2026-06-${22 + TRANSFER_DATE_WINDOW_DAYS}`, category: 'TRANSFER_IN' }),
    ], ACCOUNTS);
    expect(at).toHaveLength(1);

    const beyond = detectTransferPairs([
      txn({ id: 'o', account_id: CHECKING.id, amount: 350, date: '2026-06-22' }),
      txn({ id: 'i', account_id: SAVINGS.id, amount: -350, date: `2026-06-${23 + TRANSFER_DATE_WINDOW_DAYS}`, category: 'TRANSFER_IN' }),
    ], ACCOUNTS);
    expect(beyond).toHaveLength(0);
  });
});

describe('detectTransferPairs — what it must refuse', () => {
  it('refuses two rows on the SAME account', () => {
    const pairs = detectTransferPairs([
      txn({ id: 'o', account_id: CHECKING.id, amount: 100, date: '2026-05-01' }),
      txn({ id: 'i', account_id: CHECKING.id, amount: -100, date: '2026-05-01', category: 'TRANSFER_IN' }),
    ], ACCOUNTS);
    expect(pairs).toHaveLength(0);
  });

  it('refuses a leg whose account the app cannot name', () => {
    // "Between accounts you own" is the entire claim; an unknown account cannot support it.
    const pairs = detectTransferPairs([
      txn({ id: 'o', account_id: CHECKING.id, amount: 100, date: '2026-05-01' }),
      txn({ id: 'i', account_id: 'acct-not-in-the-list', amount: -100, date: '2026-05-01', category: 'TRANSFER_IN' }),
    ], ACCOUNTS);
    expect(pairs).toHaveLength(0);
  });

  it('refuses the real $50 7-Eleven charge, because the credit prefers a same-day transfer', () => {
    // LIVE SHAPE (2026-08-13). A $50 purchase on Prime Visa sits three days from a $50 credit to
    // General Operations that ALSO has a same-day $50 transfer beside it. The mutual-best rule is
    // what saves the purchase here — the credit's better explanation is the transfer.
    const pairs = detectTransferPairs([
      txn({ id: 'seven-eleven', account_id: CARD.id, amount: 50, date: '2026-08-03', name: '7-Eleven', category: 'GENERAL_MERCHANDISE' }),
      txn({ id: 'real-out', account_id: CHECKING.id, amount: 50, date: '2026-08-06', category: 'TRANSFER_OUT' }),
      txn({ id: 'credit', account_id: SAVINGS.id, amount: -50, date: '2026-08-06', category: 'TRANSFER_IN' }),
    ], ACCOUNTS);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].out.id).toBe('real-out');
    expect(indexPairsByLeg(pairs).has('seven-eleven')).toBe(false);
  });

  it('refuses a fee that happens to equal a Zelle from a third party the same day', () => {
    // LIVE SHAPES: "Aamc" $36 and "Patent and Trademark Svc" $350, each equal and adjacent to a Zelle
    // from Ariana. Two genuinely separate movements. The category gate is what rejects these —
    // GOVERNMENT_AND_NON_PROFIT is not a thing money moves between your own accounts as.
    const pairs = detectTransferPairs([
      txn({ id: 'aamc', account_id: CARD2.id, amount: 36, date: '2026-03-08', name: 'Aamc', category: 'GOVERNMENT_AND_NON_PROFIT' }),
      txn({ id: 'zelle-in', account_id: CHECKING.id, amount: -36, date: '2026-03-08', category: 'TRANSFER_IN' }),
      txn({ id: 'patent', account_id: CARD2.id, amount: 350, date: '2026-04-26', name: 'Patent and Trademark Svc', category: 'GOVERNMENT_AND_NON_PROFIT' }),
      txn({ id: 'zelle-in-2', account_id: CHECKING.id, amount: -350, date: '2026-04-26', category: 'TRANSFER_IN' }),
    ], ACCOUNTS);
    expect(pairs).toHaveLength(0);
  });

  it('refuses a tie — two equally good candidates yield NO pair, never a coin flip', () => {
    // Two $50 Zelle debits on one day, both the same distance from one credit.
    const pairs = detectTransferPairs([
      txn({ id: 'out-a', account_id: CHECKING.id, amount: 50, date: '2026-06-02' }),
      txn({ id: 'out-b', account_id: CARD.id, amount: 50, date: '2026-06-02' }),
      txn({ id: 'credit', account_id: SAVINGS.id, amount: -50, date: '2026-06-02', category: 'TRANSFER_IN' }),
    ], ACCOUNTS);
    expect(pairs).toHaveLength(0);
  });

  it('keeps only the mutually-best leg when several debits could explain one credit', () => {
    // LIVE SHAPE: three $500 debits within two days of ONE $500 card credit. Only the same-day one is
    // mutually best; the other two stay in the queue where the user can still decide about them.
    const pairs = detectTransferPairs([
      txn({ id: 'same-day', account_id: CHECKING.id, amount: 500, date: '2026-02-13', category: 'LOAN_PAYMENTS' }),
      txn({ id: 'day-before', account_id: SAVINGS.id, amount: 500, date: '2026-02-12', category: 'TRANSFER_OUT' }),
      txn({ id: 'two-days-before', account_id: CARD2.id, amount: 500, date: '2026-02-11', category: 'TRANSFER_OUT' }),
      txn({ id: 'credit', account_id: CARD.id, amount: -500, date: '2026-02-13', category: 'INCOME' }),
    ], ACCOUNTS);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].out.id).toBe('same-day');
  });

  it('refuses an ordinary purchase and refund of the same amount', () => {
    // A purchase is not a transfer even when a matching credit lands next to it, because the credit
    // has to be on an account the user owns AND both legs have to look like a movement.
    const pairs = detectTransferPairs([
      txn({ id: 'buy', account_id: CARD.id, amount: 129.99, date: '2026-05-04', category: 'GENERAL_MERCHANDISE' }),
      txn({ id: 'refund', account_id: CHECKING.id, amount: -129.99, date: '2026-05-05', category: 'GENERAL_MERCHANDISE' }),
    ], ACCOUNTS);
    expect(pairs).toHaveLength(0);
  });

  it('does not let a null category alone carry a pair', () => {
    // The provider saying nothing is not evidence. One leg on a card would rescue this; two silent
    // deposit accounts must not.
    const pairs = detectTransferPairs([
      txn({ id: 'o', account_id: CHECKING.id, amount: 75, date: '2026-05-04', category: null }),
      txn({ id: 'i', account_id: SAVINGS.id, amount: -75, date: '2026-05-04', category: null }),
    ], ACCOUNTS);
    expect(pairs).toHaveLength(0);
  });

  it('ignores a zero or unparseable amount rather than pairing it with everything', () => {
    const pairs = detectTransferPairs([
      txn({ id: 'o', account_id: CHECKING.id, amount: 0, date: '2026-05-04' }),
      txn({ id: 'i', account_id: SAVINGS.id, amount: -0, date: '2026-05-04', category: 'TRANSFER_IN' }),
    ], ACCOUNTS);
    expect(pairs).toHaveLength(0);
  });
});

describe('the shapes the UI reads', () => {
  const pairs = detectTransferPairs([
    txn({ id: 'o', account_id: CHECKING.id, amount: 941.01, date: '2026-08-10', category: 'LOAN_PAYMENTS' }),
    txn({ id: 'i', account_id: CARD.id, amount: -941.01, date: '2026-08-07', category: 'INCOME' }),
  ], ACCOUNTS);

  it('indexes BOTH legs at the same pair, so either row can ask "am I half of something?"', () => {
    const index = indexPairsByLeg(pairs);
    expect(index.size).toBe(2);
    expect(index.get('o')).toBe(index.get('i'));
  });

  it('describes the movement by the accounts, not by either bank\'s description of its own half', () => {
    expect(describeTransfer(pairs[0])).toBe('TOTAL CHECKING → Prime Visa');
  });

  it('keys a pair stably and independently of the order the rows arrive in', () => {
    const reversed = detectTransferPairs([
      txn({ id: 'i', account_id: CARD.id, amount: -941.01, date: '2026-08-07', category: 'INCOME' }),
      txn({ id: 'o', account_id: CHECKING.id, amount: 941.01, date: '2026-08-10', category: 'LOAN_PAYMENTS' }),
    ], ACCOUNTS);
    expect(reversed[0].key).toBe(pairs[0].key);
  });

  it('returns newest movement first', () => {
    const many = detectTransferPairs([
      txn({ id: 'o1', account_id: CHECKING.id, amount: 10, date: '2026-01-05' }),
      txn({ id: 'i1', account_id: SAVINGS.id, amount: -10, date: '2026-01-05', category: 'TRANSFER_IN' }),
      txn({ id: 'o2', account_id: CHECKING.id, amount: 20, date: '2026-03-05' }),
      txn({ id: 'i2', account_id: SAVINGS.id, amount: -20, date: '2026-03-05', category: 'TRANSFER_IN' }),
    ], ACCOUNTS);
    expect(many.map(p => p.out.id)).toEqual(['o2', 'o1']);
  });

  it('accepts `numeric` amounts as the strings PostgREST actually sends', () => {
    const pairsFromStrings = detectTransferPairs([
      txn({ id: 'o', account_id: CHECKING.id, amount: '45.00', date: '2026-06-21' }),
      txn({ id: 'i', account_id: SAVINGS.id, amount: '-45.00', date: '2026-06-21', category: 'TRANSFER_IN' }),
    ], ACCOUNTS);
    expect(pairsFromStrings).toHaveLength(1);
    expect(pairsFromStrings[0].amount).toBeCloseTo(45, 2);
  });
});
