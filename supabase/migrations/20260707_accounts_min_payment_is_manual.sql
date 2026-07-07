-- Adds a per-card manual-minimum flag. When true, the debt engine honors the
-- stored accounts.min_payment EXACTLY (including 0 — e.g. a card whose entire
-- balance sits on 0% payment plans with nothing due), with no 2%-formula or
-- $25-floor fallback, and Plaid sync never overwrites min_payment for the row.
alter table public.accounts
  add column if not exists min_payment_is_manual boolean not null default false;
