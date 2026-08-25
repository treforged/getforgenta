# Partner Linking & Business Separation — Design

**Status:** Proposal (not built)
**Date:** 2026-08-25
**Ask (Tre):** Premium users can switch between profiles with a linked partner (mutual
consent, secure, revocable). Cleaner personal-vs-business separation. Must work with
Tre's own Plaid connection, which lives on his main profile.

## TL;DR — the two problems are different problems

- **Partner (different human, different `auth.uid()`)** → real account **linking**:
  a `partner_links` table, both-parties-consent enforced in the database, and one
  additive SELECT policy per shared table. Ship read-only partner view first.
- **Business (same human, same `auth.uid()`)** → a **`scope` column**
  (`personal | business`) on accounts, transactions, and recurring rules. No second
  profile, no Plaid re-link, no RLS change at all.

Rule of thumb the whole design hangs on: **different person = link; same person = tag.**

---

## 0. Security posture this must respect (read this before touching SQL)

Verified in this repo before designing anything:

1. **New tables in `public` are world-writable the instant they exist.** The default
   ACLs on schema `public` grant ALL (`arwdDxtm`) to BOTH `anon` and `authenticated`
   for every new table — verified on the live project 2026-08-19 and recorded in
   `supabase/migrations/20260819_slice6_crowd_merchant_category_learning.sql`.
   Every new table in this design therefore starts with
   `revoke all ... from anon, authenticated` and narrow re-grants, exactly like
   `rate_limits` and `oauth_states`.
2. **RLS is the only guard, and enumeration has bitten this project before.** The
   old shared-builds policies checked `share_token IS NOT NULL` instead of "caller
   knows the token" and allowed full enumeration
   (`20260615_fix_public_rls.sql`). The fix — exact-token validation server-side in
   a service-role Edge Function (`supabase/functions/public-build/index.ts`) — is
   the house pattern for anything anon-adjacent. Partner invites reuse it.
3. **Secrets never get a client-readable path.** `financial_connections.access_token`
   is reachable only by the service role via column-level grants
   (`20260806_financial_connections.sql`); the `plaid_items` view omits token
   columns entirely. Partner linking must never widen this.
4. **`config.toml` is the source of truth for `verify_jwt`** — a new Edge Function
   gets an explicit entry.
5. **Every client query already filters `.eq('user_id', user.id)`** — 120
   occurrences across 19 files, 70 of them inside `src/hooks/useSupabaseData.ts`.
   That centralization is what makes profile switching a small change.

---

## 1. Linking model: invite → accept → active, all consent recorded in the DB

### What to do

One new table, one new Edge Function, one `config.toml` entry.

#### Table: `public.partner_links`

