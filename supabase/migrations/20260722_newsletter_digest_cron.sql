-- Weekly newsletter digest.
-- Schedules the `newsletter-digest` edge function to run every Monday at 15:00 UTC
-- (11am EDT / 10am EST). The function pulls the last 7 days of posts from
-- https://treforged.com/feed.xml and emails a branded digest to every row in
-- public.newsletter_subscribers via Resend.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'newsletter-digest-weekly') then
    perform cron.unschedule('newsletter-digest-weekly');
  end if;
end $$;

select cron.schedule(
  'newsletter-digest-weekly',
  '0 15 * * 1',
  $$
  select net.http_post(
    url     := 'https://mdtosrbfkextcaezuclh.supabase.co/functions/v1/newsletter-digest',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', (
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
