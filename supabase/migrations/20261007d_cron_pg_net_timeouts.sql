-- Every remaining pg_net cron job waits 60 s (Sam 10-07, after the 5 s default timed out plaid-daily-sync
-- and push-send-daily). Measured max execution over 24 h: no-save-nudge 4.0 s, unverified-nudge 3.5 s,
-- revenue-push 2.6 s, newsletter-digest 0.1 s - the nudges sit within 1-1.5 s of the limit and grow with
-- the number of emails sent. Exact-text replacement of the shared tail; a job whose text differs is left
-- alone and shows up in the read-back below. Undo: replace the timeout tail with the old one.
do $$
declare r record; tail_old text := E'body    := \'{}\'::jsonb\n  );'; tail_new text := E'body    := \'{}\'::jsonb,\n    timeout_milliseconds := 60000\n  );';
begin
  for r in select jobid, command from cron.job
           where jobname in ('no-save-nudge-daily','unverified-nudge-daily','revenue-push-nightly','newsletter-digest-weekly')
             and position('timeout_milliseconds' in command) = 0 and position(tail_old in command) > 0
  loop
    perform cron.alter_job(job_id := r.jobid, command := replace(r.command, tail_old, tail_new));
  end loop;
end $$;
