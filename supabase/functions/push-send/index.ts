/**
 * push-send — the only thing in this codebase that can reach a DORMANT user.
 *
 * Every notification the app shipped before this was a LOCAL one: scheduled ON the device BY
 * the app, so it only ever fires for someone who has already opened it. Measured 2026-09-05:
 * 31 accounts, 2 active in seven days, 23 dormant beyond thirty days. A local notification
 * cannot reach one of those 23 people. This can.
 *
 * ══ ⚠️ THIS SENDS TWO OF THE SEVEN NOTIFICATION KINDS. READ THIS BEFORE ASSUMING OTHERWISE. ══
 *
 * SENDS:        learn_lesson, streak_risk
 * DOES NOT SEND: bill_due, low_cash, next_month_short, milestone, sync_stale
 *
 * Not an oversight and not a first cut to be quietly finished later. `decideNotification` is
 * transport-agnostic and is called here AS-IS — but its SIGNALS are not equally available to a
 * server. `upcomingBills`, `projectedCashAtNextBill`, `cashFloor`, `nextMonthProjectedEndingCash`
 * and `newMilestones` all come from the FORECAST ENGINE, which is client TypeScript that has
 * never run on a server. The five kinds above depend entirely on those, so this function passes
 * them as empty/null and the decider correctly declines to raise them.
 *
 * The two it does send are the two that derive from data the server already holds — the
 * `achievements` table plus the bundled lesson list — and they are also exactly what was asked
 * for: a weekly learning nudge and a streak. **Porting the engine's signals server-side is its
 * own project.** Until that happens, a bill alert does NOT reach a dormant user, and anyone
 * planning on top of this needs to know that from the code rather than from a surprise.
 *
 * ══ THE SHAPE, copied from og-anniversary/index.ts ══
 *
 *  - `x-cron-secret` only. No user JWT, no user-facing way in.
 *  - **DRY RUN DEFAULT TRUE.** A sender that ships defaulting to "actually send" is one
 *    accidental invocation away from messaging every user on the system. Sending is the opt-in.
 *  - Every invocation writes a run row, INCLUDING a zero-work one. A job that only records
 *    itself when it does something has silence that cannot be read: "decided nobody needed
 *    anything" and "never fired" look identical.
 *  - Non-200 when `failed > 0`, so a monitor has something to alert on.
 *  - Idempotency by CONDITIONAL WRITE, not by a check-then-act: the unique index on
 *    `push_sends (user_id, notification_key)` is what makes a double send impossible rather
 *    than unlikely. Two overlapping runs both insert; exactly one wins.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  decideNotification,
  type NotificationSignals, type NotificationRecord, type NotificationGate, type NotificationKind,
} from "../_shared/notification-policy.ts";
import { computeStreakInZone, hasReadTodayInZone, hourInZone, safeZone } from "../_shared/learn-streak.ts";
import { LEARN_LESSONS } from "../_shared/learn-lessons.ts";
import { checkDevice, sendToDevice, tokenTail, type DeviceRow } from "../_shared/push-transport.ts";

/** Same namespace the client writes and the RLS policy allows: `lesson:<slug>`. */
const LESSON_PREFIX = "lesson:";

/**
 * The five kinds this sender CANNOT compute, forced off in the gate.
 *
 * ⚠️ THIS IS THE GUARD, not the empty signal arrays. Relying on `upcomingBills: []` to keep
 * `bill_due` quiet works only for as long as nobody adds a candidate that fires on something
 * else, and it would fail silently the moment they did. Declaring them OFF says the true thing
 * -- this runtime has no forecast engine, so it is not entitled to an opinion about money -- and
 * keeps saying it however the policy grows.
 */
const SERVER_CANNOT_SEND: readonly NotificationKind[] = [
  "bill_due", "floor_risk", "milestone", "weekly_checkin", "stale_accounts",
];

