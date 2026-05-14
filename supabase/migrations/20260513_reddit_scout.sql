-- Reddit Scout: tracks posts already seen to prevent duplicate digest entries
create table if not exists public.reddit_scout_seen_posts (
  id          uuid        default gen_random_uuid() primary key,
  post_id     text        not null unique,
  subreddit   text        not null,
  title       text,
  permalink   text,
  score       integer,
  seen_at     timestamptz default now()
);

create index if not exists idx_reddit_scout_post_id on public.reddit_scout_seen_posts (post_id);

alter table public.reddit_scout_seen_posts enable row level security;

-- Cron jobs (pg_cron + pg_net) — fire the reddit-scout edge function twice daily
-- 9 AM ET (13:00 UTC) and 9 PM ET (01:00 UTC)
SELECT cron.schedule(
  'reddit-scout-morning',
  '0 13 * * *',
  $$
  SELECT net.http_post(
    url := 'https://mdtosrbfkextcaezuclh.supabase.co/functions/v1/reddit-scout',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  )
  $$
);

SELECT cron.schedule(
  'reddit-scout-evening',
  '0 1 * * *',
  $$
  SELECT net.http_post(
    url := 'https://mdtosrbfkextcaezuclh.supabase.co/functions/v1/reddit-scout',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  )
  $$
);
