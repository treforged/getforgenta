-- Security fix (F-01, 2026-06-15 review): BuildShare.tsx rendered item.link
-- directly with no server-side enforcement that it was http(s)://. Client-side
-- isSafeUrl() in PhaseBlock.tsx is bypassable via direct REST writes. This
-- constraint makes the database reject non-http(s) links regardless of client.
alter table public.car_build_items
  add constraint link_must_be_http
    check (link is null or link ~ '^https?://');