/**
 * The user's own switch, with the five above forced off on top of it.
 *
 * The user's answer is honoured FIRST and is never widened: a category they silenced stays
 * silenced. This only ever removes kinds.
 */
function buildGate(storedPrefs: unknown): NotificationGate {
  const prefs = (storedPrefs ?? {}) as { enabled?: unknown; categories?: Record<string, unknown> };
  const categories: Partial<Record<NotificationKind, boolean>> = {};
  for (const [kind, allowed] of Object.entries(prefs.categories ?? {})) {
    if (typeof allowed === "boolean") categories[kind as NotificationKind] = allowed;
  }
  for (const kind of SERVER_CANNOT_SEND) categories[kind] = false;
  // Not-chosen reads as ON, the same as notification-prefs.ts. Only an explicit false is a no.
  return { enabled: prefs.enabled !== false, categories };
}

interface RunTotals {
  candidates: number;
  sent: number;
  duplicate: number;
  unreachable: number;
  failed: number;
}

Deno.serve(async (req) => {
  const secret = req.headers.get("x-cron-secret");
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected || secret !== expected) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const url = new URL(req.url);
  // ⚠️ Opt IN to sending. Anything other than an explicit "0" is a dry run, so a typo, an empty
  // value or a forgotten parameter all fail in the safe direction.
  const dryRun = url.searchParams.get("dry_run") !== "0";
  // ⚠️ `?check=1` — PROVE THE CREDENTIALS WITHOUT SENDING ANYTHING.
  //
  // A dry run skips the transport entirely, so it says nothing about whether the APNs and FCM
  // credentials actually work; it only proves the decider ran. That gap is exactly where this
  // stack has hidden its failures. This mode calls FCM with `validate_only`, which authenticates,
  // validates the token and the payload, and delivers NOTHING — so the whole chain up to the
  // final handset is exercised on demand, with no notification reaching a person.
  //
  // It is NOT proof of delivery and the response says so in its own words, because a check that
  // gets quoted as "push works" would be worse than no check at all.
  const checkOnly = url.searchParams.get("check") === "1";
  // Present when a run is aimed at one person, which is how this gets exercised on a real device
  // before it is ever pointed at everybody.
  const scopedUserId = url.searchParams.get("user_id");

  const totals: RunTotals = { candidates: 0, sent: 0, duplicate: 0, unreachable: 0, failed: 0 };
  const notes: string[] = [];
  const now = new Date();

  // ── ?check=1 ───────────────────────────────────────────────────────────────
  // Returns early and writes nothing: no `push_sends`, no `push_send_runs`. It is a question
  // about the credentials, not a run, and recording it as a run would corrupt the counts the
  // rest of this file exists to produce.
  if (checkOnly) {
    const { data: devices } = await db
      .from("device_tokens")
      .select("id, platform, token, environment")
      .is("revoked_at", null);

    const rows = (devices ?? []) as DeviceRow[];
    const results: { platform: string; token: string; ok: boolean; reason?: string }[] = [];
    for (const device of rows) {
      const outcome = await checkDevice(device, {
        title: "Forgenta",
        body: "Credential check — not delivered.",
        key: "credential_check",
      });
      results.push({
        platform: device.platform,
        token: tokenTail(device.token),
        ok: outcome.ok,
        reason: outcome.ok ? undefined : outcome.reason,
      });
    }

    const android = results.filter((r) => r.platform === "android");
    return new Response(
      JSON.stringify({
        mode: "check",
        delivered: 0,
        // Said in the response itself, because a check that gets quoted as "push works" is worse
        // than no check at all.
        proves: "FCM credentials, project resolution, token validity and payload shape.",
        does_not_prove:
          "That any notification ARRIVES on a handset, and nothing at all about APNs — FCM's " +
          "validate_only has no APNs equivalent, so the iOS key is only testable by a real send " +
          "to a real iOS token, and there are none.",
        android_checked: android.length,
        android_ok: android.filter((r) => r.ok).length,
        ios_tokens_on_system: results.filter((r) => r.platform === "ios").length,
        results,
      }, null, 2),
      { headers: { "content-type": "application/json" } },
    );
  }

  try {
    // Only people who could actually receive something. A user with no live token is not a
    // candidate, and counting them would make `unreachable` mean two different things.
    let profileQuery = db.from("profiles").select("user_id, timezone, notification_prefs");
    if (scopedUserId) profileQuery = profileQuery.eq("user_id", scopedUserId);
    const { data: profiles, error: profileErr } = await profileQuery;
    if (profileErr) throw new Error(`profiles read failed: ${profileErr.message}`);

    for (const profile of profiles ?? []) {
      const userId = profile.user_id as string;
      try {
        const zone = safeZone(profile.timezone as string | null);

        // ── The two signals a server can actually compute ────────────────────
        const { data: readRows, error: readErr } = await db
          .from("achievements")
          .select("achievement_id, earned_at")
          .eq("user_id", userId)
          .like("achievement_id", `${LESSON_PREFIX}%`);
        if (readErr) throw new Error(`achievements read failed: ${readErr.message}`);

        const readTimestamps = (readRows ?? []).map(r => r.earned_at as string).filter(Boolean);
        const readSlugs = new Set(
          (readRows ?? []).map(r => (r.achievement_id as string).slice(LESSON_PREFIX.length)),
        );
        const nextLesson = LEARN_LESSONS.find(l => !readSlugs.has(l.id)) ?? null;

        // ⚠️ EVERY FORECAST-DERIVED SIGNAL IS INERT, AND THE GATE IS WHAT ENFORCES IT. These
        // come from an engine that does not run here. The numbers below are chosen so that no
        // comparison against them can ever be true -- cash "infinitely above" a floor of zero --
        // rather than plausible-looking zeros, because `projectedCashAtNextBill: 0` against any
        // floor reads as "you are broke" and would fire a low-cash alarm at every user alive.
        const signals: NotificationSignals = {
          now,
          upcomingBills: [],
          projectedCashAtNextBill: Number.POSITIVE_INFINITY,
          cashFloor: 0,
          nextMonthProjectedEndingCash: null,
          nextMonthFloor: null,
          newMilestones: [],
          lastAccountSyncAt: null,
          netWorth: null,
          monthEndCash: null,
          nextLesson: nextLesson
            ? { id: nextLesson.id, title: nextLesson.title, minutes: nextLesson.minutes }
            : null,
          learnStreak: computeStreakInZone(readTimestamps, now, zone),
          learnedToday: hasReadTodayInZone(readTimestamps, now, zone),
          // Quiet hours and STREAK_RISK_HOUR must be the USER's hour. Without this the policy
          // reads the runtime's clock, which here is UTC: "your streak ends tonight" at 2pm in
          // New York, and quiet hours starting at 4pm.
          localHour: hourInZone(now, zone),
        };

        // History feeds the weekly cap, the spacing rule and the per-kind caps, all of which
        // live in the policy. The sender does not second-guess any of them.
        const { data: history } = await db
          .from("push_sends")
          .select("notification_key, kind, sent_at")
          .eq("user_id", userId)
          .order("sent_at", { ascending: false })
          .limit(50);
        const records: NotificationRecord[] = (history ?? []).map(h => ({
          key: h.notification_key as string,
          kind: h.kind as NotificationRecord["kind"],
          sentAt: h.sent_at as string,
        }));

        const decision = decideNotification(signals, records, buildGate(profile.notification_prefs));
        if (!decision) continue;
        totals.candidates += 1;

        const { data: tokens } = await db
          .from("device_tokens")
          .select("id, platform, token, environment")
          .eq("user_id", userId)
          .is("revoked_at", null);
        if (!tokens || tokens.length === 0) {
          // Nothing went wrong. We simply cannot reach them — and this is the number that says
          // whether registration is working at all, which is why it is not folded into `failed`.
          totals.unreachable += 1;
          continue;
        }

        if (dryRun) continue;

        // THE IDEMPOTENCY GATE. Insert first, send second. A conflict means another run already
        // owns this key, so this one stops — the opposite order would send and then discover the
        // duplicate, which is exactly one notification too late.
        const { error: claimErr } = await db.from("push_sends").insert({
          user_id: userId,
          notification_key: decision.key,
          kind: decision.kind,
          devices_sent: tokens.length,
        });
        if (claimErr) {
          // 23505 is the unique violation, which is the expected, correct outcome of a race.
          if ((claimErr as { code?: string }).code === "23505") totals.duplicate += 1;
          else throw new Error(`push_sends insert failed: ${claimErr.message}`);
          continue;
        }

        // ── DELIVERY ────────────────────────────────────────────────────────
        //
        // ⚠️ THE CLAIM ROW IS ALREADY WRITTEN, so a device that fails here is NOT retried on the
        // next run. That is deliberate: the alternative is re-deciding a notification the user
        // may already have received on their other device, and a duplicate is worse than a miss.
        // The failure is recorded instead, which is what the run row is for.
        let delivered = 0;
        const failures: string[] = [];
        const retireIds: string[] = [];

        for (const device of tokens as DeviceRow[]) {
          const outcome = await sendToDevice(device, {
            title: decision.title, body: decision.body, key: decision.key,
          });
          if (outcome.ok) { delivered += 1; continue; }
          failures.push(outcome.reason);
          // A provider saying the device is gone is not an error to retry — it is a fact about
          // the row. Retire it so it stops being counted as reachable.
          if (outcome.retire) retireIds.push(device.id);
        }

        if (retireIds.length > 0) {
          await db.from("device_tokens")
            .update({ revoked_at: new Date().toISOString() })
            .in("id", retireIds);
        }

        // The claim recorded an optimistic device count. Correct it to what actually landed, so
        // push_sends is a record of delivery rather than of intent.
        if (delivered !== tokens.length) {
          await db.from("push_sends")
            .update({ devices_sent: delivered })
            .eq("user_id", userId).eq("notification_key", decision.key);
        }

        // ⚠️ NO DEVICE TOOK IT IS A FAILURE, NOT A SEND. A sender that reports "sent" while
        // nothing arrived is the green check this codebase refuses everywhere else.
        if (delivered === 0) {
          throw new Error(
            `no device accepted the push (${tokens.length} tried): ${failures.join("; ")}`,
          );
        }
        totals.sent += 1;
        if (failures.length > 0) {
          // Partial delivery: it reached them, but a device is unwell and that is worth reading.
          notes.push(`${userId}: delivered to ${delivered}/${tokens.length} — ${failures.join("; ")}`);
        }
      } catch (userErr) {
        totals.failed += 1;
        notes.push(`${userId}: ${userErr instanceof Error ? userErr.message : String(userErr)}`);
      }
    }
  } catch (runErr) {
    totals.failed += 1;
    notes.push(`run: ${runErr instanceof Error ? runErr.message : String(runErr)}`);
  }

  // Always, including a run that did nothing. Silence that cannot be read is not a report.
  await db.from("push_send_runs").insert({
    dry_run: dryRun,
    scoped_user_id: scopedUserId,
    ...totals,
    notes: notes.length > 0 ? notes.join("\n") : null,
  });

  return new Response(
    JSON.stringify({ dry_run: dryRun, scoped_user_id: scopedUserId, ...totals, notes }, null, 2),
    {
      // Non-200 on any failure so a monitor has something to alert on. A job that always
      // answers 200 is a job nobody finds out has stopped working.
      status: totals.failed > 0 ? 500 : 200,
      headers: { "Content-Type": "application/json" },
    },
  );
});
