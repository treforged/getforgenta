-- push-send-daily: let pg_net wait 60 s for push-send, same fix as 20261007b (plaid-daily-sync).
-- 10-07 run 9464: net._http_response 47 timed out at the default 5 s while the function log read
-- POST 200 at 17:00:19Z (19 s). Only the recorded answer was missing. Undo: drop timeout_milliseconds.
select cron.alter_job(
  job_id  := (select jobid from cron.job where jobname = 'push-send-daily'),
  command := $cmd$
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
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cmd$
);
