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
  /**
   * Asked, still owed. Both halves of the mobile flow are performed by the user
   * and we see only the first, so an outstanding obligation stays counted and
   * named on every run until it is settled.
   */
  | 'outstanding'
  /**
   * Eligible and due, but NOBODY HAS AGREED YET. The ask has not gone out, or
   * it went out and no answer came back.
   *
   * Tre, 2026-09-03: *"id want it to notify the user that their subscribtion
   * would be moved to stripe and require a confirmation. it would need to be
   * tracked for legal reason."* So the order is notify → explicit confirmation
   * → act, and this outcome is the "not yet" in the middle. It is NOT a
   * failure and NOT a decline: it is an obligation that has reached the point
   * where somebody has to be asked. `docs/og-cohort.md`: **nothing grants
   * without a confirmed row.**
   */
  | 'needs_consent'
  /** Already settled. The guard that makes a retried run safe. */
  | 'skip';

/** The latest row from `og_billing_consent_current(user_id)`; null = never asked. */
export interface ConsentState {
  decision: 'asked' | 'confirmed' | 'declined';
  decided_at: string;
  consent_version: string;
}

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
  /**
   * From `og_billing_consent_current(user_id)`. `null` means never asked, which
   * is a DIFFERENT fact from asked-and-no-answer and must stay distinguishable.
   */
  consent: ConsentState | null;
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
    // Asked, but NOT SETTLED. Deliberately its own outcome rather than a `skip`:
    // the ask has two halves the user performs (start the free year, then cancel
    // the store subscription) and we only ever see the first. Someone who does
    // half of it — or neither — is still owed, and a `skip` would make them
    // vanish from every run summary from then on. Silently dropping an
    // outstanding obligation is the failure this whole job is built against.
    //
    // It is NOT re-asked here. Asking again every day for a year is how a
    // reminder becomes a reason to uninstall; re-prompting is a separate
    // decision with its own cadence. This outcome exists to keep them VISIBLE.
    return { ...base, action: 'outstanding', reason: `asked at ${member.reward_action_required_at}, not yet confirmed on both sides` };
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

  // ── THE CONSENT GATE ───────────────────────────────────────────────────────
  // It sits HERE, after eligibility and before anything that could act, because
  // it gates BOTH outcomes below it. A Stripe-native member gets no carve-out:
  // docs/og-cohort.md says "nothing grants without a confirmed row" with no
  // exception, and the version they confirmed is what the record has to name.
  //
  // WHY IT IS A GATE AND NOT A CHECK AT THE WRITE SITE: `settle()` already
  // refuses to stamp `reward_granted_at` for a grant it did not perform, but a
  // guard that only exists at the last line is a guard one refactor away from
  // being skipped. Deciding it here makes "who has agreed" visible in the run
  // summary a year before anyone presses anything.
  if (member.consent?.decision === 'declined') {
    // NOT a forfeit and not a lapse — they read the ask and said no, which the
    // consent copy explicitly offers ("your subscription stays exactly as it
    // is"). Recorded as declined so the obligation is closed rather than
    // pending forever, and the reason names the consent so a later reader is
    // not left guessing which kind of "declined" this was.
    return {
      ...base,
      action: 'decline',
      reason: `declined the move to Stripe billing on ${member.consent.decided_at} (${member.consent.consent_version})`,
    };
  }

  if (member.consent?.decision === 'asked') {
    // Asked and no answer. Same bucket as the half-done mobile flow, on purpose:
    // both are "still owed, already asked, do not ask again today".
    return {
      ...base,
      action: 'outstanding',
      reason: `asked for billing consent on ${member.consent.decided_at} (${member.consent.consent_version}), no answer yet`,
    };
  }

  if (member.consent === null) {
    return {
      ...base,
      action: 'needs_consent',
      reason: 'eligible and due, but has never been asked to consent to the move to Stripe billing',
    };
  }

  if (member.claimed_provider === 'stripe') {
    return {
      ...base,
      action: 'grant_stripe',
      reason: `eligible, billed on Stripe, consented ${member.consent.decided_at} (${member.consent.consent_version})`,
    };
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
  /** Asked on an earlier run and still not settled. Never allowed to reach zero by neglect. */
  outstanding: number;
  /** Due, eligible, and nobody has asked them yet. The email that has to go out. */
  consent_required: number;
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
  const outstanding = count('outstanding');
  const consent_required = count('needs_consent');
  // `consent_required` counts toward members_due: they ARE due, and leaving them
  // out would let a run report "0 members were due today" on a day a hundred
  // people became owed a free year nobody had asked yet.
  const members_due = granted + action_required + declined + consent_required;

  const lines: string[] = [];
  lines.push(
    members_due === 0
      ? 'No members were due today. This run completed and found nothing to do.'
      : `${members_due} member(s) due: ${granted} granted, ${action_required} awaiting user action, ${declined} declined, ${consent_required} awaiting the consent ask.`,
  );
  // Named separately and unmissably: until the ask goes out, these people are
  // owed a free year and nothing in the system is trying to give it to them.
  if (consent_required > 0) {
    lines.push(`${consent_required} member(s) NEED THE CONSENT ASK SENT — nothing grants without a confirmed row.`);
  }
  // Reported on EVERY run, including one with nothing new due. An obligation
  // that stops being mentioned is an obligation that stops being kept.
  if (outstanding > 0) {
    lines.push(`${outstanding} member(s) STILL OWED — asked previously, not yet confirmed on both sides.`);
  }
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
    outstanding,
    consent_required,
    failed: failures.length,
    notes: lines.join('\n'),
  };
}
