/**
 * og-anniversary
 *
 * Runs daily. Finds OG members whose free year has come due, and settles each
 * one — or records, in a column, exactly why it could not.
 *
 * Secured by CRON_SECRET, like plaid-sync-all. No user JWT; there is no user
 * path into this at all.
 *
 * THREE PROPERTIES THIS JOB IS BUILT AROUND, each one a lesson this repo paid
 * for on 2026-09-02:
 *
 * 1. IT FAILS LOUDLY. Every run writes a row to `og_anniversary_runs`, INCLUDING
 *    a run that found nothing — "No members were due today" is a positive
 *    statement, not silence. The backup task on this machine reported success
 *    for six days while doing nothing, and nobody could tell. This job would go
 *    unnoticed for a YEAR.
 *
 * 2. IT CAN BE EXERCISED BEFORE THE REAL DATE. `?simulate_due_before=<iso>`
 *    pretends the anniversary has arrived, and `?dry_run=1` (the DEFAULT) walks
 *    the entire path and writes nothing but the run row. The first genuine
 *    anniversary is a year out; without this, the code would be executed for the
 *    first time in production, once, by which time nobody remembers writing it.
 *    ⚠️ `dry_run` here is honoured at every write — checked, not merely declared.
 *    `FORGENTA_BACKUP_DRY_RUN` was defined and never read, and a "rehearsal"
 *    uploaded to Drive and deleted 17 folders. A safety flag that lies is worse
 *    than no flag.
 *
 * 3. IT IS SAFE TO RE-RUN. Granting a free year twice costs real money, and a
 *    half-completed run that gets retried is exactly how that happens. Every
 *    member already granted, declined or flagged is `skip`ped by
 *    `decideAnniversary`, and the grant is written under a conditional update
 *    that only matches a row still unsettled.
 *
 * ⚠️ WHAT THIS JOB CANNOT DO, and it is a fact about the stores rather than a
 * TODO: a member who subscribed on mobile cannot be moved to Stripe billing by
 * us. Only they can cancel an App Store or Play subscription, and only they can
 * enter card details. So their outcome is `needs_user_action`, recorded with a
 * timestamp — never a silent no-op. See docs/og-cohort.md.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decideAnniversary, summarize } from "../_shared/og-anniversary.ts";
import type { AnniversaryDecision, AnniversaryMember, ConsentState } from "../_shared/og-anniversary.ts";

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected || secret !== expected) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }

  const url = new URL(req.url);
  // DRY RUN IS THE DEFAULT. A job that grants money should require the caller to
  // say so out loud; the cron schedule passes `dry_run=0` explicitly.
  const dryRun = url.searchParams.get("dry_run") !== "0";
  const simulateDueBefore = url.searchParams.get("simulate_due_before");
  const now = new Date();
  const dueBefore = simulateDueBefore ? new Date(simulateDueBefore) : now;

  if (Number.isNaN(dueBefore.getTime())) {
    return new Response(JSON.stringify({ error: "simulate_due_before is not a date" }), { status: 400 });
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const decisions: AnniversaryDecision[] = [];
  const failures: { user_id: string; error: string }[] = [];

  try {
    const { data: rows, error } = await db
      .from("og_members")
      .select("user_id, og_number, claimed_provider, reward_due_at, reward_granted_at, reward_action_required_at, reward_declined_at, lapse_reason")
      .lte("reward_due_at", dueBefore.toISOString())
      .is("reward_granted_at", null)
      .order("og_number");
    if (error) throw new Error(`could not read og_members: ${error.message}`);

    for (const row of rows ?? []) {
      // Eligibility is decided by the DATABASE function, not re-implemented here.
      // Two implementations of "who keeps the free year" would disagree, and the
      // disagreement would surface a year from now as a person who was told no.
      const { data: eligible, error: eligErr } = await db.rpc("og_reward_eligible", {
        p_user_id: row.user_id,
        p_at: row.reward_due_at,
      });
      if (eligErr) {
        failures.push({ user_id: row.user_id, error: `eligibility check failed: ${eligErr.message}` });
        continue;
      }

      // WHO HAS AGREED. Read from the database, never inferred and never assumed:
      // docs/og-cohort.md — "nothing grants without a confirmed row". A FAILED
      // READ IS NOT AN ABSENT CONSENT. Treating an error as "no row" would make
      // a transient database blip look exactly like a person who was never
      // asked, which is the safe direction for granting but the WRONG direction
      // for reporting: it would put someone who already confirmed back on the
      // "needs the ask sent" list and email them again. So a failed read is a
      // failure, and this member is skipped this run.
      const { data: consentRows, error: consentErr } = await db.rpc("og_billing_consent_current", {
        p_user_id: row.user_id,
      });
      if (consentErr) {
        failures.push({ user_id: row.user_id, error: `consent check failed: ${consentErr.message}` });
        continue;
      }
      // The function returns a set; no row means never asked, which is a real
      // and distinct state rather than a missing value.
      const consent: ConsentState | null = Array.isArray(consentRows) && consentRows.length > 0
        ? consentRows[0] as ConsentState
        : null;

      const member: AnniversaryMember = { ...row, eligible: eligible === true, consent } as AnniversaryMember;
      const decision = decideAnniversary(member, dueBefore);
      decisions.push(decision);

      // `outstanding` is REPORT-ONLY: the member has already been asked and the
      // row already says so, so there is nothing to write — but they are counted
      // and named in the summary every run, because an obligation that stops
      // being mentioned is an obligation that stops being kept.
      //
      // `needs_consent` is REPORT-ONLY TOO, and deliberately so. Sending the ask
      // means emailing a real person about their billing, and the surface that
      // does it is not built yet. Writing `reward_action_required_at` here
      // instead would record that we asked somebody we have not asked — the same
      // class of lie as a `reward_granted_at` written by code that granted
      // nothing. So they stay in the summary, named and counted, until the ask
      // exists. See docs/og-cohort.md.
      if (
        dryRun
        || decision.action === "skip"
        || decision.action === "outstanding"
        || decision.action === "needs_consent"
      ) continue;

      try {
        await settle(db, decision, now);
      } catch (err) {
        failures.push({ user_id: row.user_id, error: String(err) });
      }
    }
  } catch (err) {
    failures.push({ user_id: "(run)", error: String(err) });
  }

  const summary = summarize(decisions, failures);

  // THE RUN ROW IS WRITTEN EVEN ON A DRY RUN AND EVEN ON ZERO WORK. A run that
  // did nothing must be distinguishable from a run that never happened.
  const { error: runErr } = await db.from("og_anniversary_runs").insert({
    dry_run: dryRun,
    simulated_due_before: simulateDueBefore ?? null,
    members_due: summary.members_due,
    granted: summary.granted,
    action_required: summary.action_required,
    declined: summary.declined,
    outstanding: summary.outstanding,
    consent_required: summary.consent_required,
    failed: summary.failed,
    notes: summary.notes,
  });
  if (runErr) console.error("og-anniversary: could not write the run row:", runErr.message);

  // Non-200 on any failure, so a monitor sees red rather than a body it has to parse.
  return new Response(JSON.stringify({ dry_run: dryRun, ...summary }, null, 2), {
    status: summary.failed > 0 ? 500 : 200,
    headers: { "Content-Type": "application/json" },
  });
});

/**
 * Apply one decision. Every write is CONDITIONAL on the row still being
 * unsettled, so a retry cannot grant twice even if two runs overlap.
 */
