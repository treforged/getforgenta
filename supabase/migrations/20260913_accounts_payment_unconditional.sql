-- A card whose payment the forecast is NOT allowed to shrink.
--
-- Tre, 2026-09-12: "make a button that allows users to make a credit card always pay its full
-- balance or statement balance, unconditionally, regardless of whether or not the cash can fit
-- it... it's just gonna be another debit card, basically. And then all other calculations should
-- adjust around that."
--
-- ⚠️ WHY A NEW COLUMN WHEN `payment_preference` ALREADY EXISTS. That column already chooses
-- BETWEEN full and statement, and it is not what was missing. What was missing is UNCONDITIONAL:
-- `credit-card-engine.ts` sizes the payment as `Math.min(desired, preferencePool)`, so when the
-- month is tight the recommendation silently drops to whatever fits and reports a green
-- projection. That is the app quietly reducing the one number he turned this on to guarantee.
--
-- ⚠️ "DO AS MUCH AS POSSIBLE" APPLIES TO THE OTHER SPENDING, NEVER TO THIS PAYMENT. With this set,
-- a month that cannot afford it must SHOW THE SHORTFALL — not a smaller payment. A forecast that
-- balances itself by shrinking a fixed obligation is lying about the obligation.
--
-- Defaults FALSE, so every existing card behaves exactly as it did.
alter table public.accounts
  add column if not exists payment_unconditional boolean not null default false;

comment on column public.accounts.payment_unconditional is
  'When true, this card''s full/statement payment is a FIXED obligation the forecast must not shrink to make a month balance. If the cash does not fit, the forecast reports a SHORTFALL rather than a smaller payment.';