```sql
create table public.partner_links (
  id               uuid primary key default gen_random_uuid(),
  -- consent #1: creating the invite IS the inviter's consent
  inviter_id       uuid not null references auth.users(id) on delete cascade,
  -- invite is BOUND to an email; only that mailbox's owner can accept
  invitee_email    text not null,           -- stored lowercased
  -- 128-bit random code, stored ONLY as a hash (share_token lesson, applied harder)
  invite_code_hash text not null,
  expires_at       timestamptz not null default (now() + interval '7 days'),
  -- consent #2: accepting with the exact code IS the invitee's consent
  accepted_by      uuid references auth.users(id) on delete cascade,
  accepted_at      timestamptz,
  -- either side, any time
  revoked_at       timestamptz,
  revoked_by       uuid,
  created_at       timestamptz not null default now(),

  -- you cannot consent on someone else's behalf, or link to yourself
  constraint partner_links_no_self check (accepted_by is distinct from inviter_id),
  -- accepted_by and accepted_at travel together
  constraint partner_links_accept_pair
    check ((accepted_by is null) = (accepted_at is null))
);

-- One ACTIVE link per person, on either side of the pair.
create unique index partner_links_one_active_inviter
  on public.partner_links (inviter_id)
  where accepted_at is not null and revoked_at is null;
create unique index partner_links_one_active_acceptor
  on public.partner_links (accepted_by)
  where accepted_at is not null and revoked_at is null;
-- One OUTSTANDING invite per inviter (stops invite-spraying).
create unique index partner_links_one_pending
  on public.partner_links (inviter_id)
  where accepted_at is null and revoked_at is null;

alter table public.partner_links enable row level security;
-- Non-negotiable first line (see §0.1): kill the default world grants.
revoke all on public.partner_links from anon, authenticated;

-- Members can SEE their own link rows (never the code hash — column grant below).
create policy partner_links_select_own on public.partner_links
  for select to authenticated
  using (auth.uid() = inviter_id or auth.uid() = accepted_by);

-- Either member can REVOKE directly (no function dependency for unlink — leaving
-- must always work). Column-level grant restricts what "update" can touch.
create policy partner_links_revoke_own on public.partner_links
  for update to authenticated
  using (auth.uid() = inviter_id or auth.uid() = accepted_by)
  with check (auth.uid() = inviter_id or auth.uid() = accepted_by);

grant select (id, inviter_id, invitee_email, expires_at,
              accepted_by, accepted_at, revoked_at, created_at)
  on public.partner_links to authenticated;
grant update (revoked_at, revoked_by) on public.partner_links to authenticated;
-- NO insert, NO delete grants for authenticated. Invite + accept go through the
-- Edge Function with the service role. invite_code_hash is never client-readable.
```

**A link is "active" if and only if** `accepted_at is not null and revoked_at is null`.
There is no `status` column to get out of sync — activity is derived from the two
consent timestamps, and the RLS predicates in §2 test exactly those columns. Both
consents live in the row itself: `inviter_id` wrote it (via the function, from their
JWT), `accepted_by` accepted it (via the function, from *their* JWT, with the exact
code, matching email). The UI cannot fabricate either one.

#### Edge Function: `supabase/functions/partner-link/index.ts` (`verify_jwt = true`)

One function, three actions, following the `create-checkout` skeleton (CORS from
`_shared/cors.ts`, IP rate limit via `_shared/rate-limit.ts` **before** auth, JWT
verified via `userClient.auth.getUser()`, then a service-role client for writes):

- **`invite`** `{ email }`:
  1. Rate limit by IP and by user id (e.g. 5/hour — invites send email).
  2. Caller must be premium: service-role read of `user_subscriptions`
     (`plan='premium'`, status in `('active','trialing')` — same predicate as
     `SubscriptionContext`). This is the premium gate, enforced server-side.
  3. Reject inviting your own email.
  4. Generate 16 random bytes → base64url code; store **SHA-256 hash** only.
  5. Email the code/link to the invitee (house email path; `sync-stripe-email` /
     `newsletter-digest` show the pattern). The code appears once, in that email.
  6. **Always return the same generic success** whether or not the email has a
     Forgenta account — the function must not be an account-existence oracle.
- **`accept`** `{ code }`:
  1. Rate limit hard by IP and user (e.g. 5/hour — this is the brute-force surface;
     128-bit codes make it academic, rate limiting makes it polite).
  2. Look up by **exact hash match** on `invite_code_hash` where
     `accepted_at is null and revoked_at is null and expires_at > now()`.
  3. Require `lower(caller_jwt_email) = invitee_email`. A leaked code alone is not
     enough — you must also control the invited mailbox (be signed in as it).
  4. Require caller id ≠ inviter id (DB CHECK backs this up).
  5. If the caller already has an active link, refuse (partial unique index backs
     this up).
  6. Set `accepted_by`, `accepted_at`. Return partner display name.
  7. Every failure is the same generic 404 — no "expired" vs "wrong code" vs
     "wrong email" distinction for the caller to probe with.
- **`status`** — optional convenience; the client can also just SELECT its own rows.

