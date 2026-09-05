-- push-send-daily — the caller the push stack never had.
--
-- ⚠️ THE END-TO-END GAP WAS NOT THE SECRETS. Checked 2026-09-05 before writing a line:
--   * All four names the code reads resolve in the project's function secrets, set that morning —
--     `APNS_AUTH_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `FCM_SERVICE_ACCOUNT_JSON` — plus
--     `CRON_SECRET`, which has been there since April.
--   * `push-send` is deployed and ACTIVE at version 7, `verify_jwt` false.
--   * `_shared/push-transport.ts` already retires dead tokens on both platforms (APNs 410 /
--     BadDeviceToken / Unregistered, FCM 404 / UNREGISTERED).
-- And **nothing in `cron.job` called it.** Ten scheduled jobs, not one targeting `push-send`.
-- The sender that is the only thing in this codebase able to reach a dormant user had no caller
-- at all — the same failure the repo's own gate was written for, one level down in the
-- infrastructure rather than in the TypeScript.
--
-- ══ THIS RUNS IN DRY RUN, AND THAT IS DELIBERATE, NOT A DRAFT ══════════════
-- `push-send` reads `dry_run` from the query string and treats ANYTHING except `dry_run=0` as a
-- dry run (`index.ts:106`). The URL below carries no such parameter, so this job selects the
-- audience, runs the decider and writes `push_send_runs` — and delivers nothing to anybody.
--
-- That is the honest state to ship today, because a real delivery cannot be proven yet and
-- pretending otherwise is what this repo keeps catching:
--   * `device_tokens` holds **7 android rows, all belonging to `reviewer@treforged.com`** — the
--     App Store reviewer login, registered between 08:58 and 09:01 that morning while the build
--     was being tested. Seven DISTINCT tokens from one account, which is a reinstalled test
--     device minting fresh FCM ids, not a duplicate-row bug: the table's unique index is on
--     `(platform, token)` and `push-store.ts` upserts on it. The first real send retires the six
--     dead ones by itself.
--   * There are **ZERO iOS tokens**, so APNs is unprovable today however correct the `.p8` is.
--     A present, well-named secret is not a signed request.
--   * There are **zero real end-user devices**, so nothing this job could send would reach a
--     customer even with dry run off.
--
-- ══ TURNING IT ON IS ONE DELIBERATE EDIT ═══════════════════════════════════
-- Append `?dry_run=0` to the url below and re-run this file. Do that when a real device is
-- registered and somebody is watching it, because from that moment this reaches people who did
-- not ask for it that day.
--
-- ⚠️ A 200 FROM THIS JOB IS NOT A DELIVERED NOTIFICATION. The transport's own header block says
-- it can report success and vanish. The evidence is a notification arriving on a device.
--
-- Undo, complete and immediate:  select cron.unschedule('push-send-daily');
--
-- 17:00 UTC is 13:00 Eastern — a defensible hour to be notified, and clear of
-- `unverified-nudge-daily` at 15:00 and `revenue-push-nightly` at 05:30.

select cron.unschedule('push-send-daily')
where exists (select 1 from cron.job where jobname = 'push-send-daily');

select cron.schedule(
  'push-send-daily',
  '0 17 * * *',
  $$
  select net.http_post(
    url     := 'https://mdtosrbfkextcaezuclh.supabase.co/functions/v1/push-send',
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'x-cron-secret',  (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'CRON_SECRET'
        limit 1
      )
    ),
    body    := '{}'::jsonb
  );
  $$
);
