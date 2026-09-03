// Whether a first sync adopts a hand-made account, or makes a duplicate.
//
// Adopting the WRONG row is worse than the duplicate it prevents: it welds a provider account
// onto somebody's unrelated record, silently, with no obvious way back. A duplicate is visible
// and the user can delete it. So every test below that asserts `claim: false` is protecting the
// more expensive mistake, and the single `claim: true` case is the narrow one worth taking.
//
// Would-fail checks: drop the plaid_account_id filter and "never claims a linked account" fails,
// which is the one that corrupts an already-working link; drop the ambiguity guard and "two
// matches claims neither" fails, which is how one card becomes another.

import { describe, it, expect } from 'vitest';
import { chooseClaimCandidate } from '../../../supabase/functions/_shared/account-claim';
import type { ClaimableAccount } from '../../../supabase/functions/_shared/account-claim';

const TODAY = '2026-09-03';
const acct = (over: Partial<ClaimableAccount> = {}): ClaimableAccount => ({
  id: 'a1', account_type: 'credit_card', institution: 'Robinhood',
  plaid_account_id: null, card_start_date: null, ...over,
});

describe('chooseClaimCandidate', () => {
  it('claims the one hand-made card at that institution — the actual defect', () => {
    const v = chooseClaimCandidate([acct()], 'credit_card', 'Robinhood', TODAY);
    expect(v).toEqual({ claim: true, id: 'a1', reason: expect.stringContaining('exactly one') });
  });

  it('NEVER claims an account that is already provider-linked', () => {
    // Adopting one would move a working link onto a different provider identity.
    const v = chooseClaimCandidate([acct({ plaid_account_id: 'plaid_x' })], 'credit_card', 'Robinhood', TODAY);
    expect(v.claim).toBe(false);
  });

  it('does not claim across account types', () => {
    const v = chooseClaimCandidate([acct({ account_type: 'checking' })], 'credit_card', 'Robinhood', TODAY);
    expect(v.claim).toBe(false);
  });

  it('does not claim across institutions', () => {
    const v = chooseClaimCandidate([acct({ institution: 'Chase' })], 'credit_card', 'Robinhood', TODAY);
    expect(v.claim).toBe(false);
  });

  it('matches an institution despite punctuation and case', () => {
    const v = chooseClaimCandidate([acct({ institution: 'robinhood!' })], 'credit_card', 'Robinhood', TODAY);
    expect(v.claim).toBe(true);
  });

  it('refuses to match when the institution is missing on either side', () => {
    // An empty string must not equal an empty string here, or every unlinked account of the right
    // type at an unnamed institution becomes claimable.
    expect(chooseClaimCandidate([acct({ institution: null })], 'credit_card', 'Robinhood', TODAY).claim).toBe(false);
    expect(chooseClaimCandidate([acct()], 'credit_card', null, TODAY).claim).toBe(false);
  });

  it('LEAVES A NOT-YET-OPEN CARD ALONE — a plan is not a holding', () => {
    // Tre's Venture X and Apple Card are dated in the future on purpose.
    const v = chooseClaimCandidate([acct({ card_start_date: '2027-01-01' })], 'credit_card', 'Robinhood', TODAY);
    expect(v).toEqual({ claim: false, reason: expect.stringContaining('not opened yet') });
  });

  it('still claims a card whose start date has already passed', () => {
    const v = chooseClaimCandidate([acct({ card_start_date: '2026-01-01' })], 'credit_card', 'Robinhood', TODAY);
    expect(v.claim).toBe(true);
  });

  it('treats a card opening TODAY as open, not as a plan', () => {
    const v = chooseClaimCandidate([acct({ card_start_date: TODAY })], 'credit_card', 'Robinhood', TODAY);
    expect(v.claim).toBe(true);
  });

  it('WITH TWO EQUALLY GOOD MATCHES IT CLAIMS NEITHER', () => {
    // Guessing here is how somebody's Freedom becomes their Sapphire.
    const v = chooseClaimCandidate(
      [acct({ id: 'a1' }), acct({ id: 'a2' })], 'credit_card', 'Robinhood', TODAY);
    expect(v).toEqual({ claim: false, reason: expect.stringContaining('2 equally good') });
  });

  it('picks the open one when the other match is a future card', () => {
    const v = chooseClaimCandidate(
      [acct({ id: 'plan', card_start_date: '2027-01-01' }), acct({ id: 'real' })],
      'credit_card', 'Robinhood', TODAY);
    expect(v).toEqual({ claim: true, id: 'real', reason: expect.any(String) });
  });

  it('claims nothing when the user has no accounts at all', () => {
    expect(chooseClaimCandidate([], 'credit_card', 'Robinhood', TODAY).claim).toBe(false);
  });
});
