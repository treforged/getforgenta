/**
 * og-consent-ask — sends the OG billing-consent email and issues its link.
 *
 * The "notify" in notify → explicit confirmation → act (docs/og-cohort.md). It
 * is a SEPARATE function from `og-anniversary` on purpose: that job decides and
 * settles, this one emails real people, and the day someone needs to stop the
 * emails without stopping the accounting they should not have to disentangle
 * the two.
 *
 * It reuses `decideAnniversary` rather than re-deriving who is owed. Two
 * implementations of "who needs asking" would disagree, and the disagreement
 * would surface as a founding member who never got the email — or one who got it
 * twice.
 *
 * ⚠️ DRY RUN IS THE DEFAULT, and it is checked at every write and every send.
 * The caller must pass `dry_run=0` out loud. This mails a hundred people about
 * their money and an email cannot be recalled — `FORGENTA_BACKUP_DRY_RUN` was
 * defined and never read, and a "rehearsal" deleted 17 folders. A safety flag
 * that lies is worse than no flag, so this one is read on every branch below.
 *
 * `?limit=N` sends to at most N people. The first real run should be N=1, to
 * Tre's own account, because the first genuine test of an email template is
 * always the first one somebody receives.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decideAnniversary } from "../_shared/og-anniversary.ts";
import type { AnniversaryMember, ConsentState } from "../_shared/og-anniversary.ts";
import { CURRENT_CONSENT, buildConsentRow } from "../_shared/og-consent-text.ts";
import {
  generateConsentToken, hashConsentToken, consentTokenExpiry,
} from "../_shared/og-consent-token.ts";
import { buildAskEmail, consentLink } from "../_shared/og-consent-email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const CONSENT_FROM = Deno.env.get("CONSENT_FROM") ?? "Forgenta <noreply@treforged.com>";
/** Where the consent PAGE lives. The functions host, never the app's origin. */
const FUNCTIONS_BASE = Deno.env.get("FUNCTIONS_BASE_URL") ?? `${SUPABASE_URL}/functions/v1`;

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected || secret !== expected) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") !== "0";
  // A MALFORMED LIMIT IS AN ERROR, NOT "NO LIMIT". `Number("abc")` is NaN and the
  // obvious `|| Infinity` fallback turns a typo in the one parameter that caps
  // the blast radius into "send to everybody". The safe reading of an unparseable
  // cap on an irreversible action is to refuse.
  const rawLimit = url.searchParams.get("limit");
  let limit = Infinity;
  if (rawLimit !== null) {
    const n = Number(rawLimit);
    if (!Number.isInteger(n) || n < 1) {
      return new Response(
        JSON.stringify({ error: `limit must be a positive whole number; got ${JSON.stringify(rawLimit)}` }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    limit = n;
  }
  const simulateDueBefore = url.searchParams.get("simulate_due_before");
  const now = new Date();
  const dueBefore = simulateDueBefore ? new Date(simulateDueBefore) : now;
  if (Number.isNaN(dueBefore.getTime())) {
    return new Response(JSON.stringify({ error: "simulate_due_before is not a date" }), { status: 400 });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const sent: number[] = [];
  const skipped: { og_number: number; why: string }[] = [];
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
      if (sent.length >= limit) break;

      const { data: eligible, error: eligErr } = await db.rpc("og_reward_eligible", {
        p_user_id: row.user_id, p_at: row.reward_due_at,
      });
      if (eligErr) {
        failures.push({ user_id: row.user_id, error: `eligibility check failed: ${eligErr.message}` });
        continue;
      }

      const { data: consentRows, error: consentErr } = await db.rpc("og_billing_consent_current", {
        p_user_id: row.user_id,
      });
      if (consentErr) {
        // A failed read is NOT an absent consent. Assuming "never asked" here
        // would email somebody who has already answered.
        failures.push({ user_id: row.user_id, error: `consent check failed: ${consentErr.message}` });
        continue;
      }
      const consent: ConsentState | null = Array.isArray(consentRows) && consentRows.length > 0
        ? consentRows[0] as ConsentState
        : null;

      const member = { ...row, eligible: eligible === true, consent } as AnniversaryMember;
      const decision = decideAnniversary(member, dueBefore);
      if (decision.action !== "needs_consent") {
        skipped.push({ og_number: row.og_number, why: decision.action });
        continue;
      }

      if (dryRun) {
        sent.push(row.og_number);
        continue;
      }

      try {
        await ask(db, row.user_id, now);
        sent.push(row.og_number);
      } catch (err) {
        failures.push({ user_id: row.user_id, error: String(err) });
      }
    }
  } catch (err) {
    failures.push({ user_id: "(run)", error: String(err) });
  }

  const body = {
    dry_run: dryRun,
    would_send: dryRun ? sent : undefined,
    sent_to_og_numbers: dryRun ? undefined : sent,
    sent_count: sent.length,
    skipped,
    failures,
  };
  return new Response(JSON.stringify(body, null, 2), {
    status: failures.length > 0 ? 500 : 200,
    headers: { "Content-Type": "application/json" },
  });
});

