// The demo feed, judged by the app's own §1B code rather than by a count written down by hand.
//
// ⚠️ WHAT THIS PROTECTS. `demoSyncedTransactions` exists so the Decision Deck and the patterns card
// have something to show on the sales surface. Nothing about a fixture stops an innocuous edit — a
// day moved, an amount rounded — from quietly taking every suggestion away and returning both
// surfaces to the empty state the fixture was written to end. So each of the three properties the
// fixture has to hold is asserted THROUGH `buildReviewQueue` and `proposeRulesFromHistory`, the same
// functions the app runs, with the same demo rules and accounts the app serves.

import { describe, it, expect } from 'vitest';
import { demoSyncedTransactions, demoRecurringRules, demoAccounts } from '@/lib/demo-data';
import { buildReviewQueue } from '@/lib/bank-activity-queue';
import { buildDeck } from '@/lib/decision-deck';
import { proposeRulesFromHistory } from '@/lib/rules-from-history';
import { accountLinkDays, scopeQueueToLinkedHistory } from '@/lib/link-day-scope';

const queue = () => scopeQueueToLinkedHistory(
  buildReviewQueue({
    charges: demoSyncedTransactions,
    reviewsByCharge: {},
    rules: demoRecurringRules,
    ledger: [],
    plans: [],
    carFunds: [],
    fundingAccountId: 'd1',
    rejected: {},
  }),
  accountLinkDays(demoAccounts),
);

const merchantsOf = (ids: readonly string[]) =>
  new Set(ids.map(id => demoSyncedTransactions.find(c => c.id === id)?.merchant_name));

describe('demo bank activity fixture', () => {
  it('every row is settled, on a demo account, and uniquely identified', () => {
    expect(demoSyncedTransactions.length).toBeGreaterThan(0);
    expect(demoSyncedTransactions.every(c => c.pending === false)).toBe(true);
    const accountIds = new Set(demoAccounts.map(a => a.id));
    expect(demoSyncedTransactions.every(c => accountIds.has(c.account_id))).toBe(true);
    expect(new Set(demoSyncedTransactions.map(c => c.id)).size).toBe(demoSyncedTransactions.length);
  });

  it('inflow is negative and outflow positive — the provider convention, not the ledger one', () => {
    const payroll = demoSyncedTransactions.filter(c => c.merchant_name === 'Ridgeline Fabrication');
    expect(payroll.length).toBeGreaterThan(0);
    expect(payroll.every(c => c.amount < 0)).toBe(true);
    expect(demoSyncedTransactions.filter(c => c.merchant_name === 'Chevron').every(c => c.amount > 0)).toBe(true);
  });

  // PROPERTY 1 — the deck has cards, and they are the one-click kind.
  it('fills the Decision Deck with suggestion-carrying cards', () => {
    const q = queue();
    const deck = buildDeck(q);
    expect(deck.length).toBeGreaterThan(20);
    expect(q.suggestedCount).toBeGreaterThan(0);
    // The deck's first card is a decision the app has an answer for, which is the whole ordering rule.
    expect(deck[0].suggestion).not.toBeNull();
  });

  it('the charges written to match a demo rule are the ones carrying suggestions', () => {
    const q = queue();
    const suggested = merchantsOf(Object.keys(q.suggestions));
    expect(suggested.has('Ridgeview Apartments')).toBe(true);
    expect(suggested.has('Duke Energy')).toBe(true);
    expect(suggested.has('Progressive Insurance')).toBe(true);
  });

  // PROPERTY 3 — one-offs produce no suggestion, so the deck is not a wall of false certainty.
  it('leaves the build-thread one-offs unsuggested', () => {
    const q = queue();
    const suggested = merchantsOf(Object.keys(q.suggestions));
    expect(suggested.has('Summit Racing')).toBe(false);
    expect(suggested.has('Tire Rack')).toBe(false);
    expect(suggested.has('Apex Dyno')).toBe(false);
  });

  // PROPERTY 2 — the patterns card has patterns.
  it('yields rules-from-history proposals for the merchants no demo rule covers', () => {
    const proposals = proposeRulesFromHistory({
      charges: demoSyncedTransactions,
      rules: demoRecurringRules,
      links: [],
    });
    const named = new Set(proposals.map(p => p.merchantLabel));
    expect(named.has('Apex Auto Detailing')).toBe(true);
    expect(named.has('Verizon Wireless')).toBe(true);
    expect(named.has('Iron Peak Storage')).toBe(true);
  });

  it('proposes nothing for a merchant a demo rule already covers — that would double-count it', () => {
    const proposals = proposeRulesFromHistory({
      charges: demoSyncedTransactions,
      rules: demoRecurringRules,
      links: [],
    });
    const named = new Set(proposals.map(p => p.merchantLabel));
    expect(named.has('Ridgeview Apartments')).toBe(false);
    expect(named.has('Duke Energy')).toBe(false);
  });
});
