-- Where a signup came from. First-touch campaign attribution, written once at signup.
-- ============================================================================
-- WHY. Ellis measured on 2026-09-17, with a positive control, that **no link from
-- treforged.com is attributable once the visitor lands on getforgenta**. Production
-- read exactly ONE query parameter, `ref`, and `utm_` appeared nowhere in `src/`
-- except a test asserting it is ignored. So every campaign, every bio link and
-- every calculator page sent traffic that arrived anonymous.
--
-- ⚠️ WHY NOT REUSE `ref`, WHICH ALREADY EXISTS. He deliberately did not, and left
-- the call here, which was right. `ref` is a referral CODE - `^[0-9a-f]{8}$`, the
-- first 8 characters of a referrer's uuid - and it is validated at the door
-- because its destination is a column this app matches other USERS against. A
-- campaign name like `link_in_bio` is not that shape, so `referralCodeFromSearch`
-- would DISCARD it silently: the link would look attributed and attribute
-- nothing. Borrowing an identity-shaped parameter for a different purpose is how
-- you get a system that reports confidently about nothing.
--
-- So campaigns use `utm_*`, which every analytics tool and link builder already
-- emits, and which the marketing desk's own links already carry. Using the
-- parameter people already know beats inventing a private one.
--
-- ── THE CONSTRAINT IS THE REAL BOUNDARY ────────────────────────────────────
-- `src/lib/attribution.ts` validates these values, but the client is the thing an
-- attacker controls. The check below is what actually holds: a short lowercase
-- token, or nothing. These arrive from a query string anybody can type.
--
-- ── FIRST TOUCH WINS, and the columns are SPREAD not nulled ────────────────
-- The campaign that INTRODUCED somebody earned the signup, matching `referral.ts`
-- deliberately so the two cannot disagree about what "source" means. And an
-- unattributed signup writes NO columns rather than three nulls: "arrived
-- directly" and "we erased what was there" are different facts about a row.
--
-- UNDO:
--   alter table public.profiles drop constraint if exists profiles_acquisition_shape;
--   alter table public.profiles
--     drop column if exists acquisition_source,
--     drop column if exists acquisition_medium,
--     drop column if exists acquisition_campaign;
-- ============================================================================

begin;

alter table public.profiles
  add column if not exists acquisition_source   text,
  add column if not exists acquisition_medium   text,
  add column if not exists acquisition_campaign text;

alter table public.profiles drop constraint if exists profiles_acquisition_shape;
alter table public.profiles add constraint profiles_acquisition_shape check (
  (acquisition_source   is null or acquisition_source   ~ '^[a-z0-9][a-z0-9_-]{0,63}$') and
  (acquisition_medium   is null or acquisition_medium   ~ '^[a-z0-9][a-z0-9_-]{0,63}$') and
  (acquisition_campaign is null or acquisition_campaign ~ '^[a-z0-9][a-z0-9_-]{0,63}$')
);

comment on column public.profiles.acquisition_source is
'FIRST-TOUCH utm_source captured when the visitor first landed, written once at signup. '
'Deliberately NOT the `ref` parameter: that is an 8-hex referral CODE whose validator would '
'silently discard a campaign name, which would look like attribution while attributing nothing. '
'Measured 2026-09-17 (Ellis): before this, no link from treforged.com was attributable at all.';

commit;