/**
 * Issue a link, send the email, then record that we asked. THE ORDER IS THE
 * DESIGN and each step is the least-bad failure of the one before it:
 *
 *  1. Retire any outstanding link first. `og_consent_tokens_one_live` allows one
 *     unused token per person, so a resend must spend the old one — and two live
 *     credentials for the same decision is one more than anybody needs.
 *  2. Issue the new link. Harmless on its own: a token nobody has been sent.
 *  3. SEND. If this fails we stop, having written no `asked` row — so the next
 *     run tries again rather than recording an ask that never left the building.
 *  4. Record the ask. If THIS fails we have emailed and not recorded it, which is
 *     the least-bad end state: the link still works, their answer still writes a
 *     `confirmed` row, and the run reports the failure loudly. The alternative —
 *     recording first — would leave a row claiming we asked somebody we did not,
 *     and the unique index would then block the retry that would have fixed it.
 */
async function ask(
  db: ReturnType<typeof createClient>,
  userId: string,
  now: Date,
): Promise<void> {
  const { data: user, error: userErr } = await db.auth.admin.getUserById(userId);
  if (userErr) throw new Error(`could not read the user: ${userErr.message}`);
  const email = user?.user?.email;
  if (!email) throw new Error("no email address on the account");

  const { error: retireErr } = await db
    .from("og_consent_tokens")
    .update({ used_at: now.toISOString() })
    .eq("user_id", userId)
    .is("used_at", null);
  if (retireErr) throw new Error(`could not retire the previous link: ${retireErr.message}`);

  const raw = generateConsentToken();
  const { error: tokErr } = await db.from("og_consent_tokens").insert({
    user_id: userId,
    token_sha256: await hashConsentToken(raw),
    consent_version: CURRENT_CONSENT.version,
    expires_at: consentTokenExpiry(now).toISOString(),
  });
  if (tokErr) throw new Error(`could not issue the link: ${tokErr.message}`);

  const mail = buildAskEmail(CURRENT_CONSENT, consentLink(FUNCTIONS_BASE, raw));
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: CONSENT_FROM, to: [email],
      subject: mail.subject, html: mail.html, text: mail.text,
    }),
  });
  if (!res.ok) throw new Error(`resend refused the send: ${res.status}`);

  const row = await buildConsentRow(userId, "asked", CURRENT_CONSENT, "email");
  const { error: askErr } = await db.from("og_billing_consent").insert(row);
  if (askErr) {
    // Emailed but not recorded. Loud rather than swallowed: their link works and
    // their answer will still be recorded, but "we asked and heard nothing" is
    // now missing from the record until somebody notices this line.
    throw new Error(`EMAIL SENT BUT THE ASK WAS NOT RECORDED: ${askErr.message}`);
  }
}
