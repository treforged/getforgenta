/**
 * What the anniversary run decides, per member. PURE — no database, no Stripe,
 * no clock of its own.
 *
 * WHY THE DECISION IS SPLIT OUT AT ALL: this code path gets its first real
 * execution A YEAR after it is written, on a date nobody is watching, for a
 * promise made to the hundred people most invested in the product. If the only
 * way to exercise it is to wait for that date, it will be exercised for the
 * first time in production, once, and any mistake in it is a broken promise
 * rather than a bug. Every rule below is therefore executable today, from a
 * test, with a fabricated member and a fabricated date.
 *
 * The rules it encodes are in docs/og-cohort.md, in plain words. Where the two
 * disagree, this file is what actually runs and the doc is the bug.
 */

export type AnniversaryAction =
  /** Grant the free year on Stripe. The only case the job can complete alone. */
  | 'grant_stripe'
  /**
   * A mobile subscriber. The job CANNOT complete this one, and that is a fact
   * about Apple and Google rather than a gap in the code: only the user can
   * cancel an App Store or Play subscription, and only the user can enter card
   * details for Stripe. Silently doing nothing here would be the worst outcome —
   * a promise quietly unkept — so it is recorded as an action that is owed.
   */
  | 'needs_user_action'
  /** Eligibility failed. The reason is recorded at the time, not re-derived. */
  | 'decline'
  /** Already settled. The guard that makes a retried run safe. */
  | 'skip';

export interface AnniversaryMember {
  user_id: string;
  og_number: number;
  claimed_provider: string;
  reward_due_at: string;
  reward_granted_at: string | null;
  reward_action_required_at: string | null;
  reward_declined_at: string | null;
  /** From `og_reward_eligible(user_id, reward_due_at)` — evaluated in the DB. */
  eligible: boolean;
  lapse_reason: string | null;
}

export interface AnniversaryDecision {
  user_id: string;
  og_number: number;
  action: AnniversaryAction;
  reason: string;
}

/**
 * IDEMPOTENCY LIVES HERE. Granting a free year twice costs real money, and the
 * natural way to do it is a run that half-completes and gets retried. So an
 * already-settled member is `skip`, decided before anything else is considered.
 */
export function decideAnniversary(member: AnniversaryMember, now: Date): AnniversaryDecision {
  const base = { user_id: member.user_id, og_number: member.og_number };

  if (member.reward_granted_at !== null) {
    return { ...base, action: 'skip', reason: `already granted at ${member.reward_granted_at}` };
  }
  if (member.reward_declined_at !== null) {
    return { ...base, action: 'skip', reason: `already declined at ${member.reward_declined_at}` };
  }
  if (member.reward_action_required_at !== null) {
    // Already asked. Asking again every day for a year is how a reminder becomes
    // a reason to uninstall; re-prompting is a separate decision with its own cadence.
    return { ...base, action: 'skip', reason: `already flagged for user action at ${member.reward_action_required_at}` };
  }

  if (new Date(member.reward_due_at) > now) {
    return { ...base, action: 'skip', reason: 'not due yet' };
  }

  if (!member.eligible) {
    // The ONE case that forfeits: a deliberate cancellation that stayed cancelled.
    // Everything else — billing failure, unknown, inside the grace window —
    // resolves in the customer's favour and never reaches here.
    return {
      ...base,
      action: 'decline',
      reason: `not eligible at the anniversary (lapse_reason=${member.lapse_reason ?? 'none'})`,
    };
  }

  if (member.claimed_provider === 'stripe') {
    return { ...base, action: 'grant_stripe', reason: 'eligible, billed on Stripe' };
  }

  return {
    ...base,
    action: 'needs_user_action',
    reason: `eligible, but billed via ${member.claimed_provider}; a store subscription can only be cancelled by the user`,
  };
}

export interface RunSummary {
  members_due: number;
  granted: number;
  action_required: number;
  declined: number;
  failed: number;
  notes: string;
}

/**
 * The summary a human reads. It is written even when it is all zeros, because
 * a run that did nothing must be DISTINGUISHABLE from a run that did not happen.
 * That distinction is the whole reason `og_anniversary_runs` exists: the backup
 * task on this machine reported success for six days while doing nothing, and
 * this job would go unnoticed for a year.
 */
export function summarize(
  decisions: readonly AnniversaryDecision[],
  failures: readonly { user_id: string; error: string }[],
): RunSummary {
  const count = (action: AnniversaryAction) => decisions.filter(d => d.action === action).length;

  const granted = count('grant_stripe');
  const action_required = count('needs_user_action');
  const declined = count('decline');
  const members_due = granted + action_required + declined;

  const lines: string[] = [];
  lines.push(
    members_due === 0
      ? 'No members were due today. This run completed and found nothing to do.'
      : `${members_due} member(s) due: ${granted} granted, ${action_required} awaiting user action, ${declined} declined.`,
  );
  for (const d of decisions) {
    if (d.action === 'skip') continue;
    lines.push(`  #${d.og_number} ${d.action}: ${d.reason}`);
  }
  for (const f of failures) {
    lines.push(`  FAILED ${f.user_id}: ${f.error}`);
  }

  return {
    members_due,
    granted,
    action_required,
    declined,
    failed: failures.length,
    notes: lines.join('\n'),
  };
}
