-- plaid-daily-sync: let pg_net wait 60 s for plaid-sync-all (Sam, 2026-10-07, db1d6813 follow-up).
-- pg_net's default 5 s gave up before the ~38 s sync answered, so net._http_response showed a
-- timeout (status_code null) on a run whose function log read POST 200. The sync itself always ran;
-- only the recorded answer was missing. Undo: re-run without timeout_milliseconds.
select cron.alter_job(
  job_id  := (select jobid from cron.job where jobname = 'plaid-daily-sync'),
  command := $cmd$
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
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cmd$
);
