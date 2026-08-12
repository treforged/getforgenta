-- Restore plaid-daily-sync to running EVERY day.
--
-- WHY: the job named "plaid-daily-sync" had not been daily since 2026-05-13.
-- The lineage, from this migrations folder:
--   20260423_setup_plaid_daily_cron.sql  '0 13 * * *'        every day (original intent)
--   20260424_fix_plaid_cron_secret.sql   '0 13 * * *'        every day (vault secret fix)
--   20260513_plaid_mwf_cron.sql          '0 13 * * 1,3,5'    Mon/Wed/Fri  <- drift starts
--   20260529_plaid_mwfs_cron.sql         '0 13 * * 1,3,5,6'  + Saturday
-- Live `cron.job` confirmed the last of these was still in force: 4 runs a week,
-- never a Tue/Thu/Sun. The job NAME and the plaid-sync-all docstring both still
-- said "daily", which is how the drift stayed invisible.
--
-- Tre asked for daily back (2026-08-11). This reverses the 05-13 cost decision
-- ("reduces unnecessary Plaid API calls") deliberately: fresher balances are
-- worth more than the saved calls, and the volume is bounded anyway --
-- `_shared/sync-handler.ts` carries SYNC_COOLDOWN_MS = 23.5h, which skips any
-- connection synced under 23.5 hours ago. That constant is sized just under 24h
-- SPECIFICALLY so a once-a-day cron passes it, so daily is the cadence the
-- handler was already built for, and it cannot produce more than one provider
-- call per connection per day even if the job is triggered more often.
--
-- Time is unchanged at 13:00 UTC (9:00 AM EDT / 8:00 AM EST), so the only
-- difference is that Tue, Thu and Sun stop being skipped.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'plaid-daily-sync') then
    perform cron.unschedule('plaid-daily-sync');
  end if;
end $$;

select cron.schedule(
  'plaid-daily-sync',
  '0 13 * * *',
  $$
  select net.http_post(
    url     := 'https://mdtosrbfkextcaezuclh.supabase.co/functions/v1/plaid-sync-all',
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