async function settle(
  db: ReturnType<typeof createClient>,
  decision: AnniversaryDecision,
  now: Date,
): Promise<void> {
  const stamp = now.toISOString();

  if (decision.action === "grant_stripe") {
    // ⚠️ NOT YET WIRED TO STRIPE, and deliberately not faked. Applying the free
    // year means creating a 12-month 100% discount against a live subscription
    // in Tre's Stripe account — a real action on a payment provider, which is
    // his call to authorise rather than something to switch on quietly here.
    // Until it is, the member is flagged as needing action rather than marked
    // granted: a `reward_granted_at` written by code that granted nothing is the
    // exact class of lie this whole job is built to avoid.
    const { error } = await db
      .from("og_members")
      .update({ reward_action_required_at: stamp })
      .eq("user_id", decision.user_id)
      .is("reward_granted_at", null)
      .is("reward_action_required_at", null);
    if (error) throw new Error(error.message);
    return;
  }

  if (decision.action === "needs_user_action") {
    const { error } = await db
      .from("og_members")
      .update({ reward_action_required_at: stamp })
      .eq("user_id", decision.user_id)
      .is("reward_granted_at", null)
      .is("reward_action_required_at", null);
    if (error) throw new Error(error.message);
    return;
  }

  if (decision.action === "decline") {
    const { error } = await db
      .from("og_members")
      .update({ reward_declined_at: stamp, reward_declined_reason: decision.reason })
      .eq("user_id", decision.user_id)
      .is("reward_granted_at", null)
      .is("reward_declined_at", null);
    if (error) throw new Error(error.message);
  }
}