**Revoke intentionally has no function action** — it is a direct, RLS-scoped,
column-granted UPDATE (`revoked_at = now(), revoked_by = auth.uid()`), so either
side can sever the link even if Edge Functions are down.

### Why enumeration/probing is impossible

- `partner_links` has **no anon grants at all** and authenticated can only SELECT
  rows it is a member of — there is nothing to enumerate via PostgREST.
- The invite code exists in exactly two places: the invitee's email, and a SHA-256
  hash in a column with **no client-readable grant**. Even the inviter can't read it
  back (compare: `share_token` was readable and that was the 2026-06-15 hole).
- Acceptance = knowledge of an unguessable code **AND** a verified session on the
  invited email **AND** rate limiting. Three independent walls.
- The invite action's response is identical for existing and non-existing accounts.

### Why this shape (and not alternatives)

- *A SECURITY DEFINER RPC instead of an Edge Function?* The crowd-voting RPC shows
  the house can do it, but `rate_limit_check` is deliberately service-role-only and
  invites must send email — both push this to an Edge Function, which is also the
  established pattern for consent-ish flows (`public-build`, `plaid-exchange-token`).
- *Two rows (one per direction)?* One row with two consent timestamps cannot
  half-agree or desynchronize; a pair of rows can.
- *An `invite by user id / username` flow?* Requires user search, which is an
  enumeration feature. Email-bound codes require no directory at all.

---

## 2. Profile switching: a read-scoped lens, not a merge

### What "switch" means

**Recommendation: switching = the app re-renders every page over the partner's
`user_id` instead of your own, read-only.** Not a merged "household" dataset (that
comes later as a client-side aggregate, §4 Phase 3), and not a second auth session.
You stay signed in as yourself; only the *lens* changes. This matches how the app
already behaves in demo mode: same pages, different data source, writes disabled.

### How the client scopes queries today, and the smallest change

Every read in `src/hooks/useSupabaseData.ts` (and ~18 other files) does
`.eq('user_id', user.id)` and keys React Query on `user?.id`
(e.g. `['accounts', isDemo ? 'demo' : user?.id]`). So the smallest change is:

1. **New `src/contexts/ViewedProfileContext.tsx`** exposing
   `{ viewedUserId, isPartnerView, switchTo, switchBack }`. Default
   `viewedUserId = user.id`. Session-scoped state (do NOT persist across app
   launches — reopening the app always shows your own money first).
2. **In `useSupabaseData.ts`**, replace `user.id` with `viewedUserId` in **read**
   query functions and query keys (`['accounts', isDemo ? 'demo' : viewedUserId]` —
   keying on `viewedUserId` gives cache isolation between the two lenses for free).
