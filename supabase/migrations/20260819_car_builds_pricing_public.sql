-- Whether a shared build link shows what the parts cost. APPLIED 2026-08-19.
--
-- WARNING: DEFAULT TRUE, and that is the opposite of `maintenance_public`'s default on purpose.
-- The maintenance log was a NEW capability: nothing had ever been shared, so private-by-default
-- took nothing away from anyone. Pricing is different -- every shared build link in existence
-- already shows prices today. Defaulting this to false would silently change what those links show
-- to people the owner has already sent them to, without the owner asking. The switch is therefore
-- an opt-OUT: the page keeps the promise it has been making, and an owner who would rather not
-- publish what they spent can now say so.
alter table car_builds
  add column if not exists pricing_public boolean not null default true;

comment on column car_builds.pricing_public is
  'Per build. When false, public-build omits item prices entirely - they are never sent and hidden in the browser. Defaults true because shared links already showed pricing before this column existed.';
