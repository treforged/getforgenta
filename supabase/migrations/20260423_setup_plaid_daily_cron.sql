-- Daily Plaid sync via pg_cron + pg_net
--
-- ROOT CAUSE FIX: plaid-sync-all existed but was never scheduled.
-- This migration creates the cron job that calls it every day at 13:00 UTC
-- (8:00 AM EST / 9:00 AM EDT).
--
-- MANUAL STEPS REQUIRED before applying this migration:
--   1. Enable pg_cron in Supabase dashboard → Database → Extensions
--   2. Enable pg_net in Supabase dashboard → Database → Extensions
--   3. Set these Supabase secrets (dashboard → Edge Functions → Secrets):
--        CRON_SECRET = <any strong random string you choose>
--   4. Set these database config vars (dashboard → Database → Database Settings → Config):
--        app.supabase_url = https://<your-project-ref>.supabase.co
--        app.cron_secret  = <same value as CRON_SECRET above>
--   5. Apply via: supabase db push
--
-- To verify the job is registered after migration:
--   SELECT * FROM cron.job WHERE jobname = 'plaid-daily-sync';

-- Enable required extensions (idempotent — safe to run multiple times)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove any previously registered version of this job (idempotent)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'plaid-daily-sync') then
    perform cron.unschedule('plaid-daily-sync');
  end if;
end $$;

-- Schedule daily sync at 13:00 UTC every day
select cron.schedule(
  'plaid-daily-sync',
  '0 13 * * *',
  $$
  select net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/plaid-sync-all',
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'x-cron-secret',  current_setting('app.cron_secret')
    ),
    body    := '{}'::jsonb
  );
  $$
);