3. **Mutations stay pinned to `user.id` and refuse in partner view** — reuse the
   existing demo-mode guard verbatim: every mutation already starts with
   `if (isDemo || !user) throw new Error('Demo mode')`; extend to
   `if (isDemo || isPartnerView || !user) throw ...`. One mechanical pass over one
   file covers 70 of the 120 call sites; the stragglers (Dashboard widgets,
   Settings, AiAdvisor) are Phase 1 checklist items, and any missed `.eq('user_id',
   user.id)` read **fails closed** (shows your own data, never someone else's).

### The RLS change — additive, never weakening

Add **one new permissive SELECT policy per shared table**; touch nothing that
exists. Postgres ORs permissive policies, so `*_select_own` continues to work
unchanged, and all INSERT/UPDATE/DELETE policies still require
`auth.uid() = user_id` — the partner physically cannot write in Phase 1, no matter
what the client does.

```sql
-- Helper: the partner of the current user, if an ACTIVE link exists.
-- SECURITY DEFINER so it can read partner_links regardless of future policy
-- changes; STABLE so the planner runs it once per statement (InitPlan), not once
-- per row; hardened per 20260621_harden_definer_functions_and_storage.sql.
create or replace function public.active_partner_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select case when pl.inviter_id = auth.uid() then pl.accepted_by
              else pl.inviter_id end
  from public.partner_links pl
  where (pl.inviter_id = auth.uid() or pl.accepted_by = auth.uid())
    and pl.accepted_at is not null
    and pl.revoked_at is null
  limit 1
$$;
revoke all on function public.active_partner_id() from public, anon;
grant execute on function public.active_partner_id() to authenticated;

-- Repeat for each table on the ALLOWLIST below:
create policy accounts_select_partner on public.accounts
  for select to authenticated
  using (user_id = (select public.active_partner_id()));
```

**Allowlist** (tables that get the partner SELECT policy): `accounts`,
`transactions`, `recurring_rules`, `budget_items`, `debts`, `assets`,
`liabilities`, `savings_goals`, `car_funds`, `net_worth_snapshots`,
`payment_plans`, `account_reconciliations`, `synced_transactions`,
`synced_transaction_reviews`, `car_builds` + `car_build_phases` +
`car_build_items` + `car_maintenance_logs`, `lump_sum_transfers`.

**Explicitly NOT on the allowlist** (see also §5 "never shared"):

- `profiles` — it carries `trusted_devices`, deduction/tax detail, and tour/consent
  state. Phase 1 renders the partner view without it (accounts, transactions,
  goals, debts don't need it). If later phases need partner income for forecasts,
  expose a **column-allowlisted** path (a small SECURITY DEFINER function returning
  `display_name, currency, show_cents` only — the `public_build_owner_names` lesson:
  never the whole row).
- `financial_connections` / `plaid_items` — tokens and sync state. The partner sees
  the *accounts and transactions Plaid produced*, never the connection itself.
- `user_subscriptions`, `subscriptions`, `ai_advisor_history`, `ai_usage_events`,
  `email_nudges`, `oauth_states`, `rate_limits`.

### Why `user_id = (select active_partner_id())` and not `user_id IN (...)` inline

- The obvious combined policy —
  `user_id = auth.uid() OR user_id IN (select partner of active link)` — is
  *functionally* right; this design splits it into two policies (existing
  `_select_own` + new `_select_partner`) so the migration **adds** and never
  **replaces**. A botched combined-policy migration could weaken single-user RLS;
  a botched additive one can only fail to grant partner access.
- Performance: wrapped in `(select ...)`, a STABLE function evaluates once per
  statement as an InitPlan, then each row check is an equality against a constant —
  identical cost profile to today's `auth.uid() = user_id`. `partner_links` lookups
  hit the partial unique indexes (a table with at most a handful of rows per user).
  Verify with `explain analyze` on `transactions` (largest table) before shipping;
  confirm every allowlisted table has its `user_id` index (they are queried by
  `user_id` today, but check — the policy makes the index load-bearing for
  *other* people's queries too).
- Revocation is instant: the moment `revoked_at` is set, `active_partner_id()`
  returns NULL and every partner policy evaluates false on the very next statement.
  No session invalidation needed, nothing cached server-side.

---

## 3. Personal vs business: tag it, don't fork it

### Recommendation

**Add a `scope` column (`'personal' | 'business'`) to `accounts`,
`transactions`, and `recurring_rules`. Do NOT build profiles-as-workspaces.**

```sql
alter table public.accounts        add column scope text not null default 'personal'
  check (scope in ('personal','business'));
alter table public.transactions    add column scope text not null default 'personal'
  check (scope in ('personal','business'));
alter table public.recurring_rules add column scope text not null default 'personal'
  check (scope in ('personal','business'));
```

No RLS change of any kind — everything stays under one `user_id`.

### The honest reasoning (including why workspaces lose)

- **The Plaid constraint decides it.** `financial_connections.user_id` ties every
  Plaid item to the `auth.uid()` that linked it, and tokens are service-role-only.
  A second "business profile" — whether a second auth user or a `profile_id`
  dimension — would need Tre's business bank connection moved or duplicated, and
  moving a Plaid item to another user **re-triggers bank authentication**. Scope
  tagging keeps his existing connection exactly where it is: tag the business
  checking *account* row `scope='business'`, and everything it syncs inherits that
  scope at review time. **Zero Plaid changes.**
- **The app already half-does this, badly.** `'Business'` and
  `'Business Contributions'` exist as *categories* (`src/lib/types.ts`), which
  makes "business" mutually exclusive with "Dining" — a business lunch can't be
  both. A `scope` column makes them orthogonal: `scope='business'`,
  `category='Dining'`. (There are also legacy `expenses` / `capital_contributions`
  tables with `tax_deductible`, `project_client`, `reporting_year` — evidence this
  need is real; a future phase can fold them in, not a blocker now.)
- **Workspaces would fork everything.** Every hook keys on `user_id`; a
  `profile_id` dimension touches all 120 query sites, splits net worth, forecast,
  debt engine, and dashboards into per-workspace variants, and raises unanswerable
  questions (which workspace owns a shared checking account? does premium cover
  both?). That's months of churn to model what is, for a sole proprietor, a
  reporting dimension — the business's money flows through the same real bank
  accounts either way.
- **Where it stops being right:** if a customer ever needs a business with its own
  bank logins kept fully separate (LLC with an S-corp election, an accountant with
  read access), that's a *different person/entity boundary* — and the answer is the
  §1 linking machinery pointed at a second account, not workspaces. The
  same-person/different-person rule keeps holding.

### Client behavior

- Global scope filter (All / Personal / Business) on Transactions, Dashboard,
  Forecast — persisted in `profiles.ui_preferences` like other view prefs.
- Add/edit transaction forms get a scope toggle defaulting from the selected
  account's scope; the bank-review queue (`useBankReviewQueue`) pre-fills scope
  from the synced account's scope so business card swipes land tagged with zero
  extra taps.
- Rules engine: `recurring_rules.scope` flows into generated occurrences.

---

## 4. Phase plan (smallest shippable slice first)

### Phase 0 — Schema + function (no UI, independently deployable)
- `supabase/migrations/2026XXXX_partner_links.sql` — table, revokes, grants,
  policies, partial unique indexes, `active_partner_id()` (§1, §2).
- `supabase/functions/partner-link/index.ts` — invite/accept (§1), cloned from the
  `create-checkout` skeleton (`_shared/cors.ts`, `_shared/rate-limit.ts`).
- `supabase/config.toml` — `[functions.partner-link] verify_jwt = true` with the
  house comment explaining why.
- Regenerate `src/integrations/supabase/types.ts`.
- Nothing user-visible yet; RLS partner policies can even ship here safely (they
  grant nothing until a link is active, and no link can exist yet).

### Phase 1 — Link + read-only partner view (the first thing Tre's partner sees)
- Partner SELECT policies on the §2 allowlist (same migration or a second one).
- New `src/contexts/ViewedProfileContext.tsx`; provider added in `src/App.tsx`
  inside Auth/Demo/Subscription providers.
- `src/hooks/useSupabaseData.ts` — reads use `viewedUserId` (key + filter);
  mutation guards extended with `isPartnerView` (the existing demo-mode throw).
- Sweep remaining read sites: `src/hooks/useFinancialConnections.ts` and
  `src/hooks/usePlaidItems.ts` stay pinned to own user (connections are never
  partner-visible); `src/pages/Dashboard.tsx` / `AiAdvisor.tsx` widgets checked.
- New `src/components/settings/PartnerLink.tsx` (invite form, pending state,
  accept-with-code, unlink button) — mounted in `src/pages/Settings.tsx` next to
  `LinkedAccounts.tsx`.
- Switcher UI: entry in `src/components/layout/Sidebar.tsx` +
  `MobileTopBar.tsx`, with a persistent "Viewing {partner} — read only" banner in
  `DashboardLayout.tsx` (mirror how demo mode announces itself).
- Gate the switcher on `isPremium` from `SubscriptionContext`.

### Phase 2 — Business scope
- Migration adding `scope` to `accounts`, `transactions`, `recurring_rules`
  (default `'personal'`, backfill implicit).
- `src/pages/Transactions.tsx`, `src/pages/Accounts.tsx` — scope toggle + filter;
  `src/components/transactions/BankActivity.tsx` + `useBankReviewQueue` — scope
  pre-fill from account; `src/lib/forecast-engine.ts` inputs get an optional scope
  filter. Independent of Phases 0–1; can ship before or after.

### Phase 3 — Write access, then household aggregates
- Write access is **opt-in per link and per direction**: add
  `inviter_grants_write` / `acceptor_grants_write` booleans to `partner_links`
  (each writable only by its own side via a column-granted UPDATE policy), and add
  partner INSERT/UPDATE policies on a *narrower* allowlist (`transactions`,
  `synced_transaction_reviews` first — "my partner categorizes our spending").
  DELETE stays owner-only.
- Household view: purely client-side first — a dashboard mode that runs both
  users' read queries and merges (RLS already permits both reads; no schema
  change). DB-side aggregate views only if performance demands it later.

---

## 5. Risks and hard lines

- **Subscription boundary — recommendation: the INVITER must be premium; the
  invitee rides along.** It sells premium as the household plan and matches how
  couples actually buy one subscription. Enforced server-side at invite time (§1).
  Known honest gap: if premium lapses *after* linking, Phase 1 only hides the
  switcher client-side (`isPremium`); the RLS policy would still technically allow
  reads via raw PostgREST. Close it in a fast-follow: `stripe-webhook` /
  `revenuecat-webhook` set `revoked_at` (with a `revoked_by = null`,
  reason-annotated row) on lapse, or `active_partner_id()` grows a premium check
  against `user_subscriptions`. Decide before Phase 1 ships; the webhook route is
  cheaper per-query.
- **Unlink privacy — the ex-partner keeps seeing NOTHING, immediately.** Server:
  `revoked_at` flips every partner policy false on the next statement (§2). Client:
  two obligations — (1) on revoke, reset `ViewedProfileContext` to self and
  `queryClient.removeQueries()` for keys under the ex-partner's id (keys are
  already user-scoped, so this is targeted); (2) audit for partner data leaking
  into device persistence — `sessionStorage` premium cache, `useWidgetSync` (home
  screen widgets must ONLY ever sync the owner's data — pin it to `user.id`, never
  `viewedUserId`), and any `usePersistedState` usage that might capture
  partner-view state. Revocation requires no confirmation from the other side and
  must never fail for lack of premium.
- **Demo mode:** `isDemo` short-circuits everything already; partner UI renders a
  static teaser in demo (no invites — the Edge Function requires a real premium
  JWT anyway, so demo is safe by construction, but don't show dead buttons).
- **Mobile parity:** same React code under Capacitor, so the lens works day one.
  Check: RevenueCat premium detection flows through the same `SubscriptionContext`
  (fine); AppLock/biometrics gate the device, not the lens (fine); widgets — see
  above; deep-link the invite email's accept URL so it opens the app on mobile
  (`AuthCallback.tsx` shows the pattern).
- **What must NEVER be shared — enforced by absence of grants/policies, not by UI:**
  Plaid/Akoya access tokens and `financial_connections` rows; `oauth_states`;
  auth credentials/sessions (linking never shares a login — two humans, two
  logins, always); `trusted_devices` (lives in `profiles`, which is why `profiles`
  stays off the allowlist); `user_subscriptions`/Stripe customer ids;
  `ai_advisor_history`. Each is protected the same way `access_token` is today:
  no policy + no grant = no path, regardless of client bugs.
- **Migration-order risk:** partner SELECT policies reference
  `active_partner_id()`, which references `partner_links` — one migration, ordered
  table → function → policies, wrapped in `begin/commit` like
  `20260806_financial_connections.sql`.
