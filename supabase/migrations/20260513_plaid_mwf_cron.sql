-- Change plaid-daily-sync from every day to Monday/Wednesday/Friday only.
-- Reduces unnecessary Plaid API calls while data is still fresh for users.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'plaid-daily-sync') then
    perform cron.unschedule('plaid-daily-sync');
  end if;
end $$;

select cron.schedule(
  'plaid-daily-sync',
  '0 13 * * 1,3,5',
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
