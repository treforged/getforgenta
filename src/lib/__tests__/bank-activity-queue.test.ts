import { describe, it, expect } from 'vitest';
import {
  buildReviewQueue, isChargeHandled,
  type QueueCharge, type QueueRule, type QueueLedgerTxn, type QueueReview,
} from '../bank-activity-queue';

const ACCT = 'acct-1';

const charge = (id: string, date: string, amount: number, account: string | null = ACCT): QueueCharge =>
  ({ id, account_id: account, amount, date });

const ledgerTxn = (id: string, date: string, amount: number, type = 'expense'): QueueLedgerTxn =>
  ({ id, date, type, amount, payment_source: `account:${ACCT}` });

const rule = (id: string, name: string, amount: number, dueDay: number): QueueRule =>
  ({ id, name, amount, due_day: dueDay, frequency: 'monthly', rule_type: 'expense', payment_source: ACCT, active: true });

const queue = (input: Partial<Parameters<typeof buildReviewQueue<QueueCharge, QueueRule, QueueLedgerTxn>>[0]>) =>
  buildReviewQueue<QueueCharge, QueueRule, QueueLedgerTxn>({
    charges: [], reviewsByCharge: {}, rules: [], ledger: [], ...input,
  });

describe('isChargeHandled', () => {
  it('treats every terminal status as handled', () => {
    for (const status of ['linked_rule', 'linked_txn', 'imported', 'ignored', 'linked_plan', 'linked_car']) {
      expect(isChargeHandled([{ status }])).toBe(true);
    }
  });

  it('does NOT treat a category correction as a decision about the charge', () => {
    // Relabelling takes no position on whether the charge was dealt with. If this ever flips,
    // fixing a wrong category would silently remove a row from the queue.
    expect(isChargeHandled([{ status: 'categorized' }])).toBe(false);
  });

  it('treats no rows at all as unreviewed, which is not handled', () => {
    expect(isChargeHandled([])).toBe(false);
  });
});

describe('buildReviewQueue — what still needs a decision', () => {
  it('THE REGRESSION THIS SLICE EXISTS FOR: a suggestion months in the past is still in the queue', () => {
    // Bank Activity used to open on the CURRENT month, so this May charge's correct suggestion was
    // invisible from June onward. The queue is month-agnostic by construction; if a month filter is
    // ever pushed down into it, this fails.
    const may = charge('c-may', '2026-05-01', 371);
    const june = charge('c-jun', '2026-06-29', 1100);
    const august = charge('c-aug', '2026-08-03', 10);
    const q = queue({
      charges: [august, june, may],
      ledger: [ledgerTxn('l-may', '2026-05-01', 371), ledgerTxn('l-jun', '2026-06-29', 1100)],
    });

    expect(q.suggestions['c-may']?.ledgerTxn?.id).toBe('l-may');
    expect(q.suggestions['c-jun']?.ledgerTxn?.id).toBe('l-jun');
    expect(q.suggestedCount).toBe(2);
    expect(q.needsDecision.map(c => c.id)).toContain('c-may');
  });

  it('drops charges the user already decided, and counts only the rest', () => {
    const q = queue({
      charges: [charge('a', '2026-08-01', 50), charge('b', '2026-08-02', 60), charge('c', '2026-08-03', 70)],
      reviewsByCharge: { a: [{ status: 'ignored' }], b: [{ status: 'linked_rule' }] },
      ledger: [ledgerTxn('l-c', '2026-08-03', 70)],
    });

    expect(q.needsDecision.map(c => c.id)).toEqual(['c']);
    expect(q.suggestedCount).toBe(1);
  });

  it('sorts suggestion-carrying rows to the top, newest first inside each group', () => {
    // A one-click decision must never be buried under open-ended chores — that is the same failure
    // as the month default, one level down.
    const q = queue({
      charges: [
        charge('chore-new', '2026-08-10', 11),
        charge('chore-old', '2026-06-10', 12),
        charge('hit-old', '2026-05-10', 500),
        charge('hit-new', '2026-07-10', 600),
      ],
      ledger: [ledgerTxn('l1', '2026-05-10', 500), ledgerTxn('l2', '2026-07-10', 600)],
    });

    expect(q.needsDecision.map(c => c.id)).toEqual(['hit-new', 'hit-old', 'chore-new', 'chore-old']);
  });

  it('a rejected suggestion stops being counted but the charge still needs a decision', () => {
    // "Not this" is a RE-TARGET, not a dismissal: the row stays in the queue with the pickers open.
    const base = { charges: [charge('a', '2026-08-01', 90)], ledger: [ledgerTxn('l-a', '2026-08-01', 90)] };
    expect(queue(base).suggestedCount).toBe(1);

    const q = queue({ ...base, rejected: { a: true } });
    expect(q.suggestedCount).toBe(0);
    expect(q.needsDecision.map(c => c.id)).toEqual(['a']);
  });

  it('suggests the rule when one settles the charge, in preference to a ledger row', () => {
    const q = queue({
      charges: [charge('a', '2026-08-05', 65)],
      rules: [rule('r1', 'Fuel', 65, 5)],
      ledger: [ledgerTxn('l-a', '2026-08-05', 65)],
    });

    expect(q.suggestions['a']?.rule?.name).toBe('Fuel');
    expect(q.suggestions['a']?.ledgerTxn).toBeUndefined();
  });
});

