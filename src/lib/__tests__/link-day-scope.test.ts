// Quieting the backlog a brand-new link arrives with.
//
// Linking a bank imports up to two years of history in one go. Every one of those rows is a charge
// the app has never been told about, so the review queue would greet a first-time user with a
// hundreds-long to-do list they never created — the exact nagging `bank-activity-queue.ts`'s header
// forbids, arriving by a different door. These pin that history BEFORE the link day files no card
// and is not counted, that everything from the link day on still does, and that an account whose
// link day cannot be read is left exactly as it was.

import { describe, it, expect } from 'vitest';
import { buildReviewQueue, type QueueCharge } from '../bank-activity-queue';
import { accountLinkDays, scopeQueueToLinkedHistory } from '../link-day-scope';

const charge = (id: string, amount: number, date: string, account = 'acct-1'): QueueCharge => ({
  id, account_id: account, amount, date,
});

const queueOf = (charges: readonly QueueCharge[]) => buildReviewQueue({
  charges, reviewsByCharge: {}, rules: [], ledger: [],
});

const linked = { id: 'acct-1', plaid_account_id: 'plaid-1', created_at: '2026-08-10T14:02:00Z' };

describe('accountLinkDays — only for accounts whose link day the client can actually read', () => {
  it('reads the link day off a Plaid-linked account\'s `created_at`', () => {
    expect(accountLinkDays([linked])).toEqual({ 'acct-1': '2026-08-10' });
  });

  it('leaves out a hand-entered account — its `created_at` is when the user typed it, not a link day', () => {
    expect(accountLinkDays([{ id: 'acct-2', plaid_account_id: null, created_at: '2026-01-01T00:00:00Z' }])).toEqual({});
  });

  it('leaves out a linked account with no `created_at` rather than guessing one', () => {
    expect(accountLinkDays([{ id: 'acct-3', plaid_account_id: 'plaid-3', created_at: null }])).toEqual({});
  });
});

describe('the queue a new link produces', () => {
  const before = charge('old', 42.5, '2026-05-19');
  const onDay = charge('same-day', 18, '2026-08-10');
  const after = charge('new', 61, '2026-08-12');

  it('files no card for history that predates the link', () => {
    const scoped = scopeQueueToLinkedHistory(queueOf([before, after]), accountLinkDays([linked]));
    expect(scoped.needsDecision.map(c => c.id)).toEqual(['new']);
  });

  it('keeps a charge dated ON the link day — the day itself is in scope', () => {
    const scoped = scopeQueueToLinkedHistory(queueOf([before, onDay]), accountLinkDays([linked]));
    expect(scoped.needsDecision.map(c => c.id)).toEqual(['same-day']);
  });

  it('drops the suggestion AND the badge count of an out-of-scope charge, not just the card', () => {
    const ledger = [{ id: 'txn-1', date: '2026-05-19', type: 'expense', amount: 42.5, payment_source: 'acct-1' }];
    const queue = buildReviewQueue({ charges: [before], reviewsByCharge: {}, rules: [], ledger });
    expect(queue.suggestedCount).toBe(1);

    const scoped = scopeQueueToLinkedHistory(queue, accountLinkDays([linked]));
    expect(scoped.suggestedCount).toBe(0);
    expect(scoped.suggestions).toEqual({});
  });

  it('changes NOTHING for an account whose link day cannot be read', () => {
    const queue = queueOf([before, after]);
    const scoped = scopeQueueToLinkedHistory(queue, accountLinkDays([{ id: 'acct-1', plaid_account_id: null, created_at: '2026-08-10T00:00:00Z' }]));
    expect(scoped.needsDecision.map(c => c.id)).toEqual(queue.needsDecision.map(c => c.id));
    expect(scoped.suggestedCount).toBe(queue.suggestedCount);
  });

  it('changes nothing for a charge that names no account', () => {
    const orphan = charge('orphan', 12, '2026-01-04', null as unknown as string);
    const scoped = scopeQueueToLinkedHistory(queueOf([orphan, after]), accountLinkDays([linked]));
    expect(scoped.needsDecision.map(c => c.id).sort()).toEqual(['new', 'orphan']);
  });

  it('scopes each account by its OWN link day', () => {
    const second = { id: 'acct-2', plaid_account_id: 'plaid-2', created_at: '2026-04-01T00:00:00Z' };
    const otherAccountOldRow = charge('other', 30, '2026-05-19', 'acct-2');
    const scoped = scopeQueueToLinkedHistory(
      queueOf([before, otherAccountOldRow]),
      accountLinkDays([linked, second]),
    );
    expect(scoped.needsDecision.map(c => c.id)).toEqual(['other']);
  });
});
