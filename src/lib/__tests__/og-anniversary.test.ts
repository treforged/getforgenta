// The anniversary run's decisions, exercised A YEAR BEFORE THE PATH RUNS FOR REAL.
//
// That sentence is the entire reason this file exists. The first genuine anniversary is twelve
// months out; without these, the code would be executed for the first time in production, once,
// on a date nobody is watching, for a promise made to the hundred people most invested in the
// product. A bug in it is not a bug, it is a broken promise.
//
// Would-fail checks: remove the `reward_granted_at` guard and "cannot grant twice" fails, which
// is the one that costs real money; make an ineligible member grantable and the forfeit case
// fails; return `grant_stripe` for a revenuecat member and the mobile case fails — that is the
// one that would quietly promise something the store will not honour; make `summarize` silent on
// an empty run and "a run that did nothing says so" fails, which is how this job disappears for
// a year.

import { describe, it, expect } from 'vitest';
import {
  decideAnniversary, summarize,
} from '../../../supabase/functions/_shared/og-anniversary';
import type { AnniversaryMember } from '../../../supabase/functions/_shared/og-anniversary';

const NOW = new Date('2027-09-03T12:00:00Z');
const DUE = '2027-09-03T00:00:00Z';

const member = (over: Partial<AnniversaryMember> = {}): AnniversaryMember => ({
  user_id: 'user-1',
  og_number: 1,
  claimed_provider: 'stripe',
  reward_due_at: DUE,
  reward_granted_at: null,
  reward_action_required_at: null,
  reward_declined_at: null,
  eligible: true,
  lapse_reason: null,
  ...over,
});

describe('decideAnniversary', () => {
  it('grants an eligible Stripe member', () => {
    const d = decideAnniversary(member(), NOW);
    expect(d.action).toBe('grant_stripe');
  });

  it('CANNOT GRANT TWICE — an already-granted member is skipped', () => {
    // The natural failure is a half-completed run that gets retried. This is the guard.
    const d = decideAnniversary(member({ reward_granted_at: '2027-09-03T00:00:01Z' }), NOW);
    expect(d.action).toBe('skip');
    expect(d.reason).toContain('already granted');
  });

  it('does not re-decline or re-ask someone already settled', () => {
    expect(decideAnniversary(member({ reward_declined_at: DUE }), NOW).action).toBe('skip');
    expect(decideAnniversary(member({ reward_action_required_at: DUE }), NOW).action).toBe('skip');
  });

  it('leaves a member alone before their date', () => {
    const d = decideAnniversary(member({ reward_due_at: '2028-01-01T00:00:00Z' }), NOW);
    expect(d.action).toBe('skip');
    expect(d.reason).toBe('not due yet');
  });

  it('declines the one case that forfeits, and RECORDS WHY', () => {
    const d = decideAnniversary(member({ eligible: false, lapse_reason: 'voluntary' }), NOW);
    expect(d.action).toBe('decline');
    // The reason has to be readable in a year, when the subscription history that
    // justified it no longer exists.
    expect(d.reason).toContain('voluntary');
  });

  it('a MOBILE member is an action owed, never a silent no-op', () => {
    const d = decideAnniversary(member({ claimed_provider: 'revenuecat' }), NOW);
    expect(d.action).toBe('needs_user_action');
    // Says why in words a human can act on: this is a fact about the stores, not a gap.
    expect(d.reason).toContain('only be cancelled by the user');
  });

  it('an ineligible mobile member still declines rather than being asked', () => {
    const d = decideAnniversary(member({ claimed_provider: 'revenuecat', eligible: false }), NOW);
    expect(d.action).toBe('decline');
  });
});

describe('summarize — the record that the run happened', () => {
  it('A RUN THAT DID NOTHING SAYS SO, in words', () => {
    // Silence here is how the backup task looked healthy for six days. This job would go
    // unnoticed for a year.
    const s = summarize([], []);
    expect(s.members_due).toBe(0);
    expect(s.notes).toContain('No members were due today');
    expect(s.notes).toContain('completed');
  });

  it('counts each outcome and names every member it acted on', () => {
    const s = summarize(
      [
        decideAnniversary(member({ user_id: 'a', og_number: 1 }), NOW),
        decideAnniversary(member({ user_id: 'b', og_number: 2, claimed_provider: 'revenuecat' }), NOW),
        decideAnniversary(member({ user_id: 'c', og_number: 3, eligible: false, lapse_reason: 'voluntary' }), NOW),
        decideAnniversary(member({ user_id: 'd', og_number: 4, reward_granted_at: DUE }), NOW),
      ],
      [],
    );
    expect(s.members_due).toBe(3);       // the skipped one is not "due"
    expect(s.granted).toBe(1);
    expect(s.action_required).toBe(1);
    expect(s.declined).toBe(1);
    expect(s.notes).toContain('#1 grant_stripe');
    expect(s.notes).toContain('#2 needs_user_action');
    expect(s.notes).toContain('#3 decline');
    expect(s.notes).not.toContain('#4');  // skips are not noise in the log
  });

  it('reports failures in full rather than swallowing them', () => {
    const s = summarize([], [{ user_id: 'user-9', error: 'stripe timeout' }]);
    expect(s.failed).toBe(1);
    expect(s.notes).toContain('FAILED user-9: stripe timeout');
  });
});