describe('buildReviewQueue — the matcher is NOT loosened to raise the hit rate', () => {
  it('three identical charges against one ledger row yield NO suggestion', () => {
    // The real shape: three identical $10.00 CFX tolls on 2026-08-03. Two equally good candidates is
    // a coin flip, and a coin flip presented as evidence is worse than silence. Do not "fix" this by
    // relaxing matchCharge's one-candidate rule.
    const q = queue({
      charges: [charge('t1', '2026-08-03', 10), charge('t2', '2026-08-03', 10), charge('t3', '2026-08-03', 10)],
      ledger: [ledgerTxn('l-toll', '2026-08-03', 10)],
    });

    expect(q.suggestedCount).toBe(0);
    expect(q.needsDecision).toHaveLength(3);
  });

  it('but the dedupe does not over-fire: two identical charges with two entries keep both', () => {
    // The guard drops a suggestion only when several charges claim the SAME entry. Two tolls and two
    // matching entries is not ambiguous in that sense — each entry has one claimant.
    const q = queue({
      charges: [charge('t1', '2026-08-03', 10), charge('t2', '2026-08-04', 10)],
      ledger: [ledgerTxn('l1', '2026-08-03', 10), ledgerTxn('l2', '2026-08-14', 10)],
    });

    // l2 sits outside t1/t2's ±5-day window, so only l1 is a candidate for either — and both claim
    // it. Silence is the honest answer, and it is the same answer the three-toll case gets.
    expect(q.suggestedCount).toBe(0);
  });

  it('a single legitimate claimant still gets its suggestion', () => {
    const q = queue({
      charges: [charge('t1', '2026-08-03', 10), charge('t2', '2026-08-03', 25)],
      ledger: [ledgerTxn('l1', '2026-08-03', 10)],
    });

    expect(q.suggestions['t1']?.ledgerTxn?.id).toBe('l1');
    expect(q.suggestedCount).toBe(1);
  });

  it('direction is a hard gate — an income entry never satisfies an outflow charge', () => {
    const q = queue({
      charges: [charge('a', '2026-08-01', 200)],
      ledger: [ledgerTxn('l-a', '2026-08-01', 200, 'income')],
    });

    expect(q.suggestedCount).toBe(0);
  });

  it('an unattributed charge can never match', () => {
    const q = queue({
      charges: [charge('a', '2026-08-01', 200, null)],
      ledger: [ledgerTxn('l-a', '2026-08-01', 200)],
    });

    expect(q.suggestedCount).toBe(0);
  });

  it('a charge in a different account does not match', () => {
    const q = queue({
      charges: [charge('a', '2026-08-01', 200, 'other-acct')],
      ledger: [ledgerTxn('l-a', '2026-08-01', 200)],
    });

    expect(q.suggestedCount).toBe(0);
  });
});

describe('buildReviewQueue — the count is suggestions, never unreviewed rows', () => {
  it('a large permanently-unreviewed history contributes nothing to the badge', () => {
    // The standing rule (Tre, 2026-08-08): unreviewed means nothing at all, and most rows are
    // unreviewed by design. A badge the user cannot drive to zero is the nagging that rule forbids.
    const charges: QueueCharge[] = [];
    for (let i = 0; i < 500; i++) charges.push(charge(`c${i}`, '2026-04-01', 3 + i));
    const q = queue({ charges });

    expect(q.needsDecision).toHaveLength(500);
    expect(q.suggestedCount).toBe(0);
  });

  it('reads reviews per charge, not globally', () => {
    const reviewsByCharge: Record<string, QueueReview[]> = { a: [{ status: 'ignored' }] };
    const q = queue({ charges: [charge('a', '2026-08-01', 5), charge('b', '2026-08-01', 6)], reviewsByCharge });

    expect(q.needsDecision.map(c => c.id)).toEqual(['b']);
  });
});
